import type { Day, NewAgentHire } from "@/context/DimensionamentoContext";
import { DAYS } from "@/context/DimensionamentoContext";
import { getDefaultLunchTime } from "@/lib/time";
import { hasFixedOvernightCoverage } from "@/lib/operating-hours";

type DayKey = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";

const DAY_TO_SHORT: Record<Day, DayKey> = {
  Segunda: "seg",
  Terça: "ter",
  Quarta: "qua",
  Quinta: "qui",
  Sexta: "sex",
  Sábado: "sab",
  Domingo: "dom",
};

const SHORT_TO_DAY: Record<string, Day> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

export type DeficitRow = {
  start: string; // HH:MM
  end: string; // HH:MM
  seg: number;
  ter: number;
  qua: number;
  qui: number;
  sex: number;
  sab: number;
  dom: number;
};

function add10Min(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + 10;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

interface DeficitCalculationRow {
  time: string;
  faltam10: number[];
}

/**
 * Builds the deficit table in the format the AI prompt expects:
 *   [{ start, end, seg, ter, qua, qui, sex, sab, dom }, ...]
 *
 * Formula per (time, day):
 *   needed   = ceil(volume / (tmaFactor / 6))   (agents needed in this 10-min slot)
 *   working  = count of active team agents with schedules[day].intervals[time] = "trabalhando"
 *   deficit  = max(0, needed - working)
 *
 * Rows with no deficit across all 7 days are dropped to keep the prompt compact.
 */
export function buildDeficitTable(rowCalculations: DeficitCalculationRow[]): DeficitRow[] {
  const rows: DeficitRow[] = [];
  for (const r of rowCalculations) {
    const time = r.time;
    const row: DeficitRow = {
      start: time,
      end: add10Min(time),
      seg: 0,
      ter: 0,
      qua: 0,
      qui: 0,
      sex: 0,
      sab: 0,
      dom: 0,
    };
    let hasDeficit = false;
    DAYS.forEach((day, dIdx) => {
      // Madrugada é coberta por uma posição fixa da escala (Maria Luiza),
      // não por novas contratações sugeridas pela IA/otimizador.
      if (hasFixedOvernightCoverage(day, time)) return;
      const val = r.faltam10[dIdx] ?? 0;
      const deficit = Math.max(0, val);
      row[DAY_TO_SHORT[day]] = deficit;
      if (deficit > 0) hasDeficit = true;
    });
    if (hasDeficit) rows.push(row);
  }
  return rows;
}

export type AiAgentSuggestion = {
  agente: string;
  inicio: string;
  fim: string;
  dias_trabalho: string[];
  folga: string[];
};

export function aiAgentsToNewHires(agents: AiAgentSuggestion[]): NewAgentHire[] {
  return agents.map((a, i) => ({
    id: `ai-${Date.now()}-${i}`,
    name: a.agente,
    start_time: a.inicio,
    end_time: a.fim,
    lunch_start_time: getDefaultLunchTime(a.inicio),
    days: a.dias_trabalho
      .map((d) => SHORT_TO_DAY[d.toLowerCase()] ?? (d as Day))
      .filter((d): d is Day => !!d && DAYS.includes(d)),
    active: true,
  }));
}
