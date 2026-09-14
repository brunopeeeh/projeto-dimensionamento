import { describe, it, expect } from "vitest";
import {
  competenciaFromMonthName,
  buildEscalaBlocosRows,
  buildVolumesFaixaRows,
  buildNewHiresRows,
  buildTeamAgentsFromCanonical,
  buildVolumesFromFaixaRows,
  buildCapacityFromCanonical,
  buildNewHiresFromCanonical,
  teamAgentsSignature,
  capacitySignature,
  volumesSignature,
  newHiresSignature,
  paramsMatch,
  DAY_ISO,
} from "./canonical-persistence";
import type { Day, NewAgentHire, TeamAgent } from "@/context/types";

describe("competenciaFromMonthName", () => {
  it("converte nome do mês em competência (dia 1)", () => {
    expect(competenciaFromMonthName("Fevereiro 2026")).toBe("2026-02-01");
    expect(competenciaFromMonthName("Março 2026")).toBe("2026-03-01");
    expect(competenciaFromMonthName("Dezembro 2027")).toBe("2027-12-01");
  });

  it("retorna null para nome não reconhecido", () => {
    expect(competenciaFromMonthName("Qualquer 2026")).toBeNull();
    expect(competenciaFromMonthName("Fevereiro")).toBeNull();
  });
});

describe("DAY_ISO", () => {
  it("segue o padrão ISO (Segunda=1 ... Domingo=7)", () => {
    expect(DAY_ISO.Segunda).toBe(1);
    expect(DAY_ISO.Domingo).toBe(7);
  });
});

describe("buildEscalaBlocosRows", () => {
  const agent: TeamAgent = {
    id: "a_1",
    name: "Ana",
    active: true,
    schedules: {
      Segunda: { intervals: { "08:00": "trabalhando", "12:00": "pausa" } },
      Domingo: { intervals: { "10:00": "externo" } },
    },
  };

  it("mapeia dia, bloco e status", () => {
    const idByNorm = new Map([["ana", "uuid-ana"]]);
    const rows = buildEscalaBlocosRows("2026-02-01", [agent], idByNorm);

    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({
      competencia: "2026-02-01",
      agente_id: "uuid-ana",
      dia_semana: 1,
      bloco: "08:00",
      status: "trabalhando",
    });
    expect(rows).toContainEqual({
      competencia: "2026-02-01",
      agente_id: "uuid-ana",
      dia_semana: 7,
      bloco: "10:00",
      status: "externo",
    });
  });

  it("ignora agente sem id mapeado", () => {
    expect(buildEscalaBlocosRows("2026-02-01", [agent], new Map())).toEqual([]);
  });
});

describe("buildVolumesFaixaRows", () => {
  it("emite uma linha por faixa/dia com canal helpdesk e fonte manual", () => {
    const volumes: Record<string, Record<Day, number>> = {
      "07:00": { Segunda: 1.5, Terça: 2 } as Record<Day, number>,
    };
    const rows = buildVolumesFaixaRows("2026-02-01", volumes);

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      competencia: "2026-02-01",
      canal: "helpdesk",
      dia_semana: 1,
      faixa: "07:00",
      volume: 1.5,
      fonte: "manual",
    });
  });
});

describe("buildNewHiresRows", () => {
  it("mapeia contratações, dias ISO e id_front", () => {
    const hires: NewAgentHire[] = [
      {
        id: "h1",
        name: "Reforço 1",
        start_time: "09:00",
        end_time: "18:00",
        lunch_start_time: "12:00",
        days: ["Terça", "Quarta"],
        active: true,
      },
    ];
    const rows = buildNewHiresRows("2026-02-01", hires);

    expect(rows).toEqual([
      {
        competencia: "2026-02-01",
        nome: "Reforço 1",
        hora_inicio: "09:00",
        hora_fim: "18:00",
        almoco_inicio: "12:00",
        dias_semana: [2, 3],
        ativo: true,
        escala_custom: null,
        id_front: "h1",
      },
    ]);
  });
});

describe("buildTeamAgentsFromCanonical", () => {
  const agentes = [
    { id: "uuid-1", nome: "Ana", id_front: "a_1" },
    { id: "uuid-2", nome: "Bia", id_front: null },
  ];

  it("remonta TeamAgent[] com id_front, ordem e blocos", () => {
    const roster = [
      { agente_id: "uuid-2", ordem: 1, ativo: true, id_front: null },
      { agente_id: "uuid-1", ordem: 0, ativo: false, id_front: "a_old" },
    ];
    const blocks = [
      { agente_id: "uuid-1", dia_semana: 1, bloco: "08:00:00", status: "trabalhando" },
      { agente_id: "uuid-1", dia_semana: 1, bloco: "12:00:00", status: "pausa" },
    ];
    const result = buildTeamAgentsFromCanonical(roster, blocks, agentes);

    expect(result).toEqual([
      {
        id: "a_old",
        name: "Ana",
        active: false,
        schedules: {
          Segunda: { intervals: { "08:00": "trabalhando", "12:00": "pausa" } },
        },
      },
      { id: "uuid-2", name: "Bia", active: true, schedules: {} },
    ]);
  });

  it("retorna null sem roster (fallback legado)", () => {
    expect(buildTeamAgentsFromCanonical([], [], agentes)).toBeNull();
  });
});

