import process from "node:process";
import { matchAgentName } from "@/lib/agents";

/**
 * Server-only module: volume de chamados do Helpdesk HubSpot por agente do
 * time de Suporte, na mesma janela de 90 dias usada no Freshchat.
 *
 * Espelha o fluxo n8n equivalente: owners do time Suporte → contagem de
 * tickets via search (`total`), filtrando estágio do pipeline e canais.
 *
 * Env: HUBSPOT_ACCESS_TOKEN (private app token, SEM prefixo VITE_).
 */

const HUBSPOT_API = "https://api.hubapi.com";

// Time "Suporte" no HubSpot.
const SUPPORT_TEAM_ID = "7684604";
// Estágio do pipeline contabilizado.
const PIPELINE_STAGE_ID = "1092753784";
// Canais de origem contabilizados (helpdesk).
const CHANNEL_INSTANCE_IDS = ["1583825086", "3405228652"];
// Concorrência controlada para consultas de contagem de tickets (respeitando limite de reqs).
const HUBSPOT_SEARCH_CONCURRENCY = 4;

type HubspotOwner = {
  id: string;
  firstName?: string;
  lastName?: string;
  archived?: boolean;
  teams?: Array<{ id: string | number }>;
};

export type HubspotAgentVolume = { name: string; total: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

/** Owners não arquivados que pertencem ao time de Suporte. */
async function getSupportOwners(token: string): Promise<HubspotOwner[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners/?limit=500`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    throw new Error(
      `HubSpot /owners retornou ${res.status} ${res.statusText}. Verifique HUBSPOT_ACCESS_TOKEN.`,
    );
  }

  const data = (await res.json()) as { results?: HubspotOwner[] };
  return (data.results || []).filter(
    (owner) =>
      !owner.archived &&
      Array.isArray(owner.teams) &&
      owner.teams.some((team) => String(team.id) === SUPPORT_TEAM_ID),
  );
}

/**
 * Conta tickets do owner na janela. Usa `limit: 1` e lê apenas `total` —
 * não precisamos dos tickets em si.
 */
async function countTickets(
  token: string,
  ownerId: string,
  startMs: number,
  endMs: number,
): Promise<number> {
  const body = JSON.stringify({
    filterGroups: [
      {
        filters: [
          { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
          { propertyName: "createdate", operator: "GTE", value: startMs },
          { propertyName: "createdate", operator: "LTE", value: endMs },
          { propertyName: "hs_pipeline_stage", operator: "EQ", value: PIPELINE_STAGE_ID },
          {
            propertyName: "hs_originating_channel_instance_id",
            operator: "IN",
            values: CHANNEL_INSTANCE_IDS,
          },
        ],
      },
    ],
    properties: ["hubspot_owner_id"],
    limit: 1,
  });

  let backoffMs = 1500;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets/search`, {
        method: "POST",
        headers: authHeaders(token),
        body,
      });

      // O search da HubSpot é limitado a ~4 req/s; 429 é esperado sob carga.
      if (res.status === 429) {
        await sleep(backoffMs);
        backoffMs *= 2;
        continue;
      }

      if (!res.ok) {
        console.warn(`[hubspot] tickets/search ${res.status} para owner ${ownerId}`);
        return 0;
      }

      const data = (await res.json()) as { total?: number };
      return data.total || 0;
    } catch (err) {
      console.warn(`[hubspot] erro para owner ${ownerId}:`, err);
      await sleep(backoffMs);
      backoffMs *= 2;
    }
  }

  console.warn(`[hubspot] owner ${ownerId} sem resposta após retries; contabilizando 0.`);
  return 0;
}

/**
 * Volume de chamados do Helpdesk por agente de Suporte na janela informada
 * (a mesma calculada para o Freshchat).
 *
 * Otimizações:
 * - Filtra previamente por `teamAgentNames` quando fornecido, evitando chamadas inúteis.
 * - Utiliza concorrência controlada (4 workers) em vez de processamento estritamente sequencial.
 */
export async function getHubspotVolumes90Days(
  window: {
    start: Date;
    end: Date;
  },
  teamAgentNames?: string[],
): Promise<HubspotAgentVolume[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN || "";
  if (!token) {
    throw new Error("HUBSPOT_ACCESS_TOKEN não configurado no .env do servidor.");
  }

  const startMs = window.start.getTime();
  // `end` é 00:00 do dia atual (exclusivo); LTE é inclusivo, então recuamos 1ms
  // para não contar tickets criados exatamente na virada de hoje.
  const endMs = window.end.getTime() - 1;

  const owners = await getSupportOwners(token);

  // Filtragem prévia dos agentes caso nomes da escala tenham sido fornecidos
  const relevantOwners =
    teamAgentNames && teamAgentNames.length > 0
      ? owners.filter((owner) => {
          const fullName = `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || owner.id;
          return teamAgentNames.some((name) => matchAgentName(name, fullName));
        })
      : owners;

  const volumes: HubspotAgentVolume[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < relevantOwners.length) {
      const owner = relevantOwners[cursor++];
      const name = `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || owner.id;
      const total = await countTickets(token, owner.id, startMs, endMs);
      volumes.push({ name, total });
    }
  }

  const workerCount = Math.min(HUBSPOT_SEARCH_CONCURRENCY, relevantOwners.length);
  if (workerCount > 0) {
    const workers = Array.from({ length: workerCount }, (): Promise<void> => worker());
    await Promise.all(workers);
  }

  return volumes;
}
