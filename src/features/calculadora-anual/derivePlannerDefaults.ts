import { MONTHS_PER_QUARTER } from "@/lib/constants";
import { normalizeName } from "@/lib/agents";
import type {
  TeamAgent,
  CapacityAgent,
  ScenarioParams,
  DimensionamentoKpis,
} from "@/context/types";
import { SCENARIO_PRESETS, clamp } from "./engine";
import type { PlannerInputs } from "./engine";

export type PrefillFieldSource = "real" | "derived" | "preset";
export type PrefillSourceMap = Partial<Record<keyof PlannerInputs, PrefillFieldSource>>;

export interface PrefillSource {
  teamAgents: TeamAgent[];
  capacityAgents: CapacityAgent[];
  kpis: Pick<DimensionamentoKpis, "helpdeskVolume">;
  scenarios: ScenarioParams;
  currentMonth: string; // ex: "Fevereiro 2026"
}

// O grid de volumes cobre uma semana completa (7 dias), então a conversão
// para mês usa semanas/mês — não WORKING_DAYS_PER_MONTH (que é base de dias úteis).
export const WEEKS_PER_MONTH = 52 / 12;

const FULL_MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const NON_HUMAN_CAPACITY_NAMES = new Set(["yoogasuporte", "careai", "careia"]);

const NORMALIZED_MONTH_NAMES = FULL_MONTH_NAMES.map(normalizeName);

export function parseMonthName(currentMonth: string): { month: number; year: number } | null {
  const match = currentMonth.trim().match(/^(\p{L}+)\s+(\d{4})$/u);
  if (!match) return null;
  const monthIndex = NORMALIZED_MONTH_NAMES.indexOf(normalizeName(match[1]));
  if (monthIndex === -1) return null;
  return { month: monthIndex + 1, year: Number(match[2]) };
}

export function derivePlannerDefaults(source: PrefillSource): {
  inputs: PlannerInputs;
  sources: PrefillSourceMap;
} {
  const base = SCENARIO_PRESETS.base;
  const inputs: PlannerInputs = structuredClone(base);
  const sources: PrefillSourceMap = {};

  // Período: mês corrente da operação até dezembro do mesmo ano
  const parsed = parseMonthName(source.currentMonth);
  if (parsed) {
    inputs.startMonth = parsed.month;
    inputs.startYear = parsed.year;
    inputs.endMonth = 12;
    inputs.endYear = parsed.year;
    sources.startMonth = "real";
    sources.startYear = "real";
  }

  // Headcount: equipe CLT ativa, excluindo agentes simulados da Prova Real
  const activeHumans = source.teamAgents.filter((a) => a.active && !a.isSimulated).length;
  if (activeHumans > 0) {
    inputs.headcountPleno = activeHumans;
    inputs.headcountNovo = 0;
    inputs.headcountCurrent = activeHumans;
    sources.headcountPleno = "real";
    sources.headcountNovo = "preset";
  }

  // Base de clientes e crescimento-alvo (fator do preset aplicado à base real)
  if (source.scenarios.clientBase > 0) {
    inputs.currentClients = source.scenarios.clientBase;
    inputs.targetClientsQ4 = Math.round(
      source.scenarios.clientBase * (1 + base.targetClientsGrowthPct / 100),
    );
    sources.currentClients = "real";
    sources.targetClientsQ4 = "preset";
  }

  // Volume mensal estimado a partir do grid semanal
  const weeklyVolume = source.kpis.helpdeskVolume;
  if (weeklyVolume > 0) {
    inputs.currentVolume = Math.round(weeklyVolume * WEEKS_PER_MONTH);
    sources.currentVolume = "derived";
  }

  if (source.scenarios.contactRate > 0) {
    inputs.contactRate = source.scenarios.contactRate;
    sources.contactRate = "derived";
  }

  // Produtividade: média de resolvidos/mês dos agentes humanos do capacity
  const humanCapacity = source.capacityAgents.filter(
    (ca) => !NON_HUMAN_CAPACITY_NAMES.has(normalizeName(ca.name)),
  );
  if (humanCapacity.length > 0) {
    const avgMonthly =
      humanCapacity.reduce((acc, ca) => acc + ca.mediaTri / MONTHS_PER_QUARTER, 0) /
      humanCapacity.length;
    inputs.productivityBase = Math.round(avgMonthly);
    sources.productivityBase = "derived";
  }

  // Cobertura de IA: share do Care AI sobre o total resolvido (IA + suporte humano)
  const aiRow = source.capacityAgents.find((ca) => normalizeName(ca.name) === "careai");
  const supportRow = source.capacityAgents.find((ca) => normalizeName(ca.name) === "yoogasuporte");
  if (aiRow && supportRow && aiRow.mediaTri + supportRow.mediaTri > 0) {
    inputs.aiCoveragePct = clamp(
      Math.round((aiRow.mediaTri / (aiRow.mediaTri + supportRow.mediaTri)) * 1000) / 10,
      0,
      95,
    );
    sources.aiCoveragePct = "derived";
  }

  // Turnover: taxa mensal percentual dos parâmetros operacionais
  if (source.scenarios.turnoverRate > 0) {
    inputs.turnoverValue = source.scenarios.turnoverRate;
    inputs.turnoverPeriod = "mensal";
    inputs.turnoverInputMode = "percentual";
    inputs.turnoverMonths = [];
    sources.turnoverValue = "derived";
  }

  return { inputs, sources };
}
