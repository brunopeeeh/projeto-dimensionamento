import { describe, it, expect } from "vitest";
import {
  toBlock20,
  isTimeInShift,
  getLunchEndTime,
  addMinutesToTime,
  timeToOperationalMinutes,
  getActiveTimeBlocks,
  getAgentDaySummary,
} from "./time";

describe("toBlock20", () => {
  it("rounds down to the nearest 20-minute block", () => {
    expect(toBlock20("07:05")).toBe("07:00");
    expect(toBlock20("07:19")).toBe("07:00");
    expect(toBlock20("07:20")).toBe("07:20");
    expect(toBlock20("07:59")).toBe("07:40");
  });
});

describe("isTimeInShift", () => {
  it("handles a same-day shift with an exclusive end", () => {
    expect(isTimeInShift("10:00", "09:00", "18:00")).toBe(true);
    expect(isTimeInShift("08:59", "09:00", "18:00")).toBe(false);
    expect(isTimeInShift("18:00", "09:00", "18:00")).toBe(false);
  });

  it("handles a shift that crosses midnight", () => {
    expect(isTimeInShift("23:30", "18:00", "03:00")).toBe(true);
    expect(isTimeInShift("02:00", "18:00", "03:00")).toBe(true);
    expect(isTimeInShift("10:00", "18:00", "03:00")).toBe(false);
  });
});

describe("getLunchEndTime", () => {
  it("adds exactly one hour, wrapping past midnight", () => {
    expect(getLunchEndTime("12:00")).toBe("13:00");
    expect(getLunchEndTime("23:30")).toBe("00:30");
  });
});

describe("addMinutesToTime", () => {
  it("wraps minutes, hours, and days correctly", () => {
    expect(addMinutesToTime("23:50", 20)).toBe("00:10");
    expect(addMinutesToTime("09:00", 90)).toBe("10:30");
  });
});

describe("operational time ordering & overnight shifts", () => {
  it("converts times to operational minutes considering 07:00 cutoff", () => {
    expect(timeToOperationalMinutes("07:00")).toBe(420);
    expect(timeToOperationalMinutes("18:00")).toBe(1080);
    expect(timeToOperationalMinutes("23:40")).toBe(1420);
    expect(timeToOperationalMinutes("00:00")).toBe(1440);
    expect(timeToOperationalMinutes("02:40")).toBe(1600);
  });

  it("extracts active time blocks in operational order for Maria Luiza (18:00 to 03:00)", () => {
    // Maria Luiza intervals: 18:00 to 02:40 (+20m = 03:00)
    const intervals: Record<string, "trabalhando" | "pausa"> = {
      "00:00": "trabalhando",
      "00:20": "trabalhando",
      "01:00": "trabalhando",
      "02:40": "trabalhando",
      "18:00": "trabalhando",
      "18:20": "trabalhando",
      "21:00": "pausa",
      "21:20": "pausa",
      "21:40": "pausa",
      "23:40": "trabalhando",
    };

    const active = getActiveTimeBlocks(intervals);
    expect(active[0]).toBe("18:00");
    expect(active[active.length - 1]).toBe("02:40");

    const summary = getAgentDaySummary({ intervals });
    expect(summary).toBe("18:00 às 03:00 (Almoço: 21:00 às 22:00)");
  });

  it("extracts active time blocks in operational order for Rafael (16:00 to 01:00)", () => {
    // Rafael intervals on Monday/Sunday: 16:00 to 00:40 (+20m = 01:00)
    const intervals: Record<string, "trabalhando" | "pausa"> = {
      "00:00": "trabalhando",
      "00:20": "trabalhando",
      "00:40": "trabalhando",
      "16:00": "trabalhando",
      "16:20": "trabalhando",
      "21:00": "pausa",
      "21:20": "pausa",
      "21:40": "pausa",
      "23:40": "trabalhando",
    };

    const active = getActiveTimeBlocks(intervals);
    expect(active[0]).toBe("16:00");
    expect(active[active.length - 1]).toBe("00:40");

    const summary = getAgentDaySummary({ intervals });
    expect(summary).toBe("16:00 às 01:00 (Almoço: 21:00 às 22:00)");
  });
});
