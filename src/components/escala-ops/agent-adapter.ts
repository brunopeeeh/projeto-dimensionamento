import { DAYS, type Day, type TeamAgent, type NewAgentHire } from "@/context/types";
import {
  getNext20MinTime,
  getLunchEndTime,
  getActiveTimeBlocks,
  timeToOperationalMinutes,
} from "@/lib/time";
import type { Agent, AgentDaySchedule } from "./types";

export const WEEKDAY_TO_DAY: Record<number, Day> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

export const DAY_TO_WEEKDAY: Record<Day, number> = {
  Domingo: 0,
  Segunda: 1,
  Terça: 2,
  Quarta: 3,
  Quinta: 4,
  Sexta: 5,
  Sábado: 6,
};

export const PALETTE = [
  "#5a9dff",
  "#3fd9b2",
  "#a78bfa",
  "#f2709c",
  "#e8c15a",
  "#8bd450",
  "#ff9366",
  "#56c8e8",
  "#c9d15f",
  "#ff8a7a",
  "#6ee7d8",
  "#9ab0c9",
];

/**
 * Agrupa blocos contínuos de 20 minutos em intervalos [início, fim].
 */
export function groupContiguousTimeBlocks(blocks: string[]): [string, string][] {
  if (blocks.length === 0) return [];
  const sorted = [...blocks].sort(
    (a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b),
  );
  const ranges: [string, string][] = [];
  let currentStart = sorted[0];
  let currentEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (getNext20MinTime(prev) === curr) {
      currentEnd = curr;
    } else {
      ranges.push([currentStart, getNext20MinTime(currentEnd)]);
      currentStart = curr;
      currentEnd = curr;
    }
  }
  ranges.push([currentStart, getNext20MinTime(currentEnd)]);
  return ranges;
}

/**
 * Extrai o turno (início/fim), pausa e janelas de demanda externa de um operador para um dia específico.
 */
export function extractAgentDaySchedule(
  agent: TeamAgent,
  day: Day,
  fallbackShift: [string, string] = ["08:00", "17:00"],
  fallbackPause: [string, string] | null = ["12:00", "13:00"],
): AgentDaySchedule {
  const daySched = agent.schedules?.[day];
  if (!daySched || !daySched.intervals) {
    return {
      works: false,
      shift: fallbackShift,
      pause: fallbackPause,
    };
  }

  const intervals = daySched.intervals;
  const activeBlocks = getActiveTimeBlocks(intervals);

  if (activeBlocks.length === 0) {
    return {
      works: false,
      shift: fallbackShift,
      pause: fallbackPause,
    };
  }

  const start = activeBlocks[0];
  const end = getNext20MinTime(activeBlocks[activeBlocks.length - 1]);
  const shift: [string, string] = [start, end];

  const lunchBlocks = Object.keys(intervals)
    .filter((t) => intervals[t] === "pausa")
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
  let pause: [string, string] | null = null;
  if (lunchBlocks.length > 0) {
    const pStart = lunchBlocks[0];
    const pEnd = getNext20MinTime(lunchBlocks[lunchBlocks.length - 1]);
    pause = [pStart, pEnd];
  }

  const externoBlocks = Object.keys(intervals)
    .filter((t) => intervals[t] === "externo")
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
  const externos = groupContiguousTimeBlocks(externoBlocks);

  return {
    works: true,
    shift,
    pause,
    externos: externos.length > 0 ? externos : undefined,
  };
}

/**
 * Mapeia um TeamAgent da Gestão de Escalas para o modelo de exibição do EscalaOps.
 */
