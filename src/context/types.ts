import type React from "react";

export type Day = "Segunda" | "Terça" | "Quarta" | "Quinta" | "Sexta" | "Sábado" | "Domingo";

export const DAYS: Day[] = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export type IntervalStatus = "trabalhando" | "pausa" | "folga" | "externo";

export type AgentSchedule = {
  intervals: Record<string, IntervalStatus>;
};

export type TeamAgent = {
  id: string;
  name: string;
  active: boolean;
  schedules: Partial<Record<Day, AgentSchedule>>;
  isSimulated?: boolean;
};

export type NewAgentHire = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  lunch_start_time?: string;
  days: Day[];
  active: boolean;
  schedules?: Partial<Record<Day, AgentSchedule>>;
};

export type CapacityAgent = {
  name: string;
  mediaTri: number;
  active?: boolean;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type ScenarioParams = {
  clientBase: number;
  contactRate: number;
  turnoverRate: number;
  slaTarget: number;
};

export type RowCalculation = {
  time: string;
  volume: number[];
  capacity: number[];
  capacityR: number[];
  resultado: number[];
  faltam10: number[];
  prCapacity: number[];
  prCapacityR: number[];
  prResultado: number[];
  prFaltam10: number[];
};

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

export type DimensionamentoState = {
  rowCalculations: RowCalculation[];
  totals: Record<Day, DayTotals>;
  kpis: DimensionamentoKpis;
  timeBlocks: string[];
  helpdeskVolumes: Record<string, Record<Day, number>>;
  tmaFactors: Record<Day, number>;
  simultaneous: number;
  teamAgents: TeamAgent[];
  newHires: NewAgentHire[];
  scenarios: ScenarioParams;
  capacityAgents: CapacityAgent[];
  currentMonth: string;
  availableMonths: string[];
  isLoading: boolean;
  saveStatus: SaveStatus;
  isReadOnly: boolean;
  setIsReadOnly: (val: boolean) => void;
  changeActiveMonth: (monthName: string) => Promise<void>;
  createNewMonth: (newMonthName: string) => Promise<void>;
  refreshCurrentMonth: () => Promise<void>;
  updateTimeBlockVolume: (time: string, day: Day, value: number) => void;
  updateTmaFactor: (day: Day, value: number) => void;
  updateSimultaneous: (value: number) => void;
  setTeamAgents: React.Dispatch<React.SetStateAction<TeamAgent[]>>;
  toggleIntervalStatus: (agentId: string, day: Day, time20: string) => void;
  applyPresetShift: (
    agentId: string,
    day: Day,
    start: string,
    end: string,
    lunchStart: string,
    externalStart?: string,
    externalDurationMin?: number,
  ) => void;
  toggleAgentActive: (agentId: string) => void;
  addTeamAgent: (name: string) => void;
  removeTeamAgent: (agentId: string) => void;
  updateTeamAgentName: (agentId: string, name: string) => void;
  setNewHires: React.Dispatch<React.SetStateAction<NewAgentHire[]>>;
  updateScenario: (key: keyof ScenarioParams, value: number) => void;
  updateCapacityAgent: (name: string, value: number, active?: boolean) => void;
  setCapacityAgentActive: (name: string, active: boolean) => void;
  resetAll: () => void;
  isResetConfirmOpen: boolean;
  setIsResetConfirmOpen: (val: boolean) => void;
  executeResetAll: () => Promise<void>;
  importPowerBIData: (helpdeskCsv: string) => boolean;
  updateHelpdeskVolumes: (newVolumes: Record<string, Record<Day, number>>) => void;
};
