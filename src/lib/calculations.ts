import {
  findAiAgent,
  findSupportAgent,
  matchAgentName,
  isAiAgent,
  isSupportAgent,
} from "@/lib/agents";
import { toBlock20, isTimeInShift, getLunchEndTime } from "@/lib/time";
import {
  FIXED_OVERNIGHT_AGENTS,
  hasFixedOvernightCoverage,
  isHelpdeskOpen,
} from "@/lib/operating-hours";
import {
  DEFAULT_MEDIA_TRI,
  MONTHS_PER_QUARTER,
  WORKING_DAYS_PER_MONTH,
  HOURS_PER_SHIFT,
  BLOCKS_10MIN_PER_HOUR,
  DAYS_PER_WEEK,
  DEFAULT_SIMULTANEOUS_HELPDESK,
} from "@/lib/constants";
import type { Day, TeamAgent, NewAgentHire, CapacityAgent, RowCalculation } from "@/context/types";

export type DayTotals = {
  volume: number;
  capacity: number;
  deficit10: number;
  prCapacity: number;
  prDeficit10: number;
};

export type DimensionamentoKpis = {
  helpdeskVolume: number;
  helpdeskCapacity: number;
  totalDeficit10: number;
  provaRealDeficit10: number;
  picoMaximo: { day: string; time: string; deficit: number };
  coberturaProjetada: number;
};

export type GridCalculationResult = {
  rowCalculations: RowCalculation[];
  totals: Record<Day, DayTotals>;
  kpis: DimensionamentoKpis;
};

const DAY_COUNT = DAYS_PER_WEEK;

function emptyDayArrays(): Pick<
  RowCalculation,
  | "volume"
  | "capacity"
  | "capacityR"
  | "resultado"
  | "faltam10"
  | "prCapacity"
  | "prCapacityR"
  | "prResultado"
  | "prFaltam10"
> {
  const zeros = () => Array<number>(DAY_COUNT).fill(0);
  return {
    volume: zeros(),
    capacity: zeros(),
    capacityR: zeros(),
    resultado: zeros(),
    faltam10: zeros(),
    prCapacity: zeros(),
    prCapacityR: zeros(),
    prResultado: zeros(),
    prFaltam10: zeros(),
  };
}

function createEmptyRowCalculation(time: string): RowCalculation {
  return {
    time,
    ...emptyDayArrays(),
  };
}

function deriveResolvidos10(mediaTri: number): number {
  const mediaMes = mediaTri / MONTHS_PER_QUARTER;
  const resolvidosDia = mediaMes / WORKING_DAYS_PER_MONTH;
  const resolvidosHora = resolvidosDia / HOURS_PER_SHIFT;
  return resolvidosHora / BLOCKS_10MIN_PER_HOUR;
}

function isAgentScheduledOnDay(agent: TeamAgent, day: Day): boolean {
  if (!agent.active || !agent.schedules[day]) return false;
  return Object.values(agent.schedules[day]!.intervals).some(
    (s) => s === "trabalhando" || s === "externo" || s === "pausa",
  );
}

export type CapacityContributions = { ai: number; support: number; supportSeats: number };

/**
 * Contribuições por bloco usadas no Capacity médio.
 * - A Care IA calcula como um humano (20 dias e 8h diárias, base deriveResolvidos10).
 *   Quando ativa (active !== false) e com mediaTri > 0, soma ao volume resolvido sem
 *   adicionar assento ao divisor. Se inativa ou zerada, contribui com 0.
 * - O Yooga Suporte representa uma posição agregada (supervisores + N2), então
 *   entra no volume e soma 1 ao divisor.
 */
export function computeCapacityContributions(
  capacityAgents: CapacityAgent[],
): CapacityContributions {
  const ai = findAiAgent(capacityAgents);
  const support = findSupportAgent(capacityAgents);

  const isAiActive = ai?.active !== false;
  const aiRate = ai && isAiActive ? deriveResolvidos10(ai.mediaTri) : 0;
  const supportRate = support ? deriveResolvidos10(support.mediaTri) : 0;

  return { ai: aiRate, support: supportRate, supportSeats: support ? 1 : 0 };
}

