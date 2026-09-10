import React, { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { matchAgentName } from "@/lib/agents";
import { computeDynamicTmaFactors, computeGridCalculations } from "@/lib/calculations";
import {
  DEFAULT_SIMULTANEOUS_HELPDESK,
  DEFAULT_SCENARIO_PARAMS,
  DEFAULT_MONTH_NAME,
  DEFAULT_MONTHS,
  DEFAULT_TMA_FACTORS,
  DEFAULT_NEW_HIRES,
} from "@/lib/constants";
import { useSupabasePersistence } from "@/hooks/useSupabasePersistence";
import { useInitialData } from "./useInitialData";
import { useScheduleActions } from "./useScheduleActions";
import { useDataImport } from "./useDataImport";
import { useMonthActions } from "./useMonthActions";
import {
  DAYS,
  type Day,
  type TeamAgent,
  type NewAgentHire,
  type CapacityAgent,
  type SaveStatus,
  type ScenarioParams,
  type DimensionamentoState,
} from "./types";

export { normalizeName, matchAgentName } from "@/lib/agents";
export { getLunchEndTime } from "@/lib/time";
export type {
  Day,
  IntervalStatus,
  AgentSchedule,
  TeamAgent,
  NewAgentHire,
  CapacityAgent,
  SaveStatus,
  ScenarioParams,
  RowCalculation,
  DimensionamentoState,
} from "./types";
export { DAYS } from "./types";

import { createStore, useStore, type StoreApi } from "zustand";

const DimensionamentoStoreContext = createContext<StoreApi<DimensionamentoState> | undefined>(
  undefined,
);

export const DimensionamentoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { timeBlocks, initialData, initialCapacityAgents } = useInitialData();

  const [currentMonth, setCurrentMonth] = useState<string>(DEFAULT_MONTH_NAME);
  const [availableMonths, setAvailableMonths] = useState<string[]>(DEFAULT_MONTHS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);

  const [helpdeskVolumes, setHelpdeskVolumes] = useState(initialData.helpdeskVolumes);

  const [capacityAgents, setCapacityAgents] = useState<CapacityAgent[]>(() => {
    try {
      const saved = !supabase ? localStorage.getItem("yooga_capacity_agents") : null;
      return saved ? JSON.parse(saved) : initialCapacityAgents;
    } catch {
      return initialCapacityAgents;
    }
  });

  const [tmaFactors, setTmaFactors] = useState<Record<Day, number>>(DEFAULT_TMA_FACTORS);
  const [simultaneous, setSimultaneous] = useState(DEFAULT_SIMULTANEOUS_HELPDESK);

  const [teamAgents, setTeamAgents] = useState<TeamAgent[]>(() => {
    try {
      const saved = !supabase ? localStorage.getItem("yooga_team_agents") : null;
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [scenarios, setScenarios] = useState<ScenarioParams>(DEFAULT_SCENARIO_PARAMS);

  const [newHires, setNewHires] = useState<NewAgentHire[]>(DEFAULT_NEW_HIRES);

  // ---- localStorage persistence (no Supabase) ----
  useEffect(() => {
    if (supabase) return;
    try {
      localStorage.setItem("yooga_team_agents", JSON.stringify(teamAgents));
    } catch (e) {
      console.error("Error saving team agents to localStorage:", e);
    }
  }, [teamAgents]);

  useEffect(() => {
    if (supabase) return;
    try {
      localStorage.setItem("yooga_capacity_agents", JSON.stringify(capacityAgents));
    } catch (e) {
      console.error("Error saving capacity agents to localStorage:", e);
    }
  }, [capacityAgents]);

  // ---- Supabase persistence snapshot ----
  const persistenceSnapshot = useMemo(
    () => ({
      teamAgents,
      capacityAgents,
      helpdeskVolumes,
      tmaFactors,
      simultaneous,
      scenarios,
      newHires,
    }),
    [teamAgents, capacityAgents, helpdeskVolumes, tmaFactors, simultaneous, scenarios, newHires],
  );

  const persistenceSetters = useMemo(
    () => ({
      setTeamAgents,
      setCapacityAgents,
      setHelpdeskVolumes,
      setTmaFactors,
      setSimultaneous,
      setScenarios,
      setNewHires,
      setAvailableMonths,
      setCurrentMonth,
      setIsLoading,
      setSaveStatus,
    }),
    [],
  );

  const { loadMonthDataFromSupabase, saveMonthDataToSupabase } = useSupabasePersistence(
    currentMonth,
    isLoading,
    persistenceSnapshot,
    persistenceSetters,
    {
      helpdeskVolumes: initialData.helpdeskVolumes,
      capacityAgents: initialCapacityAgents,
    },
  );

  // ---- Simple state updaters ----
  const updateTimeBlockVolume = (time: string, day: Day, value: number) => {
    setHelpdeskVolumes((prev) => ({
      ...prev,
      [time]: {
        ...prev[time],
        [day]: Math.max(0, value),
      },
    }));
  };

  const updateTmaFactor = (day: Day, value: number) => {
    setTmaFactors((prev) => ({
      ...prev,
      [day]: Math.max(0.1, value),
    }));
  };

  const updateSimultaneous = (value: number) => {
    setSimultaneous(Math.max(1, value));
  };

  const updateScenario = (key: keyof ScenarioParams, value: number) => {
    setScenarios((prev) => ({
      ...prev,
      [key]: Math.max(0, value),
    }));
  };

  const toggleAgentActive = (agentId: string) => {
    setTeamAgents((prev) =>
      prev.map((agent) => (agent.id === agentId ? { ...agent, active: !agent.active } : agent)),
    );
  };

  const addTeamAgent = (name: string) => {
    const newAgent: TeamAgent = {
      id: "a_" + Date.now(),
      name,
      active: true,
      schedules: {},
    };
    setTeamAgents((prev) => [...prev, newAgent]);
  };

  const removeTeamAgent = (agentId: string) => {
    setTeamAgents((prev) => prev.filter((agent) => agent.id !== agentId));
  };

  const updateTeamAgentName = (agentId: string, newName: string) => {
    let oldName = "";
    setTeamAgents((prev) =>
      prev.map((agent) => {
        if (agent.id === agentId) {
          oldName = agent.name;
          return { ...agent, name: newName };
        }
        return agent;
      }),
    );

    if (oldName) {
      setCapacityAgents((prev) =>
        prev.map((ca) => (matchAgentName(ca.name, oldName) ? { ...ca, name: newName } : ca)),
      );
    }
  };

  const updateCapacityAgent = (name: string, value: number) => {
    setCapacityAgents((prev) => {
      const index = prev.findIndex((a) => matchAgentName(a.name, name));
      if (index !== -1) {
        const updated = [...prev];
        updated[index] = { ...updated[index], mediaTri: Math.max(0, value) };
        return updated;
      }
      return [...prev, { name, mediaTri: Math.max(0, value) }];
    });
  };

  const resetAll = () => {
    setIsResetConfirmOpen(true);
  };

  const executeResetAll = async () => {
    setIsResetConfirmOpen(false);
    setIsLoading(true);

    const client = supabase;
    if (!client) {
      setIsLoading(false);
      return;
    }

    try {
      const { data: monthObj, error: monthError } = await client
        .from("meses")
        .select("id")
        .eq("nome", currentMonth)
        .single();

      if (monthError) throw monthError;
      const mesId = monthObj.id;

      // Upsert default reset values to Supabase
      await Promise.all([
        client.from("escala_equipe").upsert(
          {
            mes_id: mesId,
            team_agents: [],
            capacity_agents: initialCapacityAgents,
          },
          { onConflict: "mes_id" },
        ),
        client.from("volumes_chamados").upsert(
          {
            mes_id: mesId,
            helpdesk_volumes: initialData.helpdeskVolumes,
          },
          { onConflict: "mes_id" },
        ),
        client.from("parametros_operacionais").upsert(
          {
            mes_id: mesId,
            tma_factors: DEFAULT_TMA_FACTORS,
            simultaneous_helpdesk: DEFAULT_SIMULTANEOUS_HELPDESK,
            scenarios: DEFAULT_SCENARIO_PARAMS,
            new_hires: DEFAULT_NEW_HIRES,
          },
          { onConflict: "mes_id" },
        ),
      ]);

      // Update React state after database confirmation
      setHelpdeskVolumes(initialData.helpdeskVolumes);
      setTeamAgents([]);
      setTmaFactors(DEFAULT_TMA_FACTORS);
      setCapacityAgents(initialCapacityAgents);
      setSimultaneous(DEFAULT_SIMULTANEOUS_HELPDESK);
      setScenarios(DEFAULT_SCENARIO_PARAMS);
      setNewHires(DEFAULT_NEW_HIRES);

      toast.success("Valores restaurados com sucesso!");
    } catch (err) {
      console.error("Erro ao restaurar valores padrão:", err);
      toast.error("Erro ao restaurar valores. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  // ---- Schedule actions (extracted hook) ----
  const newHiresRef = useRef(newHires);
  newHiresRef.current = newHires;

  const { toggleIntervalStatus, applyPresetShift } = useScheduleActions(
    setTeamAgents,
    setNewHires,
    () => newHiresRef.current,
  );

  // ---- Data import (extracted hook) ----
  const { importPowerBIData, updateHelpdeskVolumes } = useDataImport(setHelpdeskVolumes);

  // ---- Month management (extracted hook) ----
  const createMonthSnapshotRef = useRef({
    timeBlocks,
    currentMonth: "",
    teamAgents,
    capacityAgents,
    tmaFactors,
    simultaneous,
    scenarios,
    newHires,
  });
  createMonthSnapshotRef.current = {
    timeBlocks,
    currentMonth,
    teamAgents,
    capacityAgents,
    tmaFactors,
    simultaneous,
    scenarios,
    newHires,
  };

  const { changeActiveMonth, createNewMonth, refreshCurrentMonth } = useMonthActions(
    setAvailableMonths,
    setCurrentMonth,
    setHelpdeskVolumes,
    setIsLoading,
    saveMonthDataToSupabase,
    loadMonthDataFromSupabase,
    () => createMonthSnapshotRef.current,
  );

  // ---- Calculations (memoized from extracted lib) ----
  const dynamicTmaFactors = useMemo(
    () => computeDynamicTmaFactors(DAYS, teamAgents, capacityAgents),
    [teamAgents, capacityAgents],
  );

  const { rowCalculations, totals, kpis } = useMemo(
    () =>
      computeGridCalculations({
        days: DAYS,
        timeBlocks,
        helpdeskVolumes,
        teamAgents,
        dynamicTmaFactors,
        simultaneous,
        newHires,
      }),
    [timeBlocks, helpdeskVolumes, teamAgents, dynamicTmaFactors, simultaneous, newHires],
  );

  // ---- Stable action references ----
  const actionsRef = useRef({
    changeActiveMonth,
    createNewMonth,
    refreshCurrentMonth,
    updateTimeBlockVolume,
    updateTmaFactor,
    updateSimultaneous,
    toggleIntervalStatus,
    applyPresetShift,
    toggleAgentActive,
    addTeamAgent,
    removeTeamAgent,
    updateTeamAgentName,
    updateScenario,
    updateCapacityAgent,
    resetAll,
    executeResetAll,
    importPowerBIData,
    updateHelpdeskVolumes,
  });
  actionsRef.current = {
    changeActiveMonth,
    createNewMonth,
    refreshCurrentMonth,
    updateTimeBlockVolume,
    updateTmaFactor,
    updateSimultaneous,
    toggleIntervalStatus,
    applyPresetShift,
    toggleAgentActive,
    addTeamAgent,
    removeTeamAgent,
    updateTeamAgentName,
    updateScenario,
    updateCapacityAgent,
    resetAll,
    executeResetAll,
    importPowerBIData,
    updateHelpdeskVolumes,
  };

  const stableActions = useMemo(
    () => ({
      changeActiveMonth: (monthName: string) => actionsRef.current.changeActiveMonth(monthName),
      createNewMonth: (newMonthName: string) => actionsRef.current.createNewMonth(newMonthName),
      refreshCurrentMonth: () => actionsRef.current.refreshCurrentMonth(),
      updateTimeBlockVolume: (time: string, day: Day, value: number) =>
        actionsRef.current.updateTimeBlockVolume(time, day, value),
      updateTmaFactor: (day: Day, value: number) => actionsRef.current.updateTmaFactor(day, value),
      updateSimultaneous: (value: number) => actionsRef.current.updateSimultaneous(value),
      toggleIntervalStatus: (agentId: string, day: Day, time20: string) =>
        actionsRef.current.toggleIntervalStatus(agentId, day, time20),
      applyPresetShift: (
        agentId: string,
        day: Day,
        start: string,
        end: string,
        lunchStart: string,
        externalStart?: string,
        externalDurationMin?: number,
      ) =>
        actionsRef.current.applyPresetShift(
          agentId,
          day,
          start,
          end,
          lunchStart,
          externalStart,
          externalDurationMin,
        ),
      toggleAgentActive: (agentId: string) => actionsRef.current.toggleAgentActive(agentId),
      addTeamAgent: (name: string) => actionsRef.current.addTeamAgent(name),
      removeTeamAgent: (agentId: string) => actionsRef.current.removeTeamAgent(agentId),
      updateTeamAgentName: (agentId: string, newName: string) =>
        actionsRef.current.updateTeamAgentName(agentId, newName),
      updateScenario: (key: keyof ScenarioParams, value: number) =>
        actionsRef.current.updateScenario(key, value),
      updateCapacityAgent: (name: string, value: number) =>
        actionsRef.current.updateCapacityAgent(name, value),
      resetAll: () => actionsRef.current.resetAll(),
      executeResetAll: () => actionsRef.current.executeResetAll(),
      importPowerBIData: (helpdeskCsv: string) => actionsRef.current.importPowerBIData(helpdeskCsv),
      updateHelpdeskVolumes: (newVolumes: Record<string, Record<Day, number>>) =>
        actionsRef.current.updateHelpdeskVolumes(newVolumes),
    }),
    [],
  );

  const contextValue = useMemo<DimensionamentoState>(
    () => ({
      rowCalculations,
      totals,
      kpis,
      timeBlocks,
      helpdeskVolumes,
      tmaFactors: dynamicTmaFactors,
      simultaneous,
      teamAgents,
      newHires,
      scenarios,
      capacityAgents,
      currentMonth,
      availableMonths,
      isLoading,
      saveStatus,
      isReadOnly,
      setIsReadOnly,
      isResetConfirmOpen,
      setIsResetConfirmOpen,
      ...stableActions,
      setTeamAgents,
      setNewHires,
    }),
    [
      rowCalculations,
      totals,
      kpis,
      timeBlocks,
      helpdeskVolumes,
      dynamicTmaFactors,
      simultaneous,
      teamAgents,
      newHires,
      scenarios,
      capacityAgents,
      currentMonth,
      availableMonths,
      isLoading,
      saveStatus,
      isReadOnly,
      isResetConfirmOpen,
      stableActions,
    ],
  );

  const storeRef = useRef<StoreApi<DimensionamentoState>>(null!);
  if (!storeRef.current) {
    storeRef.current = createStore<DimensionamentoState>()(() => contextValue);
  }

  // Sync React state to Zustand store synchronously
  React.useLayoutEffect(() => {
    storeRef.current.setState(contextValue);
  }, [contextValue]);

  return (
    <DimensionamentoStoreContext.Provider value={storeRef.current}>
      {children}
    </DimensionamentoStoreContext.Provider>
  );
};

export function useDimensionamento<T>(selector: (state: DimensionamentoState) => T): T;
export function useDimensionamento(): DimensionamentoState;
export function useDimensionamento<T>(selector?: (state: DimensionamentoState) => T) {
  const store = useContext(DimensionamentoStoreContext);
  if (!store) {
    throw new Error("useDimensionamento must be used within a DimensionamentoProvider");
  }
  return useStore(store, selector!);
}
