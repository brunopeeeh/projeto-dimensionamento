import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { isAiAgent, isSupportAgent, matchAgentName } from "@/lib/agents";
import type { TeamAgent } from "@/context/DimensionamentoContext";

/**
 * Server-only module: syncs capacity agent data from n8n to Supabase.
 *
 * Expected payload from n8n:
 * {
 *   "capacity_agents": [
 *     { "name": "Bruno Oliveira", "mediaTri": 1234 },
 *     { "name": "Care AI", "mediaTri": 14696 }
 *   ],
 *   "month": "Junho 2026"  // MANDATORY
 * }
 */

export type CapacityAgentPayload = {
  name: string;
  mediaTri: number;
};

export type SyncCapacityBody = {
  capacity_agents: CapacityAgentPayload[];
  month: string;
};

const MANUAL_CAPACITY_ROWS = ["Yooga Suporte", "Care IA"] as const;

/**
 * Freshchat/HubSpot só alimentam humanos durante a migração. As duas linhas
 * especiais são editadas na UI e devem sobreviver a qualquer sincronização.
 */
export function preserveManualCapacityAgents(
  incoming: CapacityAgentPayload[],
  persisted: CapacityAgentPayload[],
): CapacityAgentPayload[] {
  const humans = incoming.filter((agent) => !isAiAgent(agent.name) && !isSupportAgent(agent.name));

  return [
    ...humans,
    ...MANUAL_CAPACITY_ROWS.map((name) => {
      const existing = persisted.find((agent) =>
        name === "Care IA" ? isAiAgent(agent.name) : isSupportAgent(agent.name),
      );
      return { name, mediaTri: existing?.mediaTri ?? 0 };
    }),
  ];
}

type SyncResult =
  | {
      success: true;
      message: string;
      month: string;
      agents_synced: number;
      agents_added_to_team: string[];
      agents_removed_from_team: string[];
      total_team_agents: number;
    }
  | { success: false; error: string };

function getSupabaseServer() {
  const url = process.env.VITE_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
  const key = serviceKey || anonKey;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Name matching is imported from @/context/DimensionamentoContext to keep
// client and server in sync (single source of truth).

export async function handleSyncCapacity(
  body: SyncCapacityBody,
): Promise<{ status: number; data: SyncResult }> {
  // 1. Validate payload
  if (!body || !body.month || typeof body.month !== "string") {
    return {
      status: 400,
      data: {
        success: false,
        error: "O campo 'month' (mês/ano de destino, ex: 'Junho 2026') é obrigatório.",
      },
    };
  }

  if (!body.capacity_agents || !Array.isArray(body.capacity_agents)) {
    return {
      status: 400,
      data: {
        success: false,
        error:
          "Payload inválido. Esperado: { capacity_agents: [{ name: string, mediaTri: number }], month: string }",
      },
    };
  }

  for (const agent of body.capacity_agents) {
    if (typeof agent.name !== "string" || typeof agent.mediaTri !== "number") {
      return {
        status: 400,
        data: {
          success: false,
          error: `Agente inválido: ${JSON.stringify(agent)}. Cada item precisa ter "name" (string) e "mediaTri" (number).`,
        },
      };
    }
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    return {
      status: 503,
      data: {
        success: false,
        error:
          "Supabase não configurado no servidor. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
      },
    };
  }

  const targetMonth = body.month;

  // 2. Find the month ID
  const { data: monthObj, error: monthError } = await supabase
    .from("meses")
    .select("id")
    .eq("nome", targetMonth)
    .single();

  if (monthError || !monthObj) {
    return {
      status: 404,
      data: {
        success: false,
        error: `Mês "${targetMonth}" não encontrado no Supabase. Por favor, crie o mês no aplicativo antes de sincronizar.`,
      },
    };
  }

  const mesId = monthObj.id;

  // 3. Fetch current escala_equipe configuration
  const { data: escalaObj, error: escalaFetchError } = await supabase
    .from("escala_equipe")
    .select("team_agents, capacity_agents")
    .eq("mes_id", mesId)
    .maybeSingle();

  if (escalaFetchError) {
    return {
      status: 500,
      data: {
        success: false,
        error: `Erro ao buscar escala_equipe no Supabase: ${escalaFetchError.message}`,
      },
    };
  }

  const currentTeamAgents = (escalaObj?.team_agents || []) as TeamAgent[];
  const incomingAgents = preserveManualCapacityAgents(
    body.capacity_agents,
    (escalaObj?.capacity_agents || []) as CapacityAgentPayload[],
  );

  // 4. Determine agents to keep, add, or remove
  // We should NOT delete existing team agents just because they aren't in the incoming capacity list.
  // They might be inactive, managers, or not in Freshchat. We keep all existing agents.
  const keptTeamAgents = [...currentTeamAgents];

  // For logging purposes, we can consider an agent "removed from capacity" if they were in the previous capacity_agents but not the new one,
  // but we do NOT remove them from the team roster.
  const removedAgentNames: string[] = [];

  // Add: Incoming agents that do not match any team agent
  const addedAgentNames: string[] = [];
  const newTeamAgents = incomingAgents
    .filter((incoming) => !isAiAgent(incoming.name) && !isSupportAgent(incoming.name))
    .filter((incoming) => {
      return !currentTeamAgents.some((teamAgent: TeamAgent) =>
        matchAgentName(incoming.name, teamAgent.name),
      );
    })
    .map((incoming, index) => {
      addedAgentNames.push(incoming.name);
      return {
        id: `a_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 5)}`,
        name: incoming.name,
        active: true,
        schedules: {},
      };
    });

  const finalTeamAgents = [...keptTeamAgents, ...newTeamAgents];

  // 5. Update or insert the escala_equipe entry
  const { error: updateError } = await supabase.from("escala_equipe").upsert(
    {
      mes_id: mesId,
      team_agents: finalTeamAgents,
      capacity_agents: incomingAgents,
    },
    { onConflict: "mes_id" },
  );

  if (updateError) {
    return {
      status: 500,
      data: {
        success: false,
        error: `Erro ao atualizar escala_equipe no Supabase: ${updateError.message}`,
      },
    };
  }

  return {
    status: 200,
    data: {
      success: true,
      message: `Capacity de ${incomingAgents.length} agentes atualizado com sucesso para "${targetMonth}".`,
      month: targetMonth,
      agents_synced: incomingAgents.length,
      agents_added_to_team: addedAgentNames,
      agents_removed_from_team: removedAgentNames,
      total_team_agents: finalTeamAgents.length,
    },
  };
}
