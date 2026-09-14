// Shared time helpers for the scheduling grid.
// Agent schedules are stored in 20-minute blocks while volume/capacity rows
// are 10-minute granular, so conversions must go through a single source.

export const BLOCK_MINUTES = 20;
export const EARLY_SHIFT_CUTOFF_HOUR = 7;
const SORT_FALLBACK_MINUTES = 24 * 60 * 2;

export type IntervalStatus = "trabalhando" | "pausa" | "folga" | "externo";

export type ScheduleLike = {
  intervals: Record<string, IntervalStatus>;
};

export const toBlock20 = (time: string): string => {
  const [h, m] = time.split(":").map(Number);
  const m20 = Math.floor(m / 20) * 20;
  return `${h.toString().padStart(2, "0")}:${m20.toString().padStart(2, "0")}`;
};

export const isTimeInShift = (time: string, start: string, end: string): boolean => {
  const [h, m] = time.split(":").map(Number);
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);

  const val = h * 60 + m;
  const startVal = startH * 60 + startM;
  let endVal = endH * 60 + endM;

  if (endVal < startVal) {
    endVal += 24 * 60;
    const nextDayVal = val + 24 * 60;
    return (val >= startVal && val < 24 * 60) || (nextDayVal >= startVal && nextDayVal < endVal);
  }

  return val >= startVal && val < endVal;
};

export const addMinutesToTime = (timeStr: string, minutes: number): string => {
  const [h, m] = timeStr.split(":").map(Number);
  let nh = h;
  let nm = m + minutes;
  if (nm >= 60) {
    nh += Math.floor(nm / 60);
    nm %= 60;
  }
  if (nh >= 24) nh %= 24;
  return `${nh.toString().padStart(2, "0")}:${nm.toString().padStart(2, "0")}`;
};

export const getNext20MinTime = (timeStr: string) => addMinutesToTime(timeStr, BLOCK_MINUTES);

