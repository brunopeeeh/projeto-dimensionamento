import { useCallback } from "react";
import { DAYS, type Day } from "./types";
import { WEEKS_PER_QUARTER } from "@/lib/constants";

function parsePowerBICsv(csv: string): Record<string, Record<Day, number>> {
  const lines = csv
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const data: Record<string, Record<Day, number>> = {};

  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes("seg") || l.includes("ter") || l.includes("qua") || l.includes("volume")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) throw new Error("Header não encontrado");

  const rawHeaders = lines[headerIdx].split(/[;,\t]/).map((h) => h.trim().toLowerCase());

  const dayCols: Record<Day, number> = {} as Record<Day, number>;
  const dayShorts: Record<string, Day> = {
    seg: "Segunda",
    ter: "Terça",
    qua: "Quarta",
    qui: "Quinta",
    sex: "Sexta",
    sab: "Sábado",
    sáb: "Sábado",
    dom: "Domingo",
  };

  rawHeaders.forEach((h, idx) => {
    Object.keys(dayShorts).forEach((short) => {
      if (h.includes(short)) {
        dayCols[dayShorts[short]] = idx;
      }
    });
  });

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split(/[;,\t]/).map((c) => c.trim());
    if (cells.length < 2) continue;

    let timeVal = cells[0];
    if (timeVal.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
      const parts = timeVal.split(":");
      const hh = parts[0].padStart(2, "0");
      const mm = parts[1];
      timeVal = `${hh}:${mm}`;
    } else {
      continue;
    }

    data[timeVal] = {} as Record<Day, number>;
    DAYS.forEach((day) => {
      const colIdx = dayCols[day];
      let val = 0;
      if (colIdx !== undefined && cells[colIdx]) {
        val = Number(cells[colIdx].replace(",", ".")) || 0;
      }
      data[timeVal][day] = Math.max(0, val / WEEKS_PER_QUARTER);
    });
  }
  return data;
}

export function useDataImport(
  setHelpdeskVolumes: React.Dispatch<React.SetStateAction<Record<string, Record<Day, number>>>>,
) {
  const importPowerBIData = useCallback(
    (helpdeskCsv: string): boolean => {
      try {
        if (helpdeskCsv) {
          const data = parsePowerBICsv(helpdeskCsv);
          setHelpdeskVolumes((prev) => {
            const updated = { ...prev };
            Object.keys(data).forEach((t) => {
              if (updated[t]) updated[t] = data[t];
            });
            return updated;
          });
        }

        return true;
      } catch (err) {
        console.error("Error parsing Power BI report:", err);
        return false;
      }
    },
    [setHelpdeskVolumes],
  );

  const updateHelpdeskVolumes = useCallback(
    (newVolumes: Record<string, Record<Day, number>>) => {
      setHelpdeskVolumes((prev) => {
        const updated = { ...prev };
        Object.keys(newVolumes).forEach((t) => {
          if (updated[t]) {
            updated[t] = {
              ...updated[t],
              ...newVolumes[t],
            };
          } else {
            updated[t] = newVolumes[t];
          }
        });
        return updated;
      });
    },
    [setHelpdeskVolumes],
  );

  return { importPowerBIData, updateHelpdeskVolumes };
}