export function mapTeamAgentToEscalaOpsAgent(teamAgent: TeamAgent, index: number): Agent {
  const daySchedules: Partial<Record<Day, AgentDaySchedule>> = {};
  const workdays: number[] = [];
  let defaultShift: [string, string] = ["08:00", "17:00"];
  let defaultPause: [string, string] | null = ["12:00", "13:00"];
  let hasSetDefault = false;

  DAYS.forEach((day) => {
    const sched = extractAgentDaySchedule(teamAgent, day);
    daySchedules[day] = sched;

    if (sched.works) {
      const weekday = DAY_TO_WEEKDAY[day];
      workdays.push(weekday);

      if (!hasSetDefault) {
        defaultShift = sched.shift;
        defaultPause = sched.pause;
        hasSetDefault = true;
      }
    }
  });

  return {
    id: teamAgent.id,
    name: teamAgent.name,
    color: PALETTE[index % PALETTE.length],
    workdays,
    shift: defaultShift,
    pause: defaultPause,
    daySchedules,
    isSimulated: !!teamAgent.isSimulated,
  };
}

/**
 * Mapeia contratados simulados (NewAgentHire) para o modelo de exibição do EscalaOps.
 */
export function mapNewHireToEscalaOpsAgent(hire: NewAgentHire, index: number): Agent {
  const daySchedules: Partial<Record<Day, AgentDaySchedule>> = {};
  const workdays: number[] = [];
  const defaultShift: [string, string] = [hire.start_time, hire.end_time];
  const defaultPause: [string, string] | null = hire.lunch_start_time
    ? [hire.lunch_start_time, getLunchEndTime(hire.lunch_start_time)]
    : null;

  DAYS.forEach((day) => {
    const isDayAssigned = hire.days.includes(day);
    if (hire.schedules?.[day]) {
      const intervals = hire.schedules[day]!.intervals;
      const activeBlocks = getActiveTimeBlocks(intervals);
      if (activeBlocks.length > 0) {
        const start = activeBlocks[0];
        const end = getNext20MinTime(activeBlocks[activeBlocks.length - 1]);
        const lunchBlocks = Object.keys(intervals)
          .filter((t) => intervals[t] === "pausa")
          .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
        const pause: [string, string] | null =
          lunchBlocks.length > 0
            ? [lunchBlocks[0], getNext20MinTime(lunchBlocks[lunchBlocks.length - 1])]
            : null;

        const externoBlocks = Object.keys(intervals)
          .filter((t) => intervals[t] === "externo")
          .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
        const externos = groupContiguousTimeBlocks(externoBlocks);

        daySchedules[day] = {
          works: true,
          shift: [start, end],
          pause,
          externos: externos.length > 0 ? externos : undefined,
        };
        workdays.push(DAY_TO_WEEKDAY[day]);
        return;
      }
    }

    if (isDayAssigned) {
      daySchedules[day] = {
        works: true,
        shift: defaultShift,
        pause: defaultPause,
      };
      workdays.push(DAY_TO_WEEKDAY[day]);
    } else {
      daySchedules[day] = {
        works: false,
        shift: defaultShift,
        pause: defaultPause,
      };
    }
  });

  return {
    id: hire.id,
    name: `${hire.name} (Simulado)`,
    color: PALETTE[(index + 6) % PALETTE.length],
    workdays,
    shift: defaultShift,
    pause: defaultPause,
    daySchedules,
    isSimulated: true,
  };
}

/**
 * Converte toda a equipe ativa da Gestão de Escalas para os agentes do EscalaOps.
 */
export function adaptAllAgents(
  teamAgents: TeamAgent[],
  newHires: NewAgentHire[] = [],
  includeSimulated = false,
  agentColors: Record<string, string> = {},
): Agent[] {
  const cltAgents = teamAgents
    .filter((a) => a.active)
    .map((agent, index) => {
      const ops = mapTeamAgentToEscalaOpsAgent(agent, index);
      if (agentColors[agent.id]) {
        ops.color = agentColors[agent.id];
      }
      return ops;
    });

  if (!includeSimulated) return cltAgents;

  const simAgents = newHires
    .filter((h) => h.active)
    .map((hire, index) => {
      const ops = mapNewHireToEscalaOpsAgent(hire, cltAgents.length + index);
      if (agentColors[hire.id]) {
        ops.color = agentColors[hire.id];
      }
      return ops;
    });

  return [...cltAgents, ...simAgents];
}