describe("buildVolumesFromFaixaRows", () => {
  it("prefere a fonte manual sobre o backfill legado", () => {
    const rows = [
      { dia_semana: 1, faixa: "07:00:00", volume: 9, fonte: "legado_jsonb" },
      { dia_semana: 1, faixa: "07:00:00", volume: 3, fonte: "manual" },
    ];
    expect(buildVolumesFromFaixaRows(rows)).toEqual({ "07:00": { Segunda: 3 } });
  });

  it("retorna null quando vazio", () => {
    expect(buildVolumesFromFaixaRows([])).toBeNull();
  });
});

describe("buildCapacityFromCanonical", () => {
  it("mapeia nome, resolvidos e ativo", () => {
    expect(
      buildCapacityFromCanonical([{ nome: "Ana", resolvidos_tri: 120, ativo: false }]),
    ).toEqual([{ name: "Ana", mediaTri: 120, active: false }]);
    expect(buildCapacityFromCanonical([])).toBeNull();
  });
});

describe("buildNewHiresFromCanonical", () => {
  it("mapeia horas, dias ISO e id_front", () => {
    const rows = [
      {
        id: "uuid-h1",
        id_front: "h1",
        nome: "Reforço 1",
        hora_inicio: "09:00:00",
        hora_fim: "18:00:00",
        almoco_inicio: "12:00:00",
        dias_semana: [2, 3],
        ativo: true,
        escala_custom: null,
      },
    ];
    expect(buildNewHiresFromCanonical(rows)).toEqual([
      {
        id: "h1",
        name: "Reforço 1",
        start_time: "09:00",
        end_time: "18:00",
        lunch_start_time: "12:00",
        days: ["Terça", "Quarta"],
        active: true,
      },
    ]);
  });

  it("retorna null quando vazio (fallback legado preserva defaults)", () => {
    expect(buildNewHiresFromCanonical([])).toBeNull();
  });
});

describe("assinaturas de paridade (guard da virada)", () => {
  const agent = (over: Partial<TeamAgent> = {}): TeamAgent => ({
    id: "a1",
    name: "Ana",
    active: true,
    schedules: { Segunda: { intervals: { "08:00": "trabalhando" } } },
    ...over,
  });

  it("teamAgentsSignature ignora ordem dos dias, mas detecta divergência", () => {
    const a = [agent()];
    const b = [agent({ schedules: { Segunda: { intervals: { "08:00": "trabalhando" } } } })];
    const c = [agent({ schedules: { Segunda: { intervals: { "08:00": "pausa" } } } })];
    expect(teamAgentsSignature(a)).toBe(teamAgentsSignature(b));
    expect(teamAgentsSignature(a)).not.toBe(teamAgentsSignature(c));
  });

  it("capacitySignature é insensível à ordem e considera ativo", () => {
    const a = [
      { name: "Ana", mediaTri: 100, active: true },
      { name: "Bia", mediaTri: 50 },
    ];
    const b = [
      { name: "Bia", mediaTri: 50 },
      { name: "Ana", mediaTri: 100, active: true },
    ];
    expect(capacitySignature(a)).toBe(capacitySignature(b));
    expect(capacitySignature(a)).not.toBe(
      capacitySignature([
        { name: "Ana", mediaTri: 100, active: false },
        { name: "Bia", mediaTri: 50 },
      ]),
    );
  });

  it("volumesSignature compara faixa/dia/valor", () => {
    const v = { "07:00": { Segunda: 1 } as Record<Day, number> };
    const w = { "07:00": { Segunda: 1 } as Record<Day, number> };
    const x = { "07:00": { Segunda: 2 } as Record<Day, number> };
    expect(volumesSignature(v)).toBe(volumesSignature(w));
    expect(volumesSignature(v)).not.toBe(volumesSignature(x));
  });

  it("newHiresSignature inclui dias e horários", () => {
    const hire: NewAgentHire = {
      id: "h1",
      name: "Reforço",
      start_time: "09:00",
      end_time: "18:00",
      days: ["Terça"],
      active: true,
    };
    expect(newHiresSignature([hire])).toBe(newHiresSignature([{ ...hire }]));
    expect(newHiresSignature([hire])).not.toBe(newHiresSignature([{ ...hire, active: false }]));
  });

  it("paramsMatch valida TMA, simultâneos e cenário", () => {
    const tma = { Segunda: 1.63 } as Record<Day, number>;
    const scen = { clientBase: 1, contactRate: 2, turnoverRate: 3, slaTarget: 95 };
    const legacy = { tmaFactors: tma, simultaneous: 3, scenarios: scen };
    expect(paramsMatch({ tmaFactors: tma, simultaneous: 3, scenarios: scen }, legacy)).toBe(true);
    expect(paramsMatch({ tmaFactors: tma, simultaneous: 4, scenarios: scen }, legacy)).toBe(false);
    expect(paramsMatch({ tmaFactors: null, simultaneous: 3, scenarios: scen }, legacy)).toBe(false);
  });
});
