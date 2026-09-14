import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { setCachedMonthId, type DirtyArea } from "@/hooks/useSupabasePersistence";
import { syncCanonicalAreas, type CanonicalArea } from "@/lib/canonical-persistence";
import {
  DAYS,
  type Day,
  type TeamAgent,
  type CapacityAgent,
  type NewAgentHire,
  type ScenarioParams,
} from "./types";

type CreateMonthParams = {
  timeBlocks: string[];
  currentMonth: string;
  teamAgents: TeamAgent[];
  capacityAgents: CapacityAgent[];
  tmaFactors: Record<Day, number>;
  simultaneous: number;
  scenarios: ScenarioParams;
  newHires: NewAgentHire[];
};

export function useMonthActions(
  setAvailableMonths: React.Dispatch<React.SetStateAction<string[]>>,
  setCurrentMonth: React.Dispatch<React.SetStateAction<string>>,
  setHelpdeskVolumes: React.Dispatch<React.SetStateAction<Record<string, Record<Day, number>>>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  saveMonthDataToSupabase: (
    monthName: string,
    areasToSave?: ReadonlySet<DirtyArea>,
  ) => Promise<void>,
  loadMonthDataFromSupabase: (monthName: string) => Promise<void>,
  getSnapshot: () => CreateMonthParams,
  dirtyAreas: Set<DirtyArea>,
) {
  const changeActiveMonth = useCallback(
    async (monthName: string) => {
      const snap = getSnapshot();
      if (monthName === snap.currentMonth) return;

      const client = supabase;
      if (!client) {
        setCurrentMonth(monthName);
        return;
      }

      try {
        setIsLoading(true);
        // Only save previously active month if there were unsaved changes
        if (dirtyAreas.size > 0) {
          await saveMonthDataToSupabase(snap.currentMonth, dirtyAreas);
        }
        await loadMonthDataFromSupabase(monthName);
        setCurrentMonth(monthName);
      } catch (err) {
        console.error(`Failed to change month to ${monthName}:`, err);
      } finally {
        setIsLoading(false);
      }
    },
    [
      getSnapshot,
      saveMonthDataToSupabase,
      loadMonthDataFromSupabase,
      setCurrentMonth,
      setIsLoading,
      dirtyAreas,
    ],
  );

  const refreshCurrentMonth = useCallback(async () => {
    await loadMonthDataFromSupabase(getSnapshot().currentMonth);
  }, [loadMonthDataFromSupabase, getSnapshot]);

  const createNewMonth = useCallback(
    async (newMonthName: string) => {
      const snap = getSnapshot();
      const { timeBlocks } = snap;

      const emptyVolumes: Record<string, Record<Day, number>> = {};

      timeBlocks.forEach((time) => {
        emptyVolumes[time] = {} as Record<Day, number>;
        DAYS.forEach((day) => {
          emptyVolumes[time][day] = 0;
        });
      });

      const client = supabase;
      if (!client) {
        setAvailableMonths((prev) => [...prev, newMonthName]);
        setCurrentMonth(newMonthName);
        setHelpdeskVolumes(emptyVolumes);
        return;
      }

      try {
        setIsLoading(true);
        if (dirtyAreas.size > 0) {
          await saveMonthDataToSupabase(snap.currentMonth, dirtyAreas);
        }

        const { data: newMonth, error: insertError } = await client
          .from("meses")
          .insert([{ nome: newMonthName }])
          .select()
          .single();

        if (insertError) throw insertError;
        const newMesId = newMonth.id;
        setCachedMonthId(newMonthName, newMesId);

        await Promise.all([
          client.from("escala_equipe").insert([
            {
              mes_id: newMesId,
              team_agents: snap.teamAgents,
              capacity_agents: snap.capacityAgents,
            },
          ]),
          client.from("volumes_chamados").insert([
            {
              mes_id: newMesId,
              helpdesk_volumes: emptyVolumes,
            },
          ]),
          client.from("parametros_operacionais").insert([
            {
              mes_id: newMesId,
              tma_factors: snap.tmaFactors,
              simultaneous_helpdesk: snap.simultaneous,
              scenarios: snap.scenarios,
              new_hires: snap.newHires.map((nh) => ({ ...nh, active: true })),
            },
          ]),
        ]);

        // Espelha o mês novo no schema canônico (best-effort).
        try {
          await syncCanonicalAreas(
            client,
            newMonthName,
            {
              teamAgents: snap.teamAgents,
              capacityAgents: snap.capacityAgents,
              helpdeskVolumes: emptyVolumes,
              tmaFactors: snap.tmaFactors,
              simultaneous: snap.simultaneous,
              scenarios: snap.scenarios,
              newHires: snap.newHires.map((nh) => ({ ...nh, active: true })),
            },
            new Set<CanonicalArea>(["escala", "volumes", "parametros"]),
          );
        } catch (err) {
          console.error(`Falha ao espelhar mês ${newMonthName} no schema canônico:`, err);
        }

        setAvailableMonths((prev) =>
          prev.includes(newMonthName) ? prev : [...prev, newMonthName],
        );
        setCurrentMonth(newMonthName);
        setHelpdeskVolumes(emptyVolumes);
      } catch (err) {
        console.error(`Failed to create month ${newMonthName}:`, err);
      } finally {
        setIsLoading(false);
      }
    },
    [
      getSnapshot,
      saveMonthDataToSupabase,
      setIsLoading,
      setAvailableMonths,
      setCurrentMonth,
      setHelpdeskVolumes,
      dirtyAreas,
    ],
  );

  return { changeActiveMonth, createNewMonth, refreshCurrentMonth };
}
