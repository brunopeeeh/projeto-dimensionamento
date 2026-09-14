import type { Day } from "@/context/types";

export interface AgentDaySchedule {
  works: boolean;
  shift: [string, string];
  pause: [string, string] | null;
  externos?: [string, string][];
}

export interface Agent {
  id: string;
  name: string;
  color: string;
  workdays: number[]; // 0=Dom, 1=Seg, ..., 6=Sáb
  shift: [string, string];
  pause: [string, string] | null;
  daySchedules?: Partial<Record<Day, AgentDaySchedule>>;
  isSimulated?: boolean;
}

export type OverrideKind = "falta" | "atestado" | "ferias" | "extra" | "ajuste";

export interface Override {
  kind: OverrideKind;
  shift?: [string, string] | null;
  pause?: [string, string] | null;
  note?: string;
}

export interface Settings {
  minCoverage: number;
}

export interface EscalaOpsState {
  seq: number;
  agents: Agent[];
  overrides: Record<string, Record<string, Override>>; // dateISO -> agentId -> Override
  settings: Settings;
  dismissed: Record<string, string[]>; // dateISO -> keys
}

export interface DayEntry {
  agent: Agent;
  works: boolean;
  absence: OverrideKind | null;
  shift: [string, string];
  pause: [string, string] | null;
  externos?: [string, string][];
  span: [number, number] | null; // minutos relativos a TL0
  pauseSpan: [number, number] | null;
  externoSpans?: [number, number][];
  exception: boolean;
  fromSim: boolean;
  kind: OverrideKind | null;
  note: string;
}

export interface ToastItem {
  id: string;
  msg: string;
  type: "ok" | "warn" | "err";
  action?: { label: string; fn: () => void };
}
