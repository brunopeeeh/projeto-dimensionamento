import { describe, expect, it } from "vitest";
import { buildCapacityAgents } from "./freshchat.server";

describe("buildCapacityAgents", () => {
  it("soma Freshchat e HubSpot para humanos e mantém as linhas manuais zeradas", () => {
    const result = buildCapacityAgents(
      [{ name: "Agente Humano", mediaTri: 100 }],
      [{ name: "Agente Humano", mediaTri: 50 }],
      ["Agente Humano"],
    );

    expect(result).toEqual([
      { name: "Agente Humano", mediaTri: 150 },
      { name: "Yooga Suporte", mediaTri: 0 },
      { name: "Care IA", mediaTri: 0, active: true },
    ]);
  });

  it("descarta volumes automáticos de qualquer alias de IA ou Yooga", () => {
    const result = buildCapacityAgents(
      [
        { name: "Care AI", mediaTri: 1200 },
        { name: "Yooga Tecnologia", mediaTri: 900 },
      ],
      [
        { name: "Care IA", mediaTri: 800 },
        { name: "Yooga Suporte", mediaTri: 700 },
      ],
      ["Care AI", "Care IA", "Yooga Tecnologia", "Yooga Suporte"],
    );

    expect(result).toEqual([
      { name: "Yooga Suporte", mediaTri: 0 },
      { name: "Care IA", mediaTri: 0, active: true },
    ]);
  });

  it("não inclui agentes humanos que não estão na escala ativa", () => {
    const result = buildCapacityAgents(
      [{ name: "Fora da Escala", mediaTri: 500 }],
      [],
      ["Outro Agente"],
    );

    expect(result).toEqual([
      { name: "Yooga Suporte", mediaTri: 0 },
      { name: "Care IA", mediaTri: 0, active: true },
    ]);
  });
});
