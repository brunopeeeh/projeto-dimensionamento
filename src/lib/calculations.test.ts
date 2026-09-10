import { describe, it, expect } from "vitest";
import {
  computeGridCalculations,
  computeDynamicTmaFactors,
  computeCapacityContributions,
} from "./calculations";
import type { Day, TeamAgent, CapacityAgent } from "@/context/types";

function agent(id: string, time20: string, day: Day): TeamAgent {
  return {
    id,
    name: `Agente ${id}`,
    active: true,
    schedules: { [day]: { intervals: { [time20]: "trabalhando" } } },
  };
}

describe("computeGridCalculations", () => {
  it("calcula déficit direto (sem overflow entre filas)", () => {
    const days: Day[] = ["Segunda"];
    const result = computeGridCalculations({
      days,
      timeBlocks: ["10:00"],
      helpdeskVolumes: { "10:00": { Segunda: 5 } as Record<Day, number> },
      teamAgents: [agent("a1", "10:00", "Segunda")],
      dynamicTmaFactors: { Segunda: 2 } as Record<Day, number>,
      simultaneous: 3,
      newHires: [],
    });

    const row = result.rowCalculations[0];
    expect(row.capacityR[0]).toBe(2); // 1 agent * factor 2
    expect(row.resultado[0]).toBe(-3); // capacityR(2) - volume(5)
    expect(row.faltam10[0]).toBe(2); // ceil(3 / capacidade por agente=2)

    expect(result.kpis.totalDeficit10).toBe(2);
    expect(result.kpis.coberturaProjetada).toBe(40); // (5-3)/5 * 100
  });

  it("sobra de capacidade zera o déficit e não aponta agentes faltando", () => {
    const days: Day[] = ["Segunda"];
    const agents = [
      agent("a1", "10:00", "Segunda"),
      agent("a2", "10:00", "Segunda"),
      agent("a3", "10:00", "Segunda"),
    ];

    const result = computeGridCalculations({
      days,
      timeBlocks: ["10:00"],
      helpdeskVolumes: { "10:00": { Segunda: 2 } as Record<Day, number> },
      teamAgents: agents,
      dynamicTmaFactors: { Segunda: 3 } as Record<Day, number>,
      simultaneous: 3,
      newHires: [],
    });

    const row = result.rowCalculations[0];
    // capacity = 3 agents * 3 = 9, volume 2 -> surplus 7
    expect(row.capacityR[0]).toBe(9);
    expect(row.resultado[0]).toBe(7);
    expect(row.faltam10[0]).toBe(-3); // floor(7 / -3) = -3 (sobra, não déficit)
    expect(result.kpis.coberturaProjetada).toBe(100);
  });

  it("contratar exatamente 'faltam10' agentes zera o déficit do bloco", () => {
    // A propriedade que o modelo antigo quebrava: capacidade era medida em
    // `factor` por agente, mas o déficit era convertido dividindo por
    // `simultaneous`. Com fator 1,63 e 3 simultâneos, o painel pedia 2 agentes
    // e, contratados, o bloco continuava em déficit.
    const days: Day[] = ["Segunda"];
    const shared = {
      days,
      timeBlocks: ["10:00"],
      helpdeskVolumes: { "10:00": { Segunda: 10 } as Record<Day, number> },
      teamAgents: [agent("a1", "10:00", "Segunda"), agent("a2", "10:00", "Segunda")],
      dynamicTmaFactors: { Segunda: 1.63 } as Record<Day, number>,
      simultaneous: 3,
    };

    const pedido = computeGridCalculations({ ...shared, newHires: [] }).rowCalculations[0]
      .faltam10[0];
    expect(pedido).toBe(4); // capacidade 4 (ceil(3,26)), déficit 6, 6/1,63 -> 4

    const reforco = Array.from({ length: pedido }, (_, i) => ({
      id: `h${i}`,
      name: `Novo ${i}`,
      start_time: "09:00",
      end_time: "18:00",
      days: ["Segunda"] as Day[],
      active: true,
    }));

    const comReforco = computeGridCalculations({ ...shared, newHires: reforco });
    expect(comReforco.rowCalculations[0].prFaltam10[0]).toBeLessThanOrEqual(0);
    expect(comReforco.kpis.provaRealDeficit10).toBe(0);
  });

  it("simultâneos escalam a capacidade unitária, não só o divisor do déficit", () => {
    const days: Day[] = ["Segunda"];
    const shared = {
      days,
      timeBlocks: ["10:00"],
      helpdeskVolumes: { "10:00": { Segunda: 6 } as Record<Day, number> },
      teamAgents: [agent("a1", "10:00", "Segunda")],
      dynamicTmaFactors: { Segunda: 3 } as Record<Day, number>,
      newHires: [],
    };

    const base = computeGridCalculations({ ...shared, simultaneous: 3 });
    const dobro = computeGridCalculations({ ...shared, simultaneous: 6 });

    // 3 -> 6 simultâneos dobra o que um agente resolve no bloco.
    expect(base.rowCalculations[0].capacityR[0]).toBe(3);
    expect(dobro.rowCalculations[0].capacityR[0]).toBe(6);
    expect(dobro.kpis.totalDeficit10).toBeLessThan(base.kpis.totalDeficit10);
  });

  it("prova real: contratações simuladas reduzem o déficit projetado sem tocar o déficit real", () => {
    const days: Day[] = ["Segunda"];
    const helpdeskVolumes = { "10:00": { Segunda: 3 } as Record<Day, number> };
    const shared = {
      days,
      timeBlocks: ["10:00"],
      helpdeskVolumes,
      teamAgents: [] as TeamAgent[],
      dynamicTmaFactors: { Segunda: 3 } as Record<Day, number>,
      simultaneous: 3,
    };

    const baseline = computeGridCalculations({ ...shared, newHires: [] });
    expect(baseline.rowCalculations[0].faltam10[0]).toBe(1); // ceil(3 / 3)

    const withHire = computeGridCalculations({
      ...shared,
      newHires: [
        {
          id: "h1",
          name: "Novo Agente",
          start_time: "09:00",
          end_time: "18:00",
          days: ["Segunda"],
          active: true,
        },
      ],
    });

    // O reforço cobre exatamente o bloco 10:00 -> déficit prova real zera.
    expect(withHire.rowCalculations[0].prFaltam10[0]).toBe(0);
    expect(withHire.kpis.provaRealDeficit10).toBe(0);
    // O déficit real (não simulado) não é afetado pelo reforço.
    expect(withHire.rowCalculations[0].faltam10[0]).toBe(1);
  });

  it("multiplica o fator somente pelos agentes humanos online em cada faixa", () => {
    const days: Day[] = ["Segunda"];
    const firstAgent: TeamAgent = {
      id: "a1",
      name: "Agente A",
      active: true,
      schedules: {
        Segunda: { intervals: { "07:00": "trabalhando", "08:00": "trabalhando" } },
      },
    };
    const secondAgent: TeamAgent = {
      id: "a2",
      name: "Agente B",
      active: true,
      schedules: { Segunda: { intervals: { "08:00": "trabalhando" } } },
    };
    const aiAgent: TeamAgent = {
      id: "ai",
      name: "Care IA",
      active: true,
      schedules: { Segunda: { intervals: { "07:00": "trabalhando" } } },
    };
    const supportAgent: TeamAgent = {
      id: "sup",
      name: "Yooga Suporte",
      active: true,
      schedules: { Segunda: { intervals: { "07:00": "trabalhando" } } },
    };
    const result = computeGridCalculations({
      days,
      timeBlocks: ["07:00", "08:00"],
      helpdeskVolumes: {},
      teamAgents: [firstAgent, secondAgent, aiAgent, supportAgent],
      dynamicTmaFactors: { Segunda: 0.85 } as Record<Day, number>,
      simultaneous: 3,
      newHires: [],
    });

    // Care IA e Yooga ajudam a formar o fator 0,85, mas não são somados como
    // agentes online na faixa. A quantidade vem exclusivamente da escala humana.
    expect(result.rowCalculations[0].capacity[0]).toBe(0.85);
    expect(result.rowCalculations[1].capacity[0]).toBe(1.7);
  });

  it("exige exatamente um humano na madrugada aberta, sem transformar volume em contratação", () => {
    const days: Day[] = ["Terça"];
    const shared = {
      days,
      timeBlocks: ["02:50"],
      helpdeskVolumes: { "02:50": { Terça: 99 } as Record<Day, number> },
      dynamicTmaFactors: { Terça: 1 } as Record<Day, number>,
      simultaneous: 3,
      newHires: [],
    };

    const uncovered = computeGridCalculations({ ...shared, teamAgents: [] });
    expect(uncovered.rowCalculations[0].faltam10[0]).toBe(1);
    expect(uncovered.kpis.totalDeficit10).toBe(1);

    const covered = computeGridCalculations({
      ...shared,
      teamAgents: [agent("maria", "02:40", "Terça")],
    });
    expect(covered.rowCalculations[0].faltam10[0]).toBe(0);
    expect(covered.kpis.totalDeficit10).toBe(0);
  });

  it("não calcula cobertura após 01:00 de segunda-feira", () => {
    const result = computeGridCalculations({
      days: ["Segunda"],
      timeBlocks: ["01:00"],
      helpdeskVolumes: { "01:00": { Segunda: 99 } as Record<Day, number> },
      teamAgents: [],
      dynamicTmaFactors: { Segunda: 1 } as Record<Day, number>,
      simultaneous: 3,
      newHires: [],
    });

    expect(result.rowCalculations[0].faltam10[0]).toBe(0);
    expect(result.kpis.helpdeskVolume).toBe(0);
  });
});

