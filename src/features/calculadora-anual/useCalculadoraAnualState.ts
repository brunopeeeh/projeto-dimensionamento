import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDimensionamento } from "@/context/DimensionamentoContext";
import { EMPTY_PLANNER_INPUTS, SCENARIO_PRESETS, clamp } from "./engine";
import type { PlannerInputs, ScenarioKey } from "./engine";
import { derivePlannerDefaults } from "./derivePlannerDefaults";
import type { PrefillSourceMap } from "./derivePlannerDefaults";

export type CalculadoraAnualSnapshot = {
  inputs: PlannerInputs;
  sources: PrefillSourceMap;
  scenarioKey: ScenarioKey;
};

export type PersistedPlan = {
  inputs: Partial<PlannerInputs>;
  sources?: PrefillSourceMap | null;
  scenarioKey?: ScenarioKey | null;
};

/** Backfill de planos salvos por versões antigas: campos ausentes vêm do preset base. */
export function migrateInputs(raw: Partial<PlannerInputs>): PlannerInputs {
  const base = structuredClone(SCENARIO_PRESETS.base);
  return {
    ...base,
    ...raw,
    rookieRampFactors: { ...base.rookieRampFactors, ...(raw.rookieRampFactors ?? {}) },
    manualGrowthByMonth: raw.manualGrowthByMonth ?? { ...base.manualGrowthByMonth },
    manualSeasonalityByMonth: raw.manualSeasonalityByMonth ?? {},
    turnoverMonths: raw.turnoverMonths ?? [...base.turnoverMonths],
  };
}

type PatchValue<K extends keyof PlannerInputs> =
  | PlannerInputs[K]
  | ((prev: PlannerInputs[K]) => PlannerInputs[K]);

const syncHeadcount = (inputs: PlannerInputs): PlannerInputs => ({
  ...inputs,
  headcountCurrent: inputs.headcountPleno + inputs.headcountNovo,
});

export function useCalculadoraAnualState() {
  const [inputs, setInputs] = useState<PlannerInputs>(() => structuredClone(EMPTY_PLANNER_INPUTS));
  const [sources, setSources] = useState<PrefillSourceMap>({});
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("base");
  const [hydrated, setHydrated] = useState(false);
  const hadSavedPlanRef = useRef(false);
  const prefillAppliedRef = useRef(false);

  const teamAgents = useDimensionamento((s) => s.teamAgents);
  const capacityAgents = useDimensionamento((s) => s.capacityAgents);
  const kpis = useDimensionamento((s) => s.kpis);
  const scenarios = useDimensionamento((s) => s.scenarios);
  const currentMonth = useDimensionamento((s) => s.currentMonth);
  const contextLoading = useDimensionamento((s) => s.isLoading);

  const applyPrefill = useCallback(() => {
    const { inputs: derived, sources: derivedSources } = derivePlannerDefaults({
      teamAgents,
      capacityAgents,
      kpis: { helpdeskVolume: kpis.helpdeskVolume },
      scenarios,
      currentMonth,
    });
    setInputs(syncHeadcount(derived));
    setSources(derivedSources);
    prefillAppliedRef.current = true;
  }, [teamAgents, capacityAgents, kpis, scenarios, currentMonth]);

  const hydrate = useCallback((saved: PersistedPlan | null) => {
    if (saved) {
      setInputs(syncHeadcount(migrateInputs(saved.inputs)));
      setSources(saved.sources ?? {});
      setScenarioKey(saved.scenarioKey ?? "base");
      hadSavedPlanRef.current = true;
      prefillAppliedRef.current = true;
    }
    setHydrated(true);
  }, []);

  // Primeiro uso (sem plano salvo): pré-preenche com os dados reais da operação
  // assim que o contexto terminar de carregar.
  useEffect(() => {
    if (hydrated && !hadSavedPlanRef.current && !prefillAppliedRef.current && !contextLoading) {
      applyPrefill();
    }
  }, [hydrated, contextLoading, applyPrefill]);

  const patch = useCallback(<K extends keyof PlannerInputs>(key: K, value: PatchValue<K>) => {
    setInputs((prev) => {
      const nextValue =
        typeof value === "function"
          ? (value as (p: PlannerInputs[K]) => PlannerInputs[K])(prev[key])
          : value;
      return syncHeadcount({ ...prev, [key]: nextValue });
    });
    // Campo editado manualmente deixa de ser "dado real/derivado"
    setSources((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const patchPercent = useCallback(
    (key: keyof PlannerInputs, value: number) => {
      patch(key, clamp(value, 0, 100) as PlannerInputs[typeof key]);
    },
    [patch],
  );

  const toggleTurnoverMonth = useCallback((monthKey: string) => {
    setInputs((prev) => ({
      ...prev,
      turnoverMonths: prev.turnoverMonths.includes(monthKey)
        ? prev.turnoverMonths.filter((m) => m !== monthKey)
        : [...prev.turnoverMonths, monthKey].sort(),
    }));
  }, []);

  const restoreBase = useCallback(() => {
    setInputs(structuredClone(SCENARIO_PRESETS.base));
    setSources({});
    setScenarioKey("base");
  }, []);

  const snapshot = useMemo<CalculadoraAnualSnapshot>(
    () => ({ inputs, sources, scenarioKey }),
    [inputs, sources, scenarioKey],
  );

  return {
    inputs,
    sources,
    scenarioKey,
    hydrated,
    snapshot,
    contextLoading,
    patch,
    patchPercent,
    toggleTurnoverMonth,
    applyPrefill,
    restoreBase,
    hydrate,
  };
}
