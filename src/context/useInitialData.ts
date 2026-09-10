import { useMemo } from "react";
import { DAYS, type Day } from "./types";
import { generateOperatingTimeBlocks } from "@/lib/operating-hours";

// Gera blocos de tempo a cada 10 minutos de 07:00 até 02:50 do dia seguinte.
function generateTimeBlocks(): string[] {
  return generateOperatingTimeBlocks(10);
}

export function useInitialData() {
  const timeBlocks = useMemo(() => generateTimeBlocks(), []);

  const initialData = useMemo(() => {
    const helpdeskVolumes: Record<string, Record<Day, number>> = {};

    timeBlocks.forEach((time) => {
      helpdeskVolumes[time] = {} as Record<Day, number>;

      DAYS.forEach((day) => {
        helpdeskVolumes[time][day] = 0;
      });
    });

    return { helpdeskVolumes };
  }, [timeBlocks]);

  const initialCapacityAgents = useMemo(() => {
    return []; // Retorna lista vazia agora (usuário adicionará manualmente o capacity agent)
  }, []);

  return { timeBlocks, initialData, initialCapacityAgents };
}
