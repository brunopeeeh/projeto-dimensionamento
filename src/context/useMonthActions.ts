import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
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
  saveMonthDataToSupabase: (monthName: string) => Promise<void>,
  loadMonthDataFromSupabase: (monthName: string) => Promise<void>,
  getSnapshot: () => CreateMonthParams,
) {
  const changeActiveMonth = useCallback(
    async (monthName: string) => {
      const client = supabase;
      if (!client) {
        setCurrentMonth(monthName);
        return;
      }

      const snap = getSnapshot();

      try {
        setIsLoading(true);
        await saveMonthDataToSupabase(snap.currentMonth);
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
        await saveMonthDataToSupabase(snap.currentMonth);

        const { data: newMonth, error: insertError } = await client
          .from("meses")
          .insert([{ nome: newMonthName }])
          .select()
          .single();

        if (insertError) throw insertError;
        const newMesId = newMonth.id;

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

        const { data: monthsData, error: monthsError } = await client
          .from("meses")
          .select("nome")
          .order("created_at", { ascending: true });

        if (monthsError) throw monthsError;

        const updatedMonths = monthsData.map((m: { nome: string }) => m.nome);
        setAvailableMonths(updatedMonths);
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
    ],
  );

  return { changeActiveMonth, createNewMonth, refreshCurrentMonth };
}
