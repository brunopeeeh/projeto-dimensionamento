import { describe, it, expect } from "vitest";
import {
  mapTeamAgentToEscalaOpsAgent,
  adaptAllAgents,
  groupContiguousTimeBlocks,
} from "./agent-adapter";
import type { TeamAgent, NewAgentHire, Day, IntervalStatus } from "@/context/types";
import { DAYS } from "@/context/types";

function createMockTeamAgent(overrides?: Partial<TeamAgent>): TeamAgent {
  const defaultIntervals = {
    "08:00": "trabalhando" as const,
    "08:20": "trabalhando" as const,
    "12:00": "pausa" as const,
    "12:20": "pausa" as const,
    "12:40": "pausa" as const,
    "16:20": "trabalhando" as const,
  };

  const schedules = DAYS.reduce(
    (acc, day) => {
      acc[day] = {
        intervals: day === "Domingo" ? {} : { ...defaultIntervals },
      };
      return acc;
    },
    {} as Record<Day, { intervals: Record<string, IntervalStatus> }>,
  );

  return {
    id: "agent-1",
    name: "Carlos Eduardo",
    active: true,
    schedules,
    ...overrides,
  };
}

describe("agent-adapter", () => {
  it("converts a TeamAgent into an Ops Agent with proper daily schedules", () => {
    const teamAgent = createMockTeamAgent();
    const opsAgent = mapTeamAgentToEscalaOpsAgent(teamAgent, 0);

    expect(opsAgent.id).toBe("agent-1");
    expect(opsAgent.name).toBe("Carlos Eduardo");
    expect(opsAgent.isSimulated).toBe(false);

    // Domingo deve ser folga (works: false)
    const sundaySchedule = opsAgent.daySchedules?.["Domingo"];
    expect(sundaySchedule?.works).toBe(false);

    // Segunda deve ter turno ativo das 08:00 às 16:40 (16:20 + 20min) e pausa às 12:00-13:00
    const mondaySchedule = opsAgent.daySchedules?.["Segunda"];
    expect(mondaySchedule?.works).toBe(true);
    expect(mondaySchedule?.shift).toEqual(["08:00", "16:40"]);
    expect(mondaySchedule?.pause).toEqual(["12:00", "13:00"]);
  });

  it("handles new hires properly when includeSimulated is true", () => {
    const newHire: NewAgentHire = {
      id: "hire-1",
      name: "Novo Contratado",
      start_time: "09:00",
      end_time: "18:00",
      lunch_start_time: "13:00",
      days: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
      active: true,
    };

    const teamAgent = createMockTeamAgent();
    const all = adaptAllAgents([teamAgent], [newHire], true);

    expect(all).toHaveLength(2);
    const hireOps = all.find((a) => a.id === "hire-1");
    expect(hireOps).toBeDefined();
    expect(hireOps?.isSimulated).toBe(true);
    expect(hireOps?.daySchedules?.["Segunda"]?.shift).toEqual(["09:00", "18:00"]);
    expect(hireOps?.daySchedules?.["Sábado"]?.works).toBe(false);
  });

  it("correctly identifies overnight shifts crossing midnight (Maria Luiza 18:00-03:00 and Rafael 16:00-01:00)", () => {
    // Mock Maria Luiza on Saturday: 18:00 to 03:00, lunch 21:00 to 22:00
    const mariaIntervals: Record<string, "trabalhando" | "pausa"> = {
      "18:00": "trabalhando",
      "18:20": "trabalhando",
      "21:00": "pausa",
      "21:20": "pausa",
      "21:40": "pausa",
      "23:40": "trabalhando",
      "00:00": "trabalhando",
      "00:20": "trabalhando",
      "01:00": "trabalhando",
      "02:40": "trabalhando",
    };

    const mariaAgent: TeamAgent = {
      id: "agent-maria",
      name: "Maria Luiza Sarmento Murilo",
      active: true,
      schedules: {
        Sábado: { intervals: mariaIntervals },
      },
    };

    const mariaOps = mapTeamAgentToEscalaOpsAgent(mariaAgent, 0);
    const sabSched = mariaOps.daySchedules?.["Sábado"];
    expect(sabSched?.works).toBe(true);
    expect(sabSched?.shift).toEqual(["18:00", "03:00"]);
    expect(sabSched?.pause).toEqual(["21:00", "22:00"]);

    // Mock Rafael on Monday: 16:00 to 01:00, lunch 21:00 to 22:00
    const rafaelIntervals: Record<string, "trabalhando" | "pausa"> = {
      "16:00": "trabalhando",
      "16:20": "trabalhando",
      "21:00": "pausa",
      "21:20": "pausa",
      "21:40": "pausa",
      "23:40": "trabalhando",
      "00:00": "trabalhando",
      "00:20": "trabalhando",
      "00:40": "trabalhando",
    };

    const rafaelAgent: TeamAgent = {
      id: "agent-rafael",
      name: "Rafael Marques dos Santos",
      active: true,
      schedules: {
        Segunda: { intervals: rafaelIntervals },
      },
    };

    const rafaelOps = mapTeamAgentToEscalaOpsAgent(rafaelAgent, 1);
    const segSched = rafaelOps.daySchedules?.["Segunda"];
    expect(segSched?.works).toBe(true);
    expect(segSched?.shift).toEqual(["16:00", "01:00"]);
    expect(segSched?.pause).toEqual(["21:00", "22:00"]);
  });

  it("groups contiguous 20min blocks into time ranges and extracts external demand windows", () => {
    const blocks = ["09:00", "09:20", "09:40", "14:00", "14:20"];
    const ranges = groupContiguousTimeBlocks(blocks);
    expect(ranges).toEqual([
      ["09:00", "10:00"],
      ["14:00", "14:40"],
    ]);

    const agentWithExterno: TeamAgent = {
      id: "agent-ext",
      name: "Operador Demanda Externa",
      active: true,
      schedules: {
        Quarta: {
          intervals: {
            "08:00": "trabalhando",
            "08:20": "trabalhando",
            "09:00": "externo",
            "09:20": "externo",
            "12:00": "pausa",
            "12:20": "pausa",
            "12:40": "pausa",
            "16:40": "trabalhando",
          },
        },
      },
    };

    const ops = mapTeamAgentToEscalaOpsAgent(agentWithExterno, 0);
    const quarta = ops.daySchedules?.["Quarta"];
    expect(quarta?.works).toBe(true);
    expect(quarta?.shift).toEqual(["08:00", "17:00"]);
    expect(quarta?.pause).toEqual(["12:00", "13:00"]);
    expect(quarta?.externos).toEqual([["09:00", "09:40"]]);
  });
});
