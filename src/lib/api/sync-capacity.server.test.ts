import { describe, expect, it } from "vitest";
import { preserveManualCapacityAgents } from "./sync-capacity.server";

describe("preserveManualCapacityAgents", () => {
  it("preserva Care IA e Yooga Suporte editados manualmente", () => {
    const result = preserveManualCapacityAgents(
      [
        { name: "Ana", mediaTri: 500 },
        { name: "Care AI", mediaTri: 9999 },
        { name: "Yooga Tecnologia", mediaTri: 8888 },
      ],
      [
        { name: "Ana", mediaTri: 400 },
        { name: "Care IA", mediaTri: 14696 },
        { name: "Yooga Suporte", mediaTri: 2880 },
      ],
    );

    expect(result).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 2880 },
      { name: "Care IA", mediaTri: 14696 },
    ]);
  });

  it("inicializa as duas linhas manuais com zero quando não há valor salvo", () => {
    expect(preserveManualCapacityAgents([{ name: "Ana", mediaTri: 500 }], [])).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 0 },
      { name: "Care IA", mediaTri: 0 },
    ]);
  });
});
