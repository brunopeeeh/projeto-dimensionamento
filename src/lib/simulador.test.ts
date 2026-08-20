import { describe, it, expect } from "vitest";
import {
  applyVolumeSpike,
  applyAbsence,
  applyTmaVariation,
  worstDeficitBlocks,
  type VolumeMap,
} from "./simulador";
import type { RowCalculation } from "@/context/types";
import { computeGridCalculations } from "./calculations";
import type { Day, TeamAgent } from "@/context/types";

function volumes(): VolumeMap {
  return {
    "10:00": { Segunda: 10, Terça: 20 } as Record<Day, number>,
    "10:10": { Segunda: 5, Terça: 7 } as Record<Day, number>,
  };
}

function agent(id: string, overrides: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    name: `Agente ${id}`,
    active: true,
    schedules: {
      Segunda: { intervals: { "10:00": "trabalhando", "10:20": "pausa" } },
      Terça: { intervals: { "10:00": "trabalhando" } },
    },
    ...overrides,
  };
}

describe("applyVolumeSpike", () => {
  it("multiplica só as colunas dos dias selecionados", () => {
    const result = applyVolumeSpike(volumes(), ["Segunda"], 50);

    expect(result["10:00"].Segunda).toBe(15); // 10 * 1.5
    expect(result["10:10"].Segunda).toBe(7.5); // 5 * 1.5
    expect(result["10:00"].Terça).toBe(20); // intocado
    expect(result["10:10"].Terça).toBe(7);
  });

  it("preserva volumes fracionários pequenos (não arredonda)", () => {
    // Os volumes reais são médias por bloco de 10min e costumam ser < 1.
    // Arredondar zeraria esses blocos e o "pico" reduziria o volume total.
    const fractional: VolumeMap = {
      "10:00": { Segunda: 0.31 } as Record<Day, number>,
    };
    const result = applyVolumeSpike(fractional, ["Segunda"], 30);

    expect(result["10:00"].Segunda).toBeCloseTo(0.403, 5);
    expect(result["10:00"].Segunda).toBeGreaterThan(fractional["10:00"].Segunda);
  });

  it("é no-op com pct 0 ou sem dias", () => {
    const original = volumes();
    expect(applyVolumeSpike(original, ["Segunda"], 0)).toBe(original);
    expect(applyVolumeSpike(original, [], 30)).toBe(original);
  });

  it("não muta o mapa original", () => {
    const original = volumes();
    applyVolumeSpike(original, ["Segunda", "Terça"], 100);

    expect(original["10:00"].Segunda).toBe(10);
    expect(original["10:00"].Terça).toBe(20);
  });

  it("aceita queda de volume com pct negativo", () => {
    const result = applyVolumeSpike(volumes(), ["Terça"], -50);
    expect(result["10:00"].Terça).toBe(10);
  });

  it("restringe o pico à faixa de horário quando informada", () => {
    const result = applyVolumeSpike(volumes(), ["Segunda"], 100, {
      start: "10:00",
      end: "10:10",
    });

    expect(result["10:00"].Segunda).toBe(20); // dentro da faixa
    expect(result["10:10"].Segunda).toBe(5); // fim é exclusivo
  });
});

describe("worstDeficitBlocks", () => {
  // waFaltam10 é indexado por dia: [Segunda, Terça, Quarta, ...].
  const row = (time: string, faltam: number[]): RowCalculation =>
    ({ time, waFaltam10: faltam }) as RowCalculation;

  it("ordena do pior para o menos pior e ignora blocos sem déficit", () => {
    const base = [row("10:00", [1, 0]), row("10:10", [0, 0])];
    const sim = [row("10:00", [4, 0]), row("10:10", [2, 0])];

    const result = worstDeficitBlocks(base, sim);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ day: "Segunda", time: "10:00", base: 1, sim: 4 });
    expect(result[1]).toEqual({ day: "Segunda", time: "10:10", base: 0, sim: 2 });
  });

  it("no empate, prioriza o bloco que o cenário mais piorou", () => {
    const base = [row("10:00", [2, 0]), row("10:10", [0, 0])];
    const sim = [row("10:00", [3, 0]), row("10:10", [3, 0])];

    const result = worstDeficitBlocks(base, sim);

    expect(result[0].time).toBe("10:10"); // piorou 3, contra 1 do outro
  });

  it("respeita o limite", () => {
    const sim = ["10:00", "10:10", "10:20"].map((t) => row(t, [5, 5]));
    expect(worstDeficitBlocks([], sim, 4)).toHaveLength(4);
  });
});

