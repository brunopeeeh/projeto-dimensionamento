import { describe, it, expect } from "vitest";
import {
  derivePlannerDefaults,
  parseMonthName,
  WEEKS_PER_MONTH,
  type PrefillSource,
} from "./derivePlannerDefaults";
import { SCENARIO_PRESETS } from "./engine";
import type { TeamAgent } from "@/context/types";

const makeAgent = (overrides: Partial<TeamAgent> = {}): TeamAgent => ({
  id: Math.random().toString(36).slice(2),
  name: "Agente",
  active: true,
  schedules: {},
  ...overrides,
});

const emptySource = (): PrefillSource => ({
  teamAgents: [],
  capacityAgents: [],
  kpis: { helpdeskVolume: 0 },
  scenarios: { clientBase: 0, contactRate: 0, turnoverRate: 0, slaTarget: 95 },
  currentMonth: "Fevereiro 2026",
});

describe("parseMonthName", () => {
  it("parses pt-BR month names with accents", () => {
    expect(parseMonthName("Fevereiro 2026")).toEqual({ month: 2, year: 2026 });
    expect(parseMonthName("Março 2027")).toEqual({ month: 3, year: 2027 });
    expect(parseMonthName("dezembro 2026")).toEqual({ month: 12, year: 2026 });
  });

  it("returns null for unrecognized formats", () => {
    expect(parseMonthName("2026-02")).toBeNull();
    expect(parseMonthName("Movember 2026")).toBeNull();
  });
});

describe("derivePlannerDefaults", () => {
  it("counts only active non-simulated agents as headcount", () => {
    const source = emptySource();
    source.teamAgents = [
      makeAgent(),
      makeAgent(),
      makeAgent({ active: false }),
      makeAgent({ isSimulated: true }),
    ];
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.headcountPleno).toBe(2);
    expect(inputs.headcountCurrent).toBe(2);
    expect(sources.headcountPleno).toBe("real");
  });

  it("converts the weekly grid volume to monthly", () => {
    const source = emptySource();
    source.kpis = { helpdeskVolume: 3000 };
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.currentVolume).toBe(Math.round(3000 * WEEKS_PER_MONTH));
    expect(sources.currentVolume).toBe("derived");
  });

  it("falls back to the base preset when no real data exists", () => {
    const { inputs, sources } = derivePlannerDefaults({
      ...emptySource(),
      currentMonth: "mês inválido",
    });
    expect(inputs.productivityBase).toBe(SCENARIO_PRESETS.base.productivityBase);
    expect(inputs.currentVolume).toBe(SCENARIO_PRESETS.base.currentVolume);
    expect(inputs.startMonth).toBe(SCENARIO_PRESETS.base.startMonth);
    expect(sources.productivityBase).toBeUndefined();
    expect(sources.currentVolume).toBeUndefined();
  });

  it("derives productivity from human capacity agents only", () => {
    const source = emptySource();
    source.capacityAgents = [
      { name: "Brenda", mediaTri: 900 }, // 300/mês
      { name: "Rafael", mediaTri: 1500 }, // 500/mês
      { name: "Care AI", mediaTri: 30000 },
      { name: "Yooga Suporte", mediaTri: 12000 },
    ];
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.productivityBase).toBe(400);
    expect(sources.productivityBase).toBe("derived");
  });

  it("derives AI coverage as the Care AI share of total resolution", () => {
    const source = emptySource();
    source.capacityAgents = [
      { name: "Care AI", mediaTri: 3000 },
      { name: "Yooga Suporte", mediaTri: 9000 },
    ];
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.aiCoveragePct).toBe(25);
    expect(sources.aiCoveragePct).toBe("derived");
  });

  it("maps operational scenario params to demand and turnover inputs", () => {
    const source = emptySource();
    source.scenarios = { clientBase: 3580, contactRate: 6.2, turnoverRate: 2, slaTarget: 95 };
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.currentClients).toBe(3580);
    expect(inputs.targetClientsQ4).toBe(Math.round(3580 * 1.4));
    expect(inputs.contactRate).toBe(6.2);
    expect(inputs.turnoverValue).toBe(2);
    expect(inputs.turnoverPeriod).toBe("mensal");
    expect(inputs.turnoverInputMode).toBe("percentual");
    expect(sources.currentClients).toBe("real");
    expect(sources.contactRate).toBe("derived");
  });

  it("sets the projection period from the current operational month to December", () => {
    const source = emptySource();
    source.currentMonth = "Julho 2026";
    const { inputs, sources } = derivePlannerDefaults(source);
    expect(inputs.startMonth).toBe(7);
    expect(inputs.startYear).toBe(2026);
    expect(inputs.endMonth).toBe(12);
    expect(inputs.endYear).toBe(2026);
    expect(sources.startMonth).toBe("real");
  });
});