describe("computeDynamicTmaFactors", () => {
  it("reproduz 0,79 com 6 humanos + Yooga no divisor e Care IA só no volume", () => {
    const days: Day[] = ["Terça"];
    const names = ["Lucas", "Julio", "Sabrina", "Maria Luiza", "Jhorran", "Igor"];
    const mediaTri = [884, 1676, 2869, 2510, 1206, 786];
    const teamAgents = names.map((name, index) => ({
      ...agent(String(index + 1), "10:00", "Terça"),
      name,
    }));
    const capacityAgents: CapacityAgent[] = [
      ...mediaTri.map((volume, index) => ({ name: names[index], mediaTri: volume })),
      { name: "Yooga Suporte", mediaTri: 2880 }, // 1 por bloco; entra no divisor
      { name: "Care IA", mediaTri: 14696 }, // 1,134 por bloco; não entra no divisor
    ];

    const factors = computeDynamicTmaFactors(days, teamAgents, capacityAgents);

    expect(factors["Terça"]).toBe(0.79);
  });
});

describe("computeCapacityContributions", () => {
  it("normaliza a IA por 24/7 e o Suporte por jornada humana", () => {
    const capacityAgents: CapacityAgent[] = [
      { name: "Care AI", mediaTri: 12960 }, // 12960/3/30/24/6 = 1/10min
      { name: "Yooga Suporte", mediaTri: 2880 }, // 2880/3/20/8/6 = 1/10min
    ];

    const rates = computeCapacityContributions(capacityAgents);

    expect(rates.ai).toBeCloseTo(1, 5);
    expect(rates.support).toBeCloseTo(1, 5);
    expect(rates.supportSeats).toBe(1);
  });

  it("zera quando IA/Suporte ausentes", () => {
    expect(computeCapacityContributions([])).toEqual({ ai: 0, support: 0, supportSeats: 0 });
  });
});