describe("applyTmaVariation", () => {
  const factors = { Segunda: 6, Terça: 12 } as Record<Day, number>;

  it("derruba a capacidade por agente quando o TMA sobe", () => {
    const result = applyTmaVariation(factors, 20);

    expect(result.Segunda).toBeCloseTo(5, 5); // 6 / 1,2
    expect(result.Terça).toBeCloseTo(10, 5);
  });

  it("aumenta a capacidade quando o TMA cai", () => {
    expect(applyTmaVariation(factors, -50).Segunda).toBeCloseTo(12, 5);
  });

  it("é no-op com 0% e ignora variação sem sentido físico (<= -100%)", () => {
    expect(applyTmaVariation(factors, 0)).toBe(factors);
    expect(applyTmaVariation(factors, -100)).toBe(factors);
  });
});

describe("applyAbsence", () => {
  it("desativa o agente quando a ausência é a semana toda", () => {
    const result = applyAbsence([agent("a1"), agent("a2")], new Set(["a1"]), []);

    expect(result[0].active).toBe(false);
    expect(result[1].active).toBe(true);
  });

  it("zera só os dias marcados quando a ausência é parcial", () => {
    const result = applyAbsence([agent("a1")], new Set(["a1"]), ["Segunda"]);

    expect(result[0].active).toBe(true); // segue no time
    expect(result[0].schedules.Segunda!.intervals["10:00"]).toBe("folga");
    expect(result[0].schedules.Segunda!.intervals["10:20"]).toBe("folga");
    expect(result[0].schedules.Terça!.intervals["10:00"]).toBe("trabalhando");
  });

  it("não muta a escala original", () => {
    const original = [agent("a1")];
    applyAbsence(original, new Set(["a1"]), ["Segunda"]);

    expect(original[0].active).toBe(true);
    expect(original[0].schedules.Segunda!.intervals["10:00"]).toBe("trabalhando");
  });

  it("é no-op sem ausentes", () => {
    const original = [agent("a1")];
    expect(applyAbsence(original, new Set(), ["Segunda"])).toBe(original);
  });

  it("zera só os blocos da faixa quando a ausência é parcial no dia", () => {
    const result = applyAbsence([agent("a1")], new Set(["a1"]), ["Segunda"], {
      start: "10:00",
      end: "10:20",
    });

    expect(result[0].active).toBe(true);
    expect(result[0].schedules.Segunda!.intervals["10:00"]).toBe("folga");
    expect(result[0].schedules.Segunda!.intervals["10:20"]).toBe("pausa"); // fora da faixa
  });

  it("com faixa e sem dias, aplica a faixa em todos os dias sem desativar o agente", () => {
    const result = applyAbsence([agent("a1")], new Set(["a1"]), [], {
      start: "10:00",
      end: "10:20",
    });

    expect(result[0].active).toBe(true);
    expect(result[0].schedules.Segunda!.intervals["10:00"]).toBe("folga");
    expect(result[0].schedules.Terça!.intervals["10:00"]).toBe("folga");
    expect(result[0].schedules.Segunda!.intervals["10:20"]).toBe("pausa");
  });
});

/**
 * Garante que as perturbações movem os KPIs na direção operacionalmente
 * correta quando passam pela engine — é isso que a coordenadora lê na tela.
 */
describe("integração com computeGridCalculations", () => {
  const days: Day[] = ["Segunda"];
  const timeBlocks = ["10:00"];

  function run(vols: VolumeMap, agents: TeamAgent[]) {
    return computeGridCalculations({
      days,
      timeBlocks,
      webchatVolumes: { "10:00": { Segunda: 2 } as Record<Day, number> },
      whatsappVolumes: vols,
      teamAgents: agents,
      dynamicTmaFactors: { Segunda: 6 } as Record<Day, number>,
      simultaneousWC: 3,
      simultaneousWA: 4,
      newHires: [],
    });
  }

  const team = [agent("a1"), agent("a2")];
  const waVolumes = { "10:00": { Segunda: 20 } as Record<Day, number> };

  it("pico de chamados aumenta o déficit", () => {
    const base = run(waVolumes, team);
    const spiked = run(applyVolumeSpike(waVolumes, ["Segunda"], 30), team);

    expect(spiked.kpis.totalDeficit10).toBeGreaterThan(base.kpis.totalDeficit10);
    expect(spiked.kpis.coberturaProjetada).toBeLessThan(base.kpis.coberturaProjetada);
  });

  it("ausência de analista aumenta o déficit", () => {
    const base = run(waVolumes, team);
    const short = run(waVolumes, applyAbsence(team, new Set(["a1"]), []));

    expect(short.kpis.totalDeficit10).toBeGreaterThan(base.kpis.totalDeficit10);
  });
});
