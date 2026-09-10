import { describe, expect, it } from "vitest";
import { buildDeficitTable } from "./ai-suggestion";
import type { RowCalculation } from "@/context/types";

describe("buildDeficitTable", () => {
  it("não envia a cobertura fixa da madrugada para contratação", () => {
    const row = {
      time: "02:50",
      faltam10: [0, 1, 1, 1, 1, 1, 0],
    } as RowCalculation;

    expect(buildDeficitTable([row])).toEqual([]);
  });

  it("mantém déficits normais para a sugestão", () => {
    const row = {
      time: "15:00",
      faltam10: [0, 1, 0, 0, 0, 0, 0],
    } as RowCalculation;

    expect(buildDeficitTable([row])).toMatchObject([{ start: "15:00", ter: 1 }]);
  });
});
