import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  DEFAULT_SIMULTANEOUS_HELPDESK,
  DEFAULT_SCENARIO_PARAMS,
  DEFAULT_MONTH_NAME,
  DEFAULT_MONTHS,
  DEFAULT_TMA_FACTORS,
  DEFAULT_NEW_HIRES,
} from "@/lib/constants";
import type {
  Day,
  TeamAgent,
  NewAgentHire,
  CapacityAgent,
  ScenarioParams,
  SaveStatus,
} from "@/context/types";

const INITIAL_TEAM_AGENTS: TeamAgent[] = [];

export type MonthPersistenceSnapshot = {
  teamAgents: TeamAgent[];
  capacityAgents: CapacityAgent[];
  helpdeskVolumes: Record<string, Record<Day, number>>;
  tmaFactors: Record<Day, number>;
  simultaneous: number;
  scenarios: ScenarioParams;
  newHires: NewAgentHire[];
};

type MonthPersistenceSetters = {
  setTeamAgents: Dispatch<SetStateAction<TeamAgent[]>>;
  setCapacityAgents: Dispatch<SetStateAction<CapacityAgent[]>>;
  setHelpdeskVolumes: Dispatch<SetStateAction<Record<string, Record<Day, number>>>>;
  setTmaFactors: Dispatch<SetStateAction<Record<Day, number>>>;
  setSimultaneous: Dispatch<SetStateAction<number>>;
  setScenarios: Dispatch<SetStateAction<ScenarioParams>>;
  setNewHires: Dispatch<SetStateAction<NewAgentHire[]>>;
  setAvailableMonths: Dispatch<SetStateAction<string[]>>;
  setCurrentMonth: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
};

type SeedData = {
  helpdeskVolumes: Record<string, Record<Day, number>>;
  capacityAgents: CapacityAgent[];
};

async function seedDefaultMonth(client: SupabaseClient, seed: SeedData) {
  const { data: newMonth, error: insertError } = await client
    .from("meses")
    .insert([{ nome: DEFAULT_MONTH_NAME }])
    .select()
    .single();

  if (insertError) throw insertError;

  const mesId = newMonth.id;

  await Promise.all([
    client.from("escala_equipe").insert([
      {
        mes_id: mesId,
        team_agents: INITIAL_TEAM_AGENTS,
        capacity_agents: seed.capacityAgents,
      },
    ]),
    client.from("volumes_chamados").insert([
      {
        mes_id: mesId,
        helpdesk_volumes: seed.helpdeskVolumes,
      },
    ]),
    client.from("parametros_operacionais").insert([
      {
        mes_id: mesId,
        tma_factors: DEFAULT_TMA_FACTORS,
        simultaneous_helpdesk: DEFAULT_SIMULTANEOUS_HELPDESK,
        scenarios: DEFAULT_SCENARIO_PARAMS,
        new_hires: DEFAULT_NEW_HIRES,
      },
    ]),
  ]);

  return DEFAULT_MONTHS;
}

async function upsertMonthData(
  client: SupabaseClient,
  mesId: string,
  snapshot: MonthPersistenceSnapshot,
) {
  await Promise.all([
    client.from("escala_equipe").upsert(
      {
        mes_id: mesId,
        team_agents: snapshot.teamAgents,
        capacity_agents: snapshot.capacityAgents,
      },
      { onConflict: "mes_id" },
    ),
    client.from("volumes_chamados").upsert(
      {
        mes_id: mesId,
        helpdesk_volumes: snapshot.helpdeskVolumes,
      },
      { onConflict: "mes_id" },
    ),
    client.from("parametros_operacionais").upsert(
      {
        mes_id: mesId,
        tma_factors: snapshot.tmaFactors,
        simultaneous_helpdesk: snapshot.simultaneous,
        scenarios: snapshot.scenarios,
        new_hires: snapshot.newHires,
      },
      { onConflict: "mes_id" },
    ),
  ]);
}