export function computeAverageCapacity(totalResolved: number, operationalSeats: number): number {
  const value = totalResolved / Math.max(operationalSeats, 1);
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

/**
 * Capacity médio por dia em blocos de 10min:
 * (volume dos humanos + Yooga Suporte + Care IA [se ativa]) / (humanos + 1 Yooga Suporte).
 * A Care IA nunca soma uma posição ao divisor.
 */
export function computeDynamicTmaFactors(
  days: readonly Day[],
  teamAgents: TeamAgent[],
  capacityAgents: CapacityAgent[],
): Record<Day, number> {
  const factors = {} as Record<Day, number>;

  // IA e Yooga Suporte podem constar no roster (ex.: adicionados pelo sync),
  // mas nunca contam como agentes humanos escalados.
  const humanTeamAgents = teamAgents.filter(
    (agent) => !isAiAgent(agent.name) && !isSupportAgent(agent.name),
  );
  const contributions = computeCapacityContributions(capacityAgents);

  days.forEach((day) => {
    const scheduledHumans = humanTeamAgents.filter(
      (agent) => agent.active && isAgentScheduledOnDay(agent, day),
    );

    const humanSum = scheduledHumans.reduce((sum, agent) => {
      const capMatch = capacityAgents.find((ca) => matchAgentName(ca.name, agent.name));
      const mediaTri = capMatch ? capMatch.mediaTri : DEFAULT_MEDIA_TRI;
      return sum + deriveResolvidos10(mediaTri);
    }, 0);

    const totalResolved = humanSum + contributions.support + contributions.ai;
    const divisor = scheduledHumans.length + contributions.supportSeats;
    factors[day] = computeAverageCapacity(totalResolved, divisor);
  });

  return factors;
}

function excelRoundUp(val: number): number {
  if (val === 0) return 0;
  return val > 0 ? Math.ceil(val) : Math.floor(val);
}

/**
 * Chamados que UM agente resolve num bloco de 10min.
 *
 * Unidade única do dimensionamento: é ela que multiplica os agentes escalados
 * pra virar capacidade E que divide o déficit pra virar "agentes que faltam".
 * Antes eram duas unidades diferentes (capacidade por `factor`, déficit por
 * `simultaneous`), então contratar o que o painel pedia não zerava o déficit —
 * subestimava em `simultaneous / factor` (~1,8x com os fatores atuais).
 *
 * `factor` vem do histórico de resolvidos (mediaTri), medido com a equipe
 * operando no padrão de `DEFAULT_SIMULTANEOUS_HELPDESK` simultâneos. Mexer no
 * knob de simultâneos escala a capacidade na mesma proporção, como manda a
 * fórmula da doc: capacidade unitária = (10min / TMA) × simultâneos.
 */
export function capacityPerAgent(factor: number, simultaneous: number): number {
  const perAgent = factor * (simultaneous / DEFAULT_SIMULTANEOUS_HELPDESK);
  // Config degenerada (todo mediaTri zerado): agente nenhum resolve nada e a
  // divisão explodiria. Cai pra 1 chamado/agente — número alto e visível, em
  // vez de Infinity na tela ou um zero que esconde o déficit.
  return perAgent > 0 ? perAgent : 1;
}

export function computeGridCalculations(params: {
  days: readonly Day[];
  timeBlocks: string[];
  helpdeskVolumes: Record<string, Record<Day, number>>;
  teamAgents: TeamAgent[];
  dynamicTmaFactors: Record<Day, number>;
  simultaneous: number;
  newHires: NewAgentHire[];
}): GridCalculationResult {
  const {
    days,
    timeBlocks,
    helpdeskVolumes,
    teamAgents,
    dynamicTmaFactors,
    simultaneous,
    newHires,
  } = params;

  // O fator diário já contém o volume de Yooga Suporte. Na grade,
  // contam somente humanos com status "trabalhando" na faixa da escala.
  const humanTeamAgents = teamAgents.filter(
    (agent) => !isAiAgent(agent.name) && !isSupportAgent(agent.name),
  );

  let totalVolume = 0;
  let totalCapacity = 0;
  let totalDeficit10 = 0;
  let totalPrDeficit10 = 0;
  let totalDeficitChats = 0;

  let maxDeficit = 0;
  let maxDeficitDay = "Segunda";
  let maxDeficitTime = "00:00";

  const computedTotals = {} as Record<Day, DayTotals>;
  days.forEach((day) => {
    computedTotals[day] = {
      volume: 0,
      capacity: 0,
      deficit10: 0,
      prCapacity: 0,
      prDeficit10: 0,
    };
  });

  const list: RowCalculation[] = timeBlocks.map((time) => {
    const rowResult = createEmptyRowCalculation(time);

    days.forEach((day) => {
      if (!isHelpdeskOpen(day, time)) return;

      const perAgent = capacityPerAgent(dynamicTmaFactors[day], simultaneous);

      const vol = helpdeskVolumes[time]?.[day] ?? 0;
      const time20 = toBlock20(time);

      const agentsSch = humanTeamAgents.reduce((count, agent) => {
        if (agent.active && agent.schedules[day]) {
          const status = agent.schedules[day]!.intervals[time20] || "folga";
          if (status === "trabalhando") {
            return count + 1;
          }
        }
        return count;
      }, 0);

      const capRaw = agentsSch * perAgent;
      const capRounded = Math.ceil(capRaw);
      const surplus = capRounded - vol;

      const fixedOvernightCoverage = hasFixedOvernightCoverage(day, time);
      const deficitChats = fixedOvernightCoverage ? 0 : Math.max(0, vol - capRounded);
      const faltam10 = fixedOvernightCoverage
        ? FIXED_OVERNIGHT_AGENTS - agentsSch
        : excelRoundUp(surplus / -perAgent);

      const activeNewHires = newHires.reduce((count, hire) => {
        if (hire.active) {
          if (hire.schedules && hire.schedules[day]) {
            const status = hire.schedules[day]!.intervals[time20] || "folga";
            if (status === "trabalhando") {
              return count + 1;
            }
            return count;
          }

          if (hire.days.includes(day)) {
            const inShift = isTimeInShift(time, hire.start_time, hire.end_time);
            const inLunch =
              hire.lunch_start_time &&
              isTimeInShift(time, hire.lunch_start_time, getLunchEndTime(hire.lunch_start_time));
            if (inShift && !inLunch) {
              return count + 1;
            }
          }
        }
        return count;
      }, 0);

      const prAgentsSch = agentsSch + activeNewHires;
      const prCapRaw = prAgentsSch * perAgent;
      const prCapRounded = Math.ceil(prCapRaw);
      const prSurplus = prCapRounded - vol;
      const prFaltam10 = fixedOvernightCoverage
        ? FIXED_OVERNIGHT_AGENTS - prAgentsSch
        : excelRoundUp(prSurplus / -perAgent);

      computedTotals[day].volume += vol;
      computedTotals[day].capacity += capRounded;
      computedTotals[day].deficit10 += Math.max(0, faltam10);
      computedTotals[day].prCapacity += prCapRounded;
      computedTotals[day].prDeficit10 += Math.max(0, prFaltam10);

      totalVolume += vol;
      totalCapacity += capRounded;
      totalDeficit10 += Math.max(0, faltam10);
      totalPrDeficit10 += Math.max(0, prFaltam10);
      totalDeficitChats += deficitChats;

      if (faltam10 > maxDeficit) {
        maxDeficit = faltam10;
        maxDeficitDay = day;
        maxDeficitTime = time;
      }

      const dIdx = days.indexOf(day);
      rowResult.volume[dIdx] = vol;
      rowResult.capacity[dIdx] = capRaw;
      rowResult.capacityR[dIdx] = capRounded;
      rowResult.resultado[dIdx] = surplus;
      rowResult.faltam10[dIdx] = faltam10;
      rowResult.prCapacity[dIdx] = prCapRaw;
      rowResult.prCapacityR[dIdx] = prCapRounded;
      rowResult.prResultado[dIdx] = prSurplus;
      rowResult.prFaltam10[dIdx] = prFaltam10;
    });

    return rowResult;
  });

  return {
    rowCalculations: list,
    totals: computedTotals,
    kpis: {
      helpdeskVolume: totalVolume,
      helpdeskCapacity: totalCapacity,
      totalDeficit10,
      provaRealDeficit10: totalPrDeficit10,
      picoMaximo: { day: maxDeficitDay, time: maxDeficitTime, deficit: maxDeficit },
      coberturaProjetada:
        totalVolume > 0 ? ((totalVolume - totalDeficitChats) / totalVolume) * 100 : 100,
    },
  };
}
