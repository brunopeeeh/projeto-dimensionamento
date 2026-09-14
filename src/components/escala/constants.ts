import type { Day, IntervalStatus } from "@/context/DimensionamentoContext";
import { generateOperatingTimeBlocks } from "@/lib/operating-hours";

export const EXTRA_TABS = ["Agente dia", "Quantidade de agente dia"] as const;
export type ExtraTab = (typeof EXTRA_TABS)[number];
export type EscalaTab = Day | ExtraTab;

export const SHIFT_PRESETS = [
  { label: "Turno A (07-16)", start: "07:00", end: "16:00", lunch: "11:00" },
  { label: "Turno B (08-17)", start: "08:00", end: "17:00", lunch: "12:00" },
  { label: "Turno C (09-18)", start: "09:00", end: "18:00", lunch: "13:00" },
  { label: "Turno D (10-19)", start: "10:00", end: "19:00", lunch: "14:00" },
  { label: "Tarde A (11-20)", start: "11:00", end: "20:00", lunch: "14:00" },
  { label: "Tarde B (12-21)", start: "12:00", end: "21:00", lunch: "15:00" },
  { label: "Tarde C (13-22)", start: "13:00", end: "22:00", lunch: "17:00" },
  { label: "Noite A (14-23)", start: "14:00", end: "23:00", lunch: "18:00" },
  { label: "Noite B (15-00)", start: "15:00", end: "00:00", lunch: "19:00" },
  { label: "Noite C (16-01)", start: "16:00", end: "01:00", lunch: "20:00" },
  { label: "Fechamento (18-03)", start: "18:00", end: "03:00", lunch: "22:00" },
] as const;

export function generateTimeBlocks20(): string[] {
  return generateOperatingTimeBlocks(20);
}

export function generateLunchOptions(): string[] {
  const options: string[] = [];
  for (let h = 11; h <= 22; h++) {
    options.push(`${h.toString().padStart(2, "0")}:00`);
  }
  return options;
}

export function getCellStyles(status: IntervalStatus, isSimulated?: boolean): string {
  if (isSimulated) {
    switch (status) {
      case "trabalhando":
        return "bg-[#006D3E]/30 text-emerald-400 border border-dashed border-[#006D3E]/60 hover:bg-[#006D3E]/40";
      case "externo":
        return "bg-[#008AD4]/30 text-sky-400 border border-dashed border-[#008AD4]/60";
      case "pausa":
        return "bg-[#F54A00]/30 text-orange-400 border border-dashed border-[#F54A00]/60";
      case "folga":
      default:
        return "bg-white dark:bg-[#1a1b23] text-transparent border border-dashed border-slate-200/20";
    }
  }
  switch (status) {
    case "trabalhando":
      return "bg-[#006D3E] text-white hover:bg-[#005a33] border-[#005a33]/50";
    case "externo":
      return "bg-[#008AD4] text-white hover:bg-[#0077b8] border-[#0077b8]/50";
    case "pausa":
      return "bg-[#F54A00] text-white hover:bg-[#dd4200] border-[#dd4200]/50";
    case "folga":
    default:
      return "bg-white dark:bg-[#1a1b23] text-transparent hover:bg-slate-50 dark:hover:bg-slate-800/20 border-slate-200/20";
  }
}

export function formatDayHeader(day: Day): string {
  switch (day) {
    case "Segunda":
      return "Segunda-feira";
    case "Terça":
      return "Terça-feira";
    case "Quarta":
      return "Quarta-feira";
    case "Quinta":
      return "Quinta-feira";
    case "Sexta":
      return "Sexta-feira";
    default:
      return day.toUpperCase();
  }
}
