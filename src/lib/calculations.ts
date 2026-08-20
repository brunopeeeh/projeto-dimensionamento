import { matchAgentName } from "@/lib/agents";
import { toBlock20, isTimeInShift, getLunchEndTime } from "@/lib/time";
import {
  DEFAULT_MEDIA_TRI,
  MONTHS_PER_QUARTER,
  WORKING_DAYS_PER_MONTH,
  HOURS_PER_SHIFT,
  BLOCKS_10MIN_PER_HOUR,
  DAYS_PER_WEEK,
} from "@/lib/constants";
import type { Day, TeamAgent, NewAgentHire, CapacityAgent, RowCalculation } from "@/context/types";

export type DayTotals = {
  wcVolume: number;
  wcCapacity: number;
  waVolume: number;
  waCapacity: number;
  waDeficit10: number;
  prCapacity: number;
  prDeficit10: number;
};

export type DimensionamentoKpis = {
  webchatVolume: number;
  webchatCapacity: number;
  whatsappVolume: number;
  whatsappCapacity: number;
  totalDeficit10: number;
  totalDeficit20: number;
  provaRealDeficit10: number;
  excedenteTotal: number;
  picoMaximo: { day: string; time: string; deficit: number };
  horasOciosas: number;
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
  | "agentsWhats"
  | "waVolume"
  | "waCapacity"
  | "waCapacityR"
  | "waResultado"
  | "waFaltam10"
  | "waFaltam20"
  | "prCapacity"
  | "prCapacityR"
  | "prResultado"
  | "prFaltam10"
  | "prFaltam20"
> {
  const zeros = () => Array<number>(DAY_COUNT).fill(0);
  return {
    volume: zeros(),
    capacity: zeros(),
    capacityR: zeros(),
    resultado: zeros(),
    agentsWhats: zeros(),
    waVolume: zeros(),
    waCapacity: zeros(),
    waCapacityR: zeros(),
    waResultado: zeros(),
    waFaltam10: zeros(),
    waFaltam20: zeros(),
    prCapacity: zeros(),
    prCapacityR: zeros(),
    prResultado: zeros(),
    prFaltam10: zeros(),
    prFaltam20: zeros(),
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
  const resolvidosDia = Math.ceil(mediaMes / WORKING_DAYS_PER_MONTH);
  const resolvidosHora = resolvidosDia / HOURS_PER_SHIFT;
  return resolvidosHora / BLOCKS_10MIN_PER_HOUR;
}

function isAgentScheduledOnDay(agent: TeamAgent, day: Day): boolean {
  if (!agent.active || !agent.schedules[day]) return false;
  return Object.values(agent.schedules[day]!.intervals).some(
    (s) => s === "trabalhando" || s === "externo" || s === "pausa",
  );
}

export function computeDynamicTmaFactors(
  days: readonly Day[],
  teamAgents: TeamAgent[],
  capacityAgents: CapacityAgent[],
): Record<Day, number> {
  const supportMatch = capacityAgents.find((ca) => ca.name === "Yooga Suporte");
  const supportResolvidos10 = deriveResolvidos10(
    supportMatch ? supportMatch.mediaTri : DEFAULT_MEDIA_TRI,
  );

  const aiMatch = capacityAgents.find((ca) => ca.name === "Care AI");
  const aiResolvidos10 = deriveResolvidos10(aiMatch ? aiMatch.mediaTri : DEFAULT_MEDIA_TRI);

  const factors = {} as Record<Day, number>;

  days.forEach((day) => {
    const scheduledHumans = teamAgents.filter(
      (agent) => agent.active && isAgentScheduledOnDay(agent, day),
    );

    const humanSum = scheduledHumans.reduce((sum, agent) => {
      const capMatch = capacityAgents.find((ca) => matchAgentName(ca.name, agent.name));
      const mediaTri = capMatch ? capMatch.mediaTri : DEFAULT_MEDIA_TRI;
      return sum + deriveResolvidos10(mediaTri);
    }, 0);

    const totalResolvidos10 = humanSum + supportResolvidos10 + aiResolvidos10;
    const divisor = scheduledHumans.length;
    factors[day] = Math.round((totalResolvidos10 / Math.max(divisor + 1, 1)) * 100) / 100;
  });

  return factors;
}

function excelRoundUp(val: number): number {
  if (val === 0) return 0;
  return val > 0 ? Math.ceil(val) : Math.floor(val);
}

export function computeGridCalculations(params: {
  days: readonly Day[];
  timeBlocks: string[];
  webchatVolumes: Record<string, Record<Day, number>>;
  whatsappVolumes: Record<string, Record<Day, number>>;
  teamAgents: TeamAgent[];
  dynamicTmaFactors: Record<Day, number>;
  simultaneousWC: number;
  simultaneousWA: number;
  newHires: NewAgentHire[];
}): GridCalculationResult {
  const {
    days,
    timeBlocks,
    webchatVolumes,
    whatsappVolumes,
    teamAgents,
    dynamicTmaFactors,
    simultaneousWC,
    simultaneousWA,
    newHires,
  } = params;

  let totalWcVolume = 0;
  let totalWcCapacity = 0;
  let totalWaVolume = 0;
  let totalWaCapacity = 0;
  let totalDeficit10 = 0;
  let totalDeficit20 = 0;
  let totalPrDeficit10 = 0;
  let totalSurplus = 0;
  let totalWaDeficitChats = 0;

  let maxDeficit = 0;
  let maxDeficitDay = "Segunda";
  let maxDeficitTime = "00:00";

  const computedTotals = {} as Record<Day, DayTotals>;
  days.forEach((day) => {
    computedTotals[day] = {
      wcVolume: 0,
      wcCapacity: 0,
      waVolume: 0,
      waCapacity: 0,
      waDeficit10: 0,
      prCapacity: 0,
      prDeficit10: 0,
    };
  });

  const list: RowCalculation[] = timeBlocks.map((time) => {
    const rowResult = createEmptyRowCalculation(time);

    days.forEach((day) => {
      const factorWC = dynamicTmaFactors[day];
      const factorWA = factorWC * (simultaneousWA / simultaneousWC);

      const volWC = webchatVolumes[time]?.[day] ?? 0;
      const volWA = whatsappVolumes[time]?.[day] ?? 0;
      const time20 = toBlock20(time);

      const agentsSch = teamAgents.reduce((count, agent) => {
        if (agent.active && agent.schedules[day]) {
          const status = agent.schedules[day]!.intervals[time20] || "folga";
          if (status === "trabalhando") {
            return count + 1;
          }
        }
        return count;
      }, 0);

      const capWcRaw = agentsSch * factorWC;
      const capWcRounded = Math.ceil(capWcRaw);
      const wcSurplus = capWcRounded - volWC;
      const wcAgentsForWhats = wcSurplus > 0 ? Math.floor(wcSurplus / simultaneousWC) : 0;

      const capWaRaw = wcAgentsForWhats * factorWA;
      const capWaRounded = Math.ceil(capWaRaw);
      const waSurplus = capWaRounded - volWA;

      const waDeficitChats = Math.max(0, volWA - capWaRounded);
      const waFaltam10 = excelRoundUp(waSurplus / -simultaneousWA);
      const waFaltam20 = excelRoundUp(waSurplus / -(simultaneousWA * 2));

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

      const prWcAgentsForWhats = wcAgentsForWhats + activeNewHires;
      const prCapWaRaw = prWcAgentsForWhats * factorWA;
      const prCapWaRounded = Math.ceil(prCapWaRaw);
      const prWaSurplus = prCapWaRounded - volWA;
      const prFaltam10 = excelRoundUp(prWaSurplus / -simultaneousWA);
      const prFaltam20 = excelRoundUp(prWaSurplus / -(simultaneousWA * 2));

      computedTotals[day].wcVolume += volWC;
      computedTotals[day].wcCapacity += capWcRounded;
      computedTotals[day].waVolume += volWA;
      computedTotals[day].waCapacity += capWaRounded;
      computedTotals[day].waDeficit10 += Math.max(0, waFaltam10);
      computedTotals[day].prCapacity += prCapWaRounded;
      computedTotals[day].prDeficit10 += Math.max(0, prFaltam10);

      totalWcVolume += volWC;
      totalWcCapacity += capWcRounded;
      totalWaVolume += volWA;
      totalWaCapacity += capWaRounded;
      totalDeficit10 += Math.max(0, waFaltam10);
      totalDeficit20 += Math.max(0, waFaltam20);
      totalPrDeficit10 += Math.max(0, prFaltam10);
      totalSurplus += Math.max(0, wcSurplus) + Math.max(0, waSurplus);
      totalWaDeficitChats += waDeficitChats;

      if (waFaltam10 > maxDeficit) {
        maxDeficit = waFaltam10;
        maxDeficitDay = day;
        maxDeficitTime = time;
      }

      const dIdx = days.indexOf(day);
      rowResult.volume[dIdx] = volWC;
      rowResult.capacity[dIdx] = capWcRaw;
      rowResult.capacityR[dIdx] = capWcRounded;
      rowResult.resultado[dIdx] = wcSurplus;
      rowResult.agentsWhats[dIdx] = wcAgentsForWhats;
      rowResult.waVolume[dIdx] = volWA;
      rowResult.waCapacity[dIdx] = capWaRaw;
      rowResult.waCapacityR[dIdx] = capWaRounded;
      rowResult.waResultado[dIdx] = waSurplus;
      rowResult.waFaltam10[dIdx] = waFaltam10;
      rowResult.waFaltam20[dIdx] = waFaltam20;
      rowResult.prCapacity[dIdx] = prCapWaRaw;
      rowResult.prCapacityR[dIdx] = prCapWaRounded;
      rowResult.prResultado[dIdx] = prCapWaRounded - volWA;
      rowResult.prFaltam10[dIdx] = prFaltam10;
      rowResult.prFaltam20[dIdx] = prFaltam20;
    });

    return rowResult;
  });

  return {
    rowCalculations: list,
    totals: computedTotals,
    kpis: {
      webchatVolume: totalWcVolume,
      webchatCapacity: totalWcCapacity,
      whatsappVolume: totalWaVolume,
      whatsappCapacity: totalWaCapacity,
      totalDeficit10,
      totalDeficit20,
      provaRealDeficit10: totalPrDeficit10,
      excedenteTotal: totalSurplus,
      picoMaximo: { day: maxDeficitDay, time: maxDeficitTime, deficit: maxDeficit },
      horasOciosas: totalSurplus / 6, // each surplus is 1 agent idle for 10 min (1/6 hour)
      coberturaProjetada:
        totalWaVolume > 0 ? ((totalWaVolume - totalWaDeficitChats) / totalWaVolume) * 100 : 100,
    },
  };
}
