import { describe, expect, it } from "vitest";
import {
  FIXED_OVERNIGHT_AGENTS,
  generateOperatingTimeBlocks,
  hasFixedOvernightCoverage,
  isHelpdeskOpen,
} from "./operating-hours";

describe("operating hours", () => {
  it("gera somente a janela operacional de 07:00 até 03:00", () => {
    const blocks = generateOperatingTimeBlocks(10);

    expect(blocks).toHaveLength(120);
    expect(blocks[0]).toBe("07:00");
    expect(blocks.at(-1)).toBe("02:50");
    expect(blocks).not.toContain("03:00");
  });

  it("mantém domingo e segunda abertos somente até 01:00", () => {
    expect(isHelpdeskOpen("Segunda", "00:50")).toBe(true);
    expect(isHelpdeskOpen("Segunda", "01:00")).toBe(false);
    expect(isHelpdeskOpen("Domingo", "00:50")).toBe(true);
    expect(isHelpdeskOpen("Domingo", "01:00")).toBe(false);
  });

  it("mantém terça a sábado abertos até 03:00 com uma posição fixa", () => {
    expect(isHelpdeskOpen("Terça", "02:50")).toBe(true);
    expect(isHelpdeskOpen("Terça", "03:00")).toBe(false);
    expect(hasFixedOvernightCoverage("Terça", "02:50")).toBe(true);
    expect(hasFixedOvernightCoverage("Segunda", "00:50")).toBe(true);
    expect(FIXED_OVERNIGHT_AGENTS).toBe(1);
  });
});