export function useSupabasePersistence(
  currentMonth: string,
  isLoading: boolean,
  snapshot: MonthPersistenceSnapshot,
  setters: MonthPersistenceSetters,
  seed: SeedData,
) {
  const loadMonthDataFromSupabase = useCallback(
    async (monthName: string) => {
      const client = supabase;
      if (!client) return;

      try {
        const { data: monthObj, error: monthError } = await client
          .from("meses")
          .select("id")
          .eq("nome", monthName)
          .single();

        if (monthError) throw monthError;
        const mesId = monthObj.id;

        const [escalaRes, volumesRes, paramsRes] = await Promise.all([
          client.from("escala_equipe").select("*").eq("mes_id", mesId).maybeSingle(),
          client.from("volumes_chamados").select("*").eq("mes_id", mesId).maybeSingle(),
          client.from("parametros_operacionais").select("*").eq("mes_id", mesId).maybeSingle(),
        ]);

        if (escalaRes.data) {
          setters.setTeamAgents(escalaRes.data.team_agents);
          setters.setCapacityAgents(escalaRes.data.capacity_agents);
        }
        if (volumesRes.data) {
          setters.setHelpdeskVolumes(volumesRes.data.helpdesk_volumes ?? seed.helpdeskVolumes);
        }
        if (paramsRes.data) {
          setters.setTmaFactors(paramsRes.data.tma_factors);
          setters.setSimultaneous(paramsRes.data.simultaneous_helpdesk);
          setters.setScenarios(paramsRes.data.scenarios);
          setters.setNewHires(paramsRes.data.new_hires);
        }
      } catch (err) {
        console.error(`Failed to load data for month ${monthName}:`, err);
      }
    },
    [setters],
  );

  const saveMonthDataToSupabase = useCallback(
    async (monthName: string) => {
      const client = supabase;
      if (!client) return;

      try {
        const { data: monthObj, error: monthError } = await client
          .from("meses")
          .select("id")
          .eq("nome", monthName)
          .single();

        if (monthError) throw monthError;
        await upsertMonthData(client, monthObj.id, snapshot);
        console.log(`Successfully saved data for month ${monthName} before switching.`);
      } catch (err) {
        console.error(`Failed to save data for month ${monthName}:`, err);
      }
    },
    [snapshot],
  );

  useEffect(() => {
    async function initSupabase() {
      const client = supabase;
      if (!client) {
        setters.setIsLoading(false);
        return;
      }

      try {
        setters.setIsLoading(true);
        const { data: monthsData, error: monthsError } = await client
          .from("meses")
          .select("*")
          .order("created_at", { ascending: true });

        if (monthsError) throw monthsError;

        let monthsList = monthsData.map((m: { nome: string }) => m.nome);

        if (monthsList.length === 0) {
          monthsList = await seedDefaultMonth(client, seed);
        }

        setters.setAvailableMonths(monthsList);
        const targetMonth = monthsList[monthsList.length - 1];
        setters.setCurrentMonth(targetMonth);
        await loadMonthDataFromSupabase(targetMonth);
      } catch (err) {
        console.error("Failed to initialize Supabase:", err);
      } finally {
        setters.setIsLoading(false);
      }
    }

    initSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || isLoading) return;

    const delayDebounce = setTimeout(async () => {
      try {
        setters.setSaveStatus("saving");
        const { data: monthObj, error: monthError } = await client
          .from("meses")
          .select("id")
          .eq("nome", currentMonth)
          .single();

        if (monthError) throw monthError;
        await upsertMonthData(client, monthObj.id, snapshot);
        setters.setSaveStatus("saved");
      } catch (err) {
        console.error("Auto-save failed:", err);
        setters.setSaveStatus("error");
      }
    }, 1000);

    return () => clearTimeout(delayDebounce);
    // setters.* are stable React dispatchers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, isLoading, snapshot]);

  return { loadMonthDataFromSupabase, saveMonthDataToSupabase };
}
