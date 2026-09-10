import { WEEKS_PER_QUARTER } from "@/lib/constants";
import type { Day } from "@/context/types";

const EN_DAY_MAP: Record<string, Day> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

/**
 * Converte o relatório de volume do HubSpot (formato longo) para o mapa largo
 * `Record<time, Record<Day, number>>` usado pela engine.
 *
 * O relatório HubSpot tem 3 colunas: contagem, hora ("HH:MM") e dia da semana
 * em inglês ("Monday".."Sunday"), uma linha por (hora × dia). O cabeçalho vem
 * desalinhado na exportação, então a detecção é por CONTEÚDO, não por nome de
 * coluna. Retorna `null` quando a planilha não está nesse formato.
 */
export function parseHubspotLongFormat(
  rows: unknown[][],
  divisor = WEEKS_PER_QUARTER,
): Record<string, Record<Day, number>> | null {
  if (rows.length < 2) return null;

  const sample = rows.slice(1, Math.min(rows.length, 100));
  const colCount = sample.reduce((max, r) => Math.max(max, r.length), 0);
  if (colCount < 3) return null;

  let countCol = -1;
  let timeCol = -1;
  let dayCol = -1;

  for (let c = 0; c < colCount; c++) {
    let dayHits = 0;
    let timeHits = 0;
    let numHits = 0;
    let total = 0;

    for (const r of sample) {
      const v = r[c];
      if (v === null || v === undefined || v === "") continue;
      total++;
      if (typeof v === "number") {
        numHits++;
      } else {
        const s = String(v).trim();
        if (EN_DAY_MAP[s.toLowerCase()]) dayHits++;
        else if (/^\d{1,2}:\d{2}/.test(s)) timeHits++;
      }
    }

    if (total === 0) continue;
    if (dayHits === total) dayCol = c;
    else if (timeHits === total) timeCol = c;
    else if (numHits === total) countCol = c;
  }

  if (dayCol < 0 || timeCol < 0 || countCol < 0) return null;

  const data: Record<string, Record<Day, number>> = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length <= Math.max(countCol, timeCol, dayCol)) continue;

    const count = Number(r[countCol]) || 0;
    const timeRaw = String(r[timeCol] ?? "").trim();
    const dayRaw = String(r[dayCol] ?? "")
      .toLowerCase()
      .trim();
    const day = EN_DAY_MAP[dayRaw];

    const m = timeRaw.match(/^(\d{1,2}):(\d{2})/);
    if (!day || !m) continue;

    const timeKey = `${m[1].padStart(2, "0")}:${m[2]}`;
    if (!data[timeKey]) data[timeKey] = {} as Record<Day, number>;
    data[timeKey][day] = (data[timeKey][day] || 0) + count;
  }

  for (const time of Object.keys(data)) {
    for (const day of Object.keys(data[time]) as Day[]) {
      data[time][day] = data[time][day] / divisor;
    }
  }

  return data;
}
