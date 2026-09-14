import { describe, expect, it } from "vitest";
import { preserveManualCapacityAgents, removeSpecialTeamAgents } from "./sync-capacity.server";

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
        { name: "Care AI", mediaTri: 1 },
        { name: "Care IA", mediaTri: 14696, active: false },
        { name: "Yooga Tecnologia", mediaTri: 2 },
        { name: "Yooga Suporte", mediaTri: 2880 },
      ],
    );

    expect(result).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 2880, active: true },
      { name: "Care IA", mediaTri: 14696, active: false },
    ]);
  });

  it("inicializa as duas linhas manuais com zero quando não há valor salvo", () => {
    expect(preserveManualCapacityAgents([{ name: "Ana", mediaTri: 500 }], [])).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 0, active: true },
      { name: "Care IA", mediaTri: 0, active: true },
    ]);
  });

  it("usa os volumes do mês anterior quando o mês atual ainda não tem as linhas manuais", () => {
    expect(
      preserveManualCapacityAgents(
        [{ name: "Ana", mediaTri: 500 }],
        [],
        [
          { name: "Yooga Suporte", mediaTri: 2880 },
          { name: "Care IA", mediaTri: 14696, active: true },
        ],
      ),
    ).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 2880, active: true },
      { name: "Care IA", mediaTri: 14696, active: true },
    ]);
  });

  it("mantém uma alteração manual no mês atual, inclusive zero e toggle inativo", () => {
    expect(
      preserveManualCapacityAgents(
        [{ name: "Ana", mediaTri: 500 }],
        [
          { name: "Yooga Suporte", mediaTri: 0 },
          { name: "Care IA", mediaTri: 12000, active: false },
        ],
        [
          { name: "Yooga Suporte", mediaTri: 2880 },
          { name: "Care IA", mediaTri: 14696, active: true },
        ],
      ),
    ).toEqual([
      { name: "Ana", mediaTri: 500 },
      { name: "Yooga Suporte", mediaTri: 0, active: true },
      { name: "Care IA", mediaTri: 12000, active: false },
    ]);
  });
});

describe("removeSpecialTeamAgents", () => {
  it("remove aliases antigos de IA e suporte do quadro humano", () => {
    const result = removeSpecialTeamAgents([
      { id: "1", name: "Ana", active: true, schedules: {} },
      { id: "2", name: "Care AI", active: true, schedules: {} },
      { id: "3", name: "Care IA", active: true, schedules: {} },
      { id: "4", name: "Yooga Suporte", active: true, schedules: {} },
    ]);

    expect(result.map((agent) => agent.name)).toEqual(["Ana"]);
  });
});
