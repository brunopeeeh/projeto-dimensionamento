import process from "node:process";
import {
  isAiAgent,
  isSupportAgent,
  matchAgentName,
  mergeAgentVolumes,
  type AgentVolume,
} from "@/lib/agents";
import { handleSyncCapacity } from "./sync-capacity.server";
import { getHubspotVolumes90Days } from "./hubspot.server";

/**
 * Server-only module: imports Care support agents from Freshchat and pushes
 * their 90-day resolved-interaction volume into Supabase. O volume do Helpdesk
 * HubSpot (mesma janela de 90 dias) é somado ao do Freshchat por agente.
 *
 * Required env: FRESHCHAT_BEARER_TOKEN, HUBSPOT_ACCESS_TOKEN
 * (no VITE_ prefix — server-only secrets).
 */

const FRESHCHAT_API = "https://api.freshchat.com/v2";

// Group IDs: filter rule is "(RETENTION OR WEBCHAT) - ONBOARDING"
const RETENTION_GROUP_ID = "3ea40078-55f2-4176-85ee-face7f3d7498";
const WEBCHAT_GROUP_ID = "6b748002-634a-4ba7-b191-844d123643ed";
const ONBOARDING_GROUP_ID = "64f40e5f-b18a-4d1d-8c23-1fcb9575c5a7";

// Linhas manuais: as fontes não consolidam esses volumes com segurança durante
// a migração. Toda sincronização as zera para preenchimento posterior na UI.
const MANUAL_CAPACITY_AGENTS = [
  { name: "Yooga Suporte", mediaTri: 0 },
  { name: "Care IA", mediaTri: 0, active: true },
];

// Agent overrides applied after Freshchat sync. Edit here to adjust behavior
// without redeploying. Case-insensitive matching (lowercase + strip accents).
//
//   EXCLUDE_NAMES — agentes reais do Freshchat que NÃO devem aparecer
//                    na tabela de Capacity.
//   RENAME_MAP     — agente real cujo nome precisa ser normalizado antes de
//                    identificar contas especiais e consolidar humanos.
//
// "Maya da Yooga" é a mesma IA do Freshchat ("Maya Santos"), cadastrada com
// outro nome no HubSpot (yara.ai@) — sem isso o volume do bot entraria como
// agente humano.
const EXCLUDE_NAMES = ["Maya Santos", "Maya da Yooga"];

// Também normaliza nomes do HubSpot para o cadastro do Freshchat, quando a
// mesma pessoa está registrada de forma diferente nas duas plataformas —
// senão o agente vira duas linhas em vez de somar.
const RENAME_MAP: Record<string, string> = {
  "Yooga Tecnologia": "Care IA",
  "Brenda Patricio": "Brenda de Souza Patricio",
  "Julio Oliveira Monteiro": "Julio Cesar Oliveira Monteiro",
  "Bryan Ladislau": "Bryan Américo",
};

// Concurrency cap for the volume fetch (per-agent metric requests). Keeps us
// polite to the Freshchat API while optimizing throughput.
const VOLUME_CONCURRENCY = 4;

type FreshchatAgent = {
  id: string;
  first_name?: string;
  last_name?: string;
  groups?: string[];
  availability_status?: string;
  skill_id?: string;
};

export type FreshchatSyncResult = {
  success: boolean;
  message: string;
  month: string;
  agents_synced: number;
  agents_added_to_team: string[];
  agents_removed_from_team: string[];
  total_team_agents: number;
  error?: string;
};

function getBearer(): string {
  return process.env.FRESHCHAT_BEARER_TOKEN || "";
}

const lc = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

function isInTargetGroup(groups: string[] | undefined): boolean {
  if (!groups || !Array.isArray(groups)) return false;
  return groups.includes(RETENTION_GROUP_ID) || groups.includes(WEBCHAT_GROUP_ID);
}

function isInOnboarding(groups: string[] | undefined): boolean {
  if (!groups || !Array.isArray(groups)) return false;
  return groups.includes(ONBOARDING_GROUP_ID);
}

/**
 * Fetches all support agents and returns only those that are in RETENTION or
 * WEBCHAT and NOT in ONBOARDING.
 */
export async function getSupportAgents(): Promise<FreshchatAgent[]> {
  const bearer = getBearer();
  if (!bearer) {
    throw new Error(
      "FRESHCHAT_BEARER_TOKEN não configurado. Defina a variável no .env do servidor.",
    );
  }

  const url = `${FRESHCHAT_API}/agents?page=1&items_per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Freshchat /agents retornou ${res.status} ${res.statusText}. Verifique o token.`,
    );
  }

  const data = (await res.json()) as { agents?: FreshchatAgent[] };
  const agents = data.agents || [];

  return agents.filter((a) => isInTargetGroup(a.groups) && !isInOnboarding(a.groups));
}

/**
 * Janela de 90 dias usada pelas duas plataformas (Freshchat e HubSpot).
 *
 * Ajuste para pegar a data atual no fuso horário do Brasil (UTC-3) e definir o
 * fim como 00:00:00 do dia atual, ignorando as horas de hoje.
 */
