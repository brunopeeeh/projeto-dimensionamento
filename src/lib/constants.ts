import type { Day } from "@/context/types";
import type { NewAgentHire } from "@/context/types";
import type { ScenarioParams } from "@/context/types";

// ---- Operational math ----
export const DEFAULT_MEDIA_TRI = 750;
export const MONTHS_PER_QUARTER = 3;
export const WORKING_DAYS_PER_MONTH = 20;
export const HOURS_PER_SHIFT = 8;
export const BLOCKS_10MIN_PER_HOUR = 6;
export const WEEKS_PER_QUARTER = 13;
export const DAYS_PER_WEEK = 7;

// ---- Capacity defaults ----
// Canal único (Helpdesk): 3 simultâneos por agente, mesmo valor do antigo Webchat.
export const DEFAULT_SIMULTANEOUS_HELPDESK = 3;

// ---- Capacidade adicional (IA / Suporte) ----
// A Care AI atende 24/7 — sua capacidade por bloco de 10min usa o calendário
// completo, não a jornada humana de 8h x 20 dias úteis.
// Identificação de IA/Suporte fica em `src/lib/agents.ts` (isAiAgent/isSupportAgent).
export const AI_DAYS_PER_MONTH = 30;
export const AI_HOURS_PER_DAY = 24;

// ---- Scenario defaults ----
export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  clientBase: 3580,
  contactRate: 6.2,
  turnoverRate: 2.0,
  slaTarget: 95,
};

// ---- Month ----
export const DEFAULT_MONTH_NAME = "Fevereiro 2026";
export const DEFAULT_MONTHS = ["Fevereiro 2026"];

// ---- TMA factors ----
export const DEFAULT_TMA_FACTORS: Record<Day, number> = {
  Segunda: 1.63,
  Terça: 1.67,
  Quarta: 2.7,
  Quinta: 1.33,
  Sexta: 1.33,
  Sábado: 1.64,
  Domingo: 1.76,
};

// ---- Default hires ----
export const DEFAULT_NEW_HIRES: NewAgentHire[] = [
  {
    id: "h1",
    name: "Agente Contratado 1",
    start_time: "09:00",
    end_time: "18:00",
    days: ["Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
    active: true,
  },
  {
    id: "h2",
    name: "Agente Contratado 2",
    start_time: "10:00",
    end_time: "19:00",
    days: ["Segunda", "Terça", "Quinta", "Sexta", "Sábado"],
    active: true,
  },
  {
    id: "h3",
    name: "Agente Contratado 3",
    start_time: "11:00",
    end_time: "20:00",
    days: ["Segunda", "Quarta", "Quinta", "Sexta", "Domingo"],
    active: true,
  },
  {
    id: "h4",
    name: "Agente Contratado 4",
    start_time: "12:00",
    end_time: "21:00",
    days: ["Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
    active: true,
  },
];
