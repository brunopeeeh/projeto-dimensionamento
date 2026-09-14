import type { Day } from "@/context/types";

export const SERVICE_START = "07:00";
export const WEEKDAY_OVERNIGHT_END = "03:00";
export const SUNDAY_MONDAY_OVERNIGHT_END = "01:00";
export const FIXED_OVERNIGHT_AGENTS = 1;

/**
 * Gera a jornada operacional contínua: 07:00 até 03:00 do dia seguinte.
 * Domingo e segunda usam apenas parte da madrugada, filtrada por
 * `isHelpdeskOpen`; manter a grade completa facilita comparar todos os dias.
 */
export function generateOperatingTimeBlocks(intervalMinutes: 10 | 20): string[] {
  const blocks: string[] = [];
  const startMinutes = 7 * 60;
  const endMinutes = 27 * 60;

  for (let current = startMinutes; current < endMinutes; current += intervalMinutes) {
    const hour = Math.floor((current % (24 * 60)) / 60);
    const minute = current % 60;
    blocks.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  return blocks;
}

export function isHelpdeskOpen(day: Day, time: string): boolean {
  if (time >= SERVICE_START) return true;
  const overnightEnd =
    day === "Domingo" || day === "Segunda" ? SUNDAY_MONDAY_OVERNIGHT_END : WEEKDAY_OVERNIGHT_END;
  return time < overnightEnd;
}

/**
 * Na janela final de cada dia operacional a cobertura é uma decisão fixa de
 * escala, não uma recomendação calculada pelo volume: exatamente 1 humano.
 */
export function hasFixedOvernightCoverage(day: Day, time: string): boolean {
  return time < (day === "Domingo" || day === "Segunda" ? "01:00" : "03:00");
}
