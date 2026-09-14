import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  loadCanonicalMonth,
  syncCanonicalAreas,
  teamAgentsSignature,
  capacitySignature,
  volumesSignature,
  newHiresSignature,
  paramsMatch,
} from "@/lib/canonical-persistence";
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

export type DirtyArea = "escala" | "volumes" | "parametros";

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

// In-memory cache of month name to month ID to avoid repeated queries to `meses`
const monthIdMap = new Map<string, string>();

export function getCachedMonthId(name: string): string | undefined {
  return monthIdMap.get(name);
}

export function setCachedMonthId(name: string, id: string): void {
  monthIdMap.set(name, id);
}

export async function resolveMonthId(client: SupabaseClient, monthName: string): Promise<string> {
  const cached = monthIdMap.get(monthName);
  if (cached) return cached;

  const { data: monthObj, error: monthError } = await client
    .from("meses")
    .select("id")
    .eq("nome", monthName)
    .single();

  if (monthError) throw monthError;
  monthIdMap.set(monthName, monthObj.id);
  return monthObj.id;
}

async function seedDefaultMonth(client: SupabaseClient, seed: SeedData) {
  const { data: newMonth, error: insertError } = await client
    .from("meses")
    .insert([{ nome: DEFAULT_MONTH_NAME }])
    .select()
    .single();

  if (insertError) throw insertError;

  const mesId = newMonth.id;
  monthIdMap.set(DEFAULT_MONTH_NAME, mesId);

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

async function upsertEscala(
  client: SupabaseClient,
  mesId: string,
  snapshot: MonthPersistenceSnapshot,
) {
  const { error } = await client.from("escala_equipe").upsert(
    {
      mes_id: mesId,
      team_agents: snapshot.teamAgents,
      capacity_agents: snapshot.capacityAgents,
    },
    { onConflict: "mes_id" },
  );
  if (error) throw error;
}

async function upsertVolumes(
  client: SupabaseClient,
  mesId: string,
  snapshot: MonthPersistenceSnapshot,
) {
  const { error } = await client.from("volumes_chamados").upsert(
    {
      mes_id: mesId,
      helpdesk_volumes: snapshot.helpdeskVolumes,
    },
    { onConflict: "mes_id" },
  );
  if (error) throw error;
}

async function upsertParametros(
  client: SupabaseClient,
  mesId: string,
  snapshot: MonthPersistenceSnapshot,
) {
  const { error } = await client.from("parametros_operacionais").upsert(
    {
      mes_id: mesId,
      tma_factors: snapshot.tmaFactors,
      simultaneous_helpdesk: snapshot.simultaneous,
      scenarios: snapshot.scenarios,
      new_hires: snapshot.newHires,
    },
    { onConflict: "mes_id" },
  );
  if (error) throw error;
}

async function saveDirtyMonthData(
  client: SupabaseClient,
  mesId: string,
  monthName: string,
  snapshot: MonthPersistenceSnapshot,
  dirtyAreas: ReadonlySet<DirtyArea>,
) {
  const promises: Promise<void>[] = [];
  if (dirtyAreas.has("escala")) promises.push(upsertEscala(client, mesId, snapshot));
  if (dirtyAreas.has("volumes")) promises.push(upsertVolumes(client, mesId, snapshot));
  if (dirtyAreas.has("parametros")) promises.push(upsertParametros(client, mesId, snapshot));

  if (promises.length > 0) {
    await Promise.all(promises);
  }

  // Dual-write do schema canônico (best-effort). O legado acima continua
  // sendo a fonte de leitura nesta fase; falha aqui não invalida o save.
  try {
    await syncCanonicalAreas(client, monthName, snapshot, dirtyAreas);
  } catch (err) {
    console.error(`Falha ao espelhar no schema canônico (${monthName}):`, err);
  }
}

export function useSupabasePersistence(
  currentMonth: string,
  isLoading: boolean,
  snapshot: MonthPersistenceSnapshot,
  setters: MonthPersistenceSetters,
  seed: SeedData,
  dirtyAreas: Set<DirtyArea>,
  clearDirtyAreas: (areas?: DirtyArea[]) => void,
) {
  const isHydratingRef = useRef(false);

  const loadMonthDataFromSupabase = useCallback(
    async (monthName: string) => {
      const client = supabase;
      if (!client) return;

      try {
        isHydratingRef.current = true;
        const mesId = await resolveMonthId(client, monthName);

        // Legado (fallback) + canônico (virada de leitura) em paralelo.
        const [escalaRes, volumesRes, paramsRes, canonical] = await Promise.all([
          client.from("escala_equipe").select("*").eq("mes_id", mesId).maybeSingle(),
          client.from("volumes_chamados").select("*").eq("mes_id", mesId).maybeSingle(),
          client.from("parametros_operacionais").select("*").eq("mes_id", mesId).maybeSingle(),
          loadCanonicalMonth(client, monthName),
        ]);

        const legacyTeamAgents = escalaRes.data?.team_agents ?? [];
        const legacyCapacityAgents = escalaRes.data?.capacity_agents ?? seed.capacityAgents;
        const legacyVolumes = volumesRes.data?.helpdesk_volumes ?? seed.helpdeskVolumes;
        const legacyTma = paramsRes.data?.tma_factors ?? DEFAULT_TMA_FACTORS;
        const legacySimultaneous =
          paramsRes.data?.simultaneous_helpdesk ?? DEFAULT_SIMULTANEOUS_HELPDESK;
        const legacyScenarios = paramsRes.data?.scenarios ?? DEFAULT_SCENARIO_PARAMS;
        const legacyNewHires = paramsRes.data?.new_hires ?? DEFAULT_NEW_HIRES;

        // Guard de paridade: o canônico só é lido quando bate com o legado.
        // Se divergiu (cliente antigo escreveu só no legado), usa o legado —
        // e o próximo save dual-write reconverge.
        const trusted = <T>(
          canonicalValue: T | null,
          legacyValue: T,
          signature: (value: T) => string,
          label: string,
        ): T => {
          if (canonicalValue === null) return legacyValue;
          if (signature(canonicalValue) === signature(legacyValue)) return canonicalValue;
          console.warn(`[canônico] ${label} divergente do legado — lendo o legado nesta carga.`);
          return legacyValue;
        };

        const paramsCanonical = paramsMatch(canonical, {
          tmaFactors: legacyTma,
          simultaneous: legacySimultaneous,
          scenarios: legacyScenarios,
        })
          ? {
              tma: canonical.tmaFactors as Record<Day, number>,
              sim: canonical.simultaneous as number,
              scen: canonical.scenarios as ScenarioParams,
            }
          : null;
        if (canonical.tmaFactors && !paramsCanonical) {
          console.warn("[canônico] parâmetros divergentes do legado — lendo o legado nesta carga.");
        }

        setters.setTeamAgents(
          trusted(canonical.teamAgents, legacyTeamAgents, teamAgentsSignature, "escala"),
        );
        setters.setCapacityAgents(
          trusted(canonical.capacityAgents, legacyCapacityAgents, capacitySignature, "capacity"),
        );
        setters.setHelpdeskVolumes(
          trusted(canonical.helpdeskVolumes, legacyVolumes, volumesSignature, "volumes"),
        );
        setters.setTmaFactors(paramsCanonical?.tma ?? legacyTma);
        setters.setSimultaneous(paramsCanonical?.sim ?? legacySimultaneous);
        setters.setScenarios(paramsCanonical?.scen ?? legacyScenarios);
        setters.setNewHires(
          trusted(canonical.newHires, legacyNewHires, newHiresSignature, "contratações"),
        );

        // Crucial: ensure freshly loaded data is not marked dirty
        clearDirtyAreas();
      } catch (err) {
        console.error(`Failed to load data for month ${monthName}:`, err);
      } finally {
        isHydratingRef.current = false;
      }
    },
    [setters, seed.helpdeskVolumes, seed.capacityAgents, clearDirtyAreas],
  );

  const saveMonthDataToSupabase = useCallback(
    async (monthName: string, areasToSave?: ReadonlySet<DirtyArea>) => {
      const client = supabase;
      if (!client) return;

      const areas = areasToSave ?? new Set<DirtyArea>(["escala", "volumes", "parametros"]);
      if (areas.size === 0) {
        return;
      }

      try {
        const mesId = await resolveMonthId(client, monthName);
        await saveDirtyMonthData(client, mesId, monthName, snapshot, areas);
        clearDirtyAreas(Array.from(areas));
        console.log(`Successfully saved [${Array.from(areas).join(", ")}] for month ${monthName}.`);
      } catch (err) {
        console.error(`Failed to save data for month ${monthName}:`, err);
        throw err;
      }
    },
    [snapshot, clearDirtyAreas],
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
        isHydratingRef.current = true;
        const { data: monthsData, error: monthsError } = await client
          .from("meses")
          .select("id, nome")
          .order("created_at", { ascending: true });

        if (monthsError) throw monthsError;

        monthsData?.forEach((m: { id: string; nome: string }) => {
          monthIdMap.set(m.nome, m.id);
        });

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
        isHydratingRef.current = false;
        clearDirtyAreas();
      }
    }

    initSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    const client = supabase;
    // Don't auto-save if offline, loading, hydrating or nothing is dirty
    if (!client || isLoading || isHydratingRef.current || dirtyAreas.size === 0) return;

    const areasToSave = new Set(dirtyAreas);

    const delayDebounce = setTimeout(async () => {
      try {
        setters.setSaveStatus("saving");
        const mesId = await resolveMonthId(client, currentMonth);
        await saveDirtyMonthData(client, mesId, currentMonth, snapshot, areasToSave);
        clearDirtyAreas(Array.from(areasToSave));
        setters.setSaveStatus("saved");
      } catch (err) {
        console.error("Auto-save failed:", err);
        setters.setSaveStatus("error");
      }
    }, 1000);

    return () => clearTimeout(delayDebounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, isLoading, snapshot, dirtyAreas]);

  return { loadMonthDataFromSupabase, saveMonthDataToSupabase };
}