export const getLunchEndTime = (lunchStart: string): string => {
  const [h, m] = lunchStart.split(":").map(Number);
  const endH = (h + 1) % 24;
  return `${endH.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

export const getDefaultLunchTime = (startTime: string): string => {
  const [h] = startTime.split(":").map(Number);
  if (isNaN(h)) return "12:00";
  if (h === 7) return "11:00";
  if (h === 8) return "12:00";
  if (h === 9) return "13:00";
  if (h === 10 || h === 11) return "14:00";
  if (h === 12) return "15:00";
  if (h === 13) return "17:00";
  if (h === 14) return "18:00";
  if (h === 15) return "19:00";
  if (h === 16) return "20:00";
  if (h === 18) return "22:00";
  const lunchH = (h + 4) % 24;
  return `${lunchH.toString().padStart(2, "0")}:00`;
};

const isActiveInterval = (status: IntervalStatus) =>
  status === "trabalhando" || status === "externo" || status === "pausa";

export const timeToOperationalMinutes = (
  time: string,
  cutoffHour = EARLY_SHIFT_CUTOFF_HOUR,
): number => {
  const [h, m] = time.split(":").map(Number);
  const adjustedH = h < cutoffHour ? h + 24 : h;
  return adjustedH * 60 + m;
};

export const getActiveTimeBlocks = (intervals: Record<string, IntervalStatus>): string[] =>
  Object.keys(intervals)
    .filter((time) => isActiveInterval(intervals[time]))
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));

export const getAgentStartTimeMinutes = (
  schedules: Partial<Record<string, ScheduleLike>> | undefined,
  day: string,
): number => {
  const daySched = schedules?.[day];
  if (!daySched?.intervals) return SORT_FALLBACK_MINUTES;

  const activeBlocks = getActiveTimeBlocks(daySched.intervals);
  if (activeBlocks.length === 0) return SORT_FALLBACK_MINUTES;

  const [h, m] = activeBlocks[0].split(":").map(Number);
  let mins = h * 60 + m;
  if (h < EARLY_SHIFT_CUTOFF_HOUR) mins += 24 * 60;
  return mins;
};

export const getAgentLunchStartMinutes = (
  schedules: Partial<Record<string, ScheduleLike>> | undefined,
  day: string,
): number => {
  const daySched = schedules?.[day];
  if (!daySched?.intervals) return SORT_FALLBACK_MINUTES;

  const lunchBlocks = Object.keys(daySched.intervals)
    .filter((time) => daySched.intervals[time] === "pausa")
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
  if (lunchBlocks.length === 0) return SORT_FALLBACK_MINUTES;

  return timeToOperationalMinutes(lunchBlocks[0]);
};

export type SortableAgent = {
  name: string;
  schedules: Partial<Record<string, ScheduleLike>>;
};

export const sortAgentsByShiftStart = <T extends SortableAgent>(agents: T[], day: string): T[] =>
  [...agents].sort((a, b) => {
    const timeA = getAgentStartTimeMinutes(a.schedules, day);
    const timeB = getAgentStartTimeMinutes(b.schedules, day);
    if (timeA !== timeB) return timeA - timeB;

    const lunchA = getAgentLunchStartMinutes(a.schedules, day);
    const lunchB = getAgentLunchStartMinutes(b.schedules, day);
    if (lunchA !== lunchB) return lunchA - lunchB;

    return a.name.localeCompare(b.name);
  });

export const getShiftRangeFromSchedule = (
  daySched: ScheduleLike | undefined | null,
  options?: { offLabel?: string; separator?: string },
): string => {
  const offLabel = options?.offLabel ?? "FOLGA";
  const separator = options?.separator ?? " - ";

  if (!daySched?.intervals) return offLabel;

  const activeBlocks = getActiveTimeBlocks(daySched.intervals);
  if (activeBlocks.length === 0) return offLabel;

  const start = activeBlocks[0];
  const end = getNext20MinTime(activeBlocks[activeBlocks.length - 1]);
  return `${start}${separator}${end}`;
};

export const getAgentDaySummary = (daySched: ScheduleLike | undefined | null): string => {
  if (!daySched?.intervals) return "Folga";

  const intervals = daySched.intervals;
  const activeBlocks = getActiveTimeBlocks(intervals);

  if (activeBlocks.length === 0) return "Folga";

  const startTime = activeBlocks[0];
  const endTime = getNext20MinTime(activeBlocks[activeBlocks.length - 1]);

  const lunchBlocks = Object.keys(intervals)
    .filter((time) => intervals[time] === "pausa")
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
  let lunchSummary = "";
  if (lunchBlocks.length > 0) {
    const lunchStart = lunchBlocks[0];
    const lunchEnd = getNext20MinTime(lunchBlocks[lunchBlocks.length - 1]);
    lunchSummary = ` (Almoço: ${lunchStart} às ${lunchEnd})`;
  }

  const externalBlocks = Object.keys(intervals)
    .filter((time) => intervals[time] === "externo")
    .sort((a, b) => timeToOperationalMinutes(a) - timeToOperationalMinutes(b));
  let extSummary = "";
  if (externalBlocks.length > 0) {
    const extStart = externalBlocks[0];
    const extEnd = getNext20MinTime(externalBlocks[externalBlocks.length - 1]);
    extSummary = ` (Offchat: ${extStart} às ${extEnd})`;
  }

  return `${startTime} às ${endTime}${lunchSummary}${extSummary}`;
};

export const getNewHireDayShift = (
  hire: {
    days: string[];
    start_time: string;
    end_time: string;
    schedules?: Partial<Record<string, ScheduleLike>>;
  },
  day: string,
  options?: { offLabel?: string; separator?: string },
): string => {
  if (hire.schedules?.[day]) {
    return getShiftRangeFromSchedule(hire.schedules[day], options);
  }
  if (hire.days.includes(day)) {
    const separator = options?.separator ?? " - ";
    return `${hire.start_time}${separator}${hire.end_time}`;
  }
  return options?.offLabel ?? "FOLGA";
};
