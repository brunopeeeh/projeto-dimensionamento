import { useCallback } from "react";
import type { Day, IntervalStatus, TeamAgent, NewAgentHire, AgentSchedule } from "./types";
import { isTimeInShift, getLunchEndTime } from "@/lib/time";
import { generateOperatingTimeBlocks } from "@/lib/operating-hours";

export function useScheduleActions(
  setTeamAgents: React.Dispatch<React.SetStateAction<TeamAgent[]>>,
  setNewHires: React.Dispatch<React.SetStateAction<NewAgentHire[]>>,
  getNewHires: () => NewAgentHire[],
) {
  const toggleIntervalStatus = useCallback(
    (agentId: string, day: Day, time20: string) => {
      const isSimulated = getNewHires().some((h) => h.id === agentId);

      if (isSimulated) {
        setNewHires((prev) =>
          prev.map((hire) => {
            if (hire.id !== agentId) return hire;
            const schedules = hire.schedules
              ? { ...hire.schedules }
              : ({} as Record<Day, AgentSchedule>);

            if (!schedules[day]) {
              const intervals = {} as Record<string, IntervalStatus>;

              const blocks = generateOperatingTimeBlocks(20);

              blocks.forEach((block) => {
                const isLunch =
                  hire.days.includes(day) &&
                  hire.lunch_start_time &&
                  isTimeInShift(
                    block,
                    hire.lunch_start_time,
                    getLunchEndTime(hire.lunch_start_time),
                  );
                const isWorking =
                  hire.days.includes(day) && isTimeInShift(block, hire.start_time, hire.end_time);
                if (isLunch) {
                  intervals[block] = "pausa";
                } else if (isWorking) {
                  intervals[block] = "trabalhando";
                }
              });
              schedules[day] = { intervals };
            }

            const daySched = { ...schedules[day]! };
            const intervals = { ...daySched.intervals };
            const current = intervals[time20] || "folga";
            let nextStatus: IntervalStatus = "folga";
            if (current === "folga") nextStatus = "trabalhando";
            else if (current === "trabalhando") nextStatus = "externo";
            else if (current === "externo") nextStatus = "pausa";
            else if (current === "pausa") nextStatus = "folga";

            if (nextStatus === "folga") {
              delete intervals[time20];
            } else {
              intervals[time20] = nextStatus;
            }

            schedules[day] = { intervals };
            return { ...hire, schedules };
          }),
        );
      } else {
        setTeamAgents((prev) =>
          prev.map((agent) => {
            if (agent.id !== agentId) return agent;
            const schedules = { ...agent.schedules };
            const daySched = schedules[day] ? { ...schedules[day] } : { intervals: {} };
            const intervals = { ...daySched.intervals };

            const current = intervals[time20] || "folga";
            let nextStatus: IntervalStatus = "folga";
            if (current === "folga") nextStatus = "trabalhando";
            else if (current === "trabalhando") nextStatus = "externo";
            else if (current === "externo") nextStatus = "pausa";
            else if (current === "pausa") nextStatus = "folga";

            if (nextStatus === "folga") {
              delete intervals[time20];
            } else {
              intervals[time20] = nextStatus;
            }

            schedules[day] = { intervals };
            return { ...agent, schedules };
          }),
        );
      }
    },
    [getNewHires, setTeamAgents, setNewHires],
  );

  const applyPresetShift = useCallback(
    (
      agentId: string,
      day: Day,
      start: string,
      end: string,
      lunchStart: string,
      externalStart?: string,
      externalDurationMin?: number,
    ) => {
      setTeamAgents((prev) =>
        prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          const schedules = { ...agent.schedules };

          const intervals: Record<string, IntervalStatus> = {};

          const [startH, startM] = start.split(":").map(Number);
          const [endH, endM] = end.split(":").map(Number);
          const [lunchH, lunchM] = lunchStart.split(":").map(Number);

          const startMin = startH * 60 + startM;
          let endMin = endH * 60 + endM;
          if (endMin < startMin) endMin += 24 * 60;

          const lunchStartMin = lunchH * 60 + lunchM;
          const lunchEndMin = lunchStartMin + 60;

          let extStartMin = -1;
          let extEndMin = -1;
          if (externalStart && externalDurationMin && externalDurationMin > 0) {
            const [extH, extM] = externalStart.split(":").map(Number);
            extStartMin = extH * 60 + extM;
            // If the shift wraps past midnight and the external time is "earlier"
            // than the shift start, it refers to the post-midnight portion of this
            // same shift (e.g. shift 18:00-03:00 with external at 02:00).
            if (endMin >= 24 * 60 && extStartMin < startMin) {
              extStartMin += 24 * 60;
            }
            extEndMin = extStartMin + externalDurationMin;
          }

          let t = startMin;
          while (t < endMin) {
            const currentMin = t % (24 * 60);
            const h = Math.floor(currentMin / 60);
            const m = currentMin % 60;
            const timeStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

            let status: IntervalStatus = "trabalhando";

            if (t >= lunchStartMin && t < lunchEndMin) {
              status = "pausa";
            } else if (extStartMin !== -1 && t >= extStartMin && t < extEndMin) {
              status = "externo";
            }

            intervals[timeStr] = status;
            t += 20;
          }

          schedules[day] = { intervals };
          return { ...agent, schedules };
        }),
      );
    },
    [setTeamAgents],
  );

  return { toggleIntervalStatus, applyPresetShift };
}