export function getWindow90Days(): { start: Date; end: Date } {
  const now = new Date();
  const localTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  const end = new Date(
    Date.UTC(localTime.getUTCFullYear(), localTime.getUTCMonth(), localTime.getUTCDate()),
  );
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 90);

  return { start, end };
}

/**
 * Fetches the 90-day resolved-interaction count for each agent, in parallel.
 * Returns a map of `agentId → totalVolume` (sum of all daily values).
 */
export async function getAgentVolumes90Days(agentIds: string[]): Promise<Record<string, number>> {
  const bearer = getBearer();
  if (!bearer) {
    throw new Error("FRESHCHAT_BEARER_TOKEN não configurado no .env do servidor.");
  }
  if (agentIds.length === 0) return {};

  const { start, end } = getWindow90Days();

  const startStr = start.toISOString(); // ex: 2026-03-31T00:00:00.000Z
  const endStr = end.toISOString(); // ex: 2026-06-29T00:00:00.000Z

  const volumes: Record<string, number> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < agentIds.length) {
      const id = agentIds[cursor++];
      let retries = 3;
      let success = false;
      let backoffMs = 1500;

      while (retries > 0 && !success) {
        try {
          const url = new URL(`${FRESHCHAT_API}/metrics/historical`);
          url.searchParams.set("metric", "conversation_metrics.resolved_interactions");
          url.searchParams.set("start", startStr);
          url.searchParams.set("end", endStr);
          url.searchParams.set("count_metric", "count");
          url.searchParams.set("filter_by", `agent=${id}`);
          url.searchParams.set("group_by", "agent");
          url.searchParams.set("interval", "1d");

          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${bearer}`,
              accept: "application/json",
            },
          });

          if (!res.ok) {
            if (res.status === 429) {
              console.warn(
                `[freshchat] Rate limited (429) for agent ${id}. Retrying in ${backoffMs}ms...`,
              );
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              backoffMs *= 2;
              retries--;
              if (retries === 0) volumes[id] = 0;
              continue;
            } else {
              console.warn(`[freshchat] metrics ${res.status} for agent ${id}`);
              volumes[id] = 0;
              success = true;
              continue;
            }
          }
          const data = (await res.json()) as {
            data?: Array<{ series?: Array<{ values?: Array<{ value: string }> }> }>;
          };

          let total = 0;
          for (const entry of data.data || []) {
            for (const serie of entry.series || []) {
              for (const v of serie.values || []) {
                total += parseFloat(v.value) || 0;
              }
            }
          }
          volumes[id] = total;
          success = true;
        } catch (err) {
          console.warn(`[freshchat] error for agent ${id}:`, err);
          retries--;
          if (retries === 0) {
            volumes[id] = 0;
          } else {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            backoffMs *= 2;
          }
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(VOLUME_CONCURRENCY, agentIds.length) },
    (): Promise<void> => worker(),
  );
  await Promise.all(workers);

  return volumes;
}

/**
 * End-to-end Freshchat → Supabase sync for a given planning month.
 *
 *  1. Fetch filtered support agents from Freshchat
 *  2. Fetch their 90-day resolved-interaction totals
 *  2b. Fetch the 90-day HubSpot Helpdesk ticket totals and sum them per agent
 *  3. Filter: drop EXCLUDE_NAMES, drop agents not on the schedule
 *  4. Apply RENAME_MAP (Care IA substitution from Yooga Tecnologia)
 *  5. Remove IA/Yooga aliases from the automatic result
 *  6. Append the two manual capacity rows with zero values
 *  7. Delegate to handleSyncCapacity() to upsert into escala_equipe
 */
export type FreshchatSyncRequest = {
  month: string;
  /** Nomes da escala ativa (enviado pelo cliente). Se vazio, todos os
   *  agentes humanos são descartados — apenas as linhas manuais zeradas
   *  permanecem (regra estrita). */
  teamAgentNames: string[];
};

/**
 * Consolida somente agentes humanos das duas plataformas. IA e contas Yooga
 * são sempre substituídas pelas linhas manuais zeradas, independentemente do
 * alias recebido durante a migração.
 */
export function buildCapacityAgents(
  freshchatAgents: AgentVolume[],
  hubspotAgents: AgentVolume[],
  teamAgentNames: string[],
): Array<{ name: string; mediaTri: number; active?: boolean }> {
  const humanAgents = mergeAgentVolumes(freshchatAgents, hubspotAgents)
    .filter(
      (agent) => !EXCLUDE_NAMES.includes(agent.name) && !EXCLUDE_NAMES.includes(lc(agent.name)),
    )
    .filter((agent) => !isAiAgent(agent.name) && !isSupportAgent(agent.name))
    .filter((agent) => teamAgentNames.some((teamName) => matchAgentName(agent.name, teamName)))
    .map(({ name, mediaTri }) => ({ name, mediaTri }));

  return [...humanAgents, ...MANUAL_CAPACITY_AGENTS];
}

export async function runFreshchatSync(req: FreshchatSyncRequest): Promise<FreshchatSyncResult> {
  const monthName = req?.month;
  const teamAgentNames = Array.isArray(req?.teamAgentNames) ? req.teamAgentNames : [];

  if (!monthName || typeof monthName !== "string") {
    return {
      success: false,
      message: "Mês/ano de destino é obrigatório (ex: 'Fevereiro 2026').",
      month: monthName || "",
      agents_synced: 0,
      agents_added_to_team: [],
      agents_removed_from_team: [],
      total_team_agents: 0,
      error: "INVALID_MONTH",
    };
  }

  const applyRename = (fullName: string) => {
    const renamed = RENAME_MAP[fullName] ?? RENAME_MAP[lc(fullName)];
    return { name: renamed ?? fullName, wasRenamed: !!renamed };
  };

  // As duas plataformas são independentes: executadas em paralelo via Promise.allSettled.
  // Durante a migração Freshchat → HubSpot, a queda de uma não pode zerar o volume da outra.
  // Cada falha vira aviso na mensagem — número parcial nunca passa como completo.
  // Se as duas falharem, o sync aborta em vez de gravar zeros.
  const [freshchatResult, hubspotResult] = await Promise.allSettled([
    (async () => {
      const supportAgents = await getSupportAgents();
      // Filtragem prévia: busca volumes apenas de agentes que realmente estão na escala
      const relevantSupportAgents =
        teamAgentNames && teamAgentNames.length > 0
          ? supportAgents.filter((a) => {
              const fullName = `${a.first_name || ""} ${a.last_name || ""}`.trim() || a.id;
              const { name } = applyRename(fullName);
              return teamAgentNames.some((teamName) => matchAgentName(teamName, name));
            })
          : supportAgents;

      const volumes = await getAgentVolumes90Days(relevantSupportAgents.map((a) => a.id));
      return relevantSupportAgents.map((a) => {
        const fullName = `${a.first_name || ""} ${a.last_name || ""}`.trim() || a.id;
        const { name, wasRenamed } = applyRename(fullName);
        return { name, mediaTri: Math.round(volumes[a.id] || 0), wasRenamed };
      });
    })(),
    (async () => {
      const volumes = await getHubspotVolumes90Days(getWindow90Days(), teamAgentNames);
      return volumes.map((h) => {
        const { name, wasRenamed } = applyRename(h.name);
        return { name, mediaTri: h.total, wasRenamed };
      });
    })(),
  ]);

  let freshchatWarning = "";
  let freshchatAgents: AgentVolume[] = [];
  if (freshchatResult.status === "fulfilled") {
    freshchatAgents = freshchatResult.value;
  } else {
    freshchatWarning =
      freshchatResult.reason instanceof Error
        ? freshchatResult.reason.message
        : String(freshchatResult.reason);
    console.warn("[freshchat] volume ignorado neste sync:", freshchatWarning);
  }

  let hubspotWarning = "";
  let hubspotAgents: AgentVolume[] = [];
  if (hubspotResult.status === "fulfilled") {
    hubspotAgents = hubspotResult.value;
  } else {
    hubspotWarning =
      hubspotResult.reason instanceof Error
        ? hubspotResult.reason.message
        : String(hubspotResult.reason);
    console.warn("[hubspot] volume ignorado neste sync:", hubspotWarning);
  }

  if (freshchatWarning && hubspotWarning) {
    return {
      success: false,
      message: `Nenhuma plataforma respondeu — nada foi gravado. Freshchat: ${freshchatWarning} | HubSpot: ${hubspotWarning}`,
      month: monthName,
      agents_synced: 0,
      agents_added_to_team: [],
      agents_removed_from_team: [],
      total_team_agents: 0,
      error: "NO_SOURCE_AVAILABLE",
    };
  }

  // Regra estrita: se nenhum nome da escala foi enviado, todos os humanos são
  // descartados e somente as linhas manuais zeradas permanecem.
  const capacity_agents = buildCapacityAgents(freshchatAgents, hubspotAgents, teamAgentNames);

  const result = await handleSyncCapacity({ capacity_agents, month: monthName });

  if (result.status !== 200 || result.data.success === false) {
    const errorMsg =
      result.data.success === false ? result.data.error : "Falha desconhecida no sync.";
    return {
      success: false,
      message: `Sincronização falhou: ${errorMsg}`,
      month: monthName,
      agents_synced: 0,
      agents_added_to_team: [],
      agents_removed_from_team: [],
      total_team_agents: 0,
      error: errorMsg,
    };
  }

  return {
    success: true,
    message:
      `Sincronização concluída: ${capacity_agents.length} agentes atualizados em "${monthName}".` +
      (freshchatWarning ? ` ATENÇÃO: volume do Freshchat NÃO entrou (${freshchatWarning}).` : "") +
      (hubspotWarning
        ? ` ATENÇÃO: volume do Helpdesk HubSpot NÃO foi somado (${hubspotWarning}).`
        : ""),
    month: monthName,
    agents_synced: capacity_agents.length,
    agents_added_to_team: result.data.agents_added_to_team,
    agents_removed_from_team: result.data.agents_removed_from_team,
    total_team_agents: result.data.total_team_agents,
  };
}
