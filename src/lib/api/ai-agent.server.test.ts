import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  validateSuggestions,
  toNewAgentHires,
  type AiAgentSuggestion,
} from "./ai-agent.server";

// Mirrors the 4 valid folga combos from the business rules (R2 in buildSystemPrompt,
// and VALID_DAY_OFF_COMBOS in solver.ts) so tests can build compliant agents easily.
const COMBOS: Record<string, { folga: string[]; trabalha: string[] }> = {
  "sab+seg": { folga: ["sab", "seg"], trabalha: ["ter", "qua", "qui", "sex", "dom"] },
  "sab+ter": { folga: ["sab", "ter"], trabalha: ["seg", "qua", "qui", "sex", "dom"] },
  "dom+seg": { folga: ["dom", "seg"], trabalha: ["ter", "qua", "qui", "sex", "sab"] },
  "dom+ter": { folga: ["dom", "ter"], trabalha: ["seg", "qua", "qui", "sex", "sab"] },
};

function agent(
  name: string,
  combo: keyof typeof COMBOS,
  inicio: string,
  fim: string,
): AiAgentSuggestion {
  const { folga, trabalha } = COMBOS[combo];
  return { agente: name, inicio, fim, dias_trabalho: [...trabalha], folga: [...folga] };
}

describe("validateSuggestions", () => {
  it("accepts a fully compliant set of agents", () => {
    const agents = [
      agent("Agente_1", "dom+seg", "09:00", "18:00"),
      agent("Agente_2", "sab+ter", "12:00", "21:00"),
      agent("Agente_3", "dom+seg", "10:00", "19:00"),
    ];
    expect(validateSuggestions(agents).valid).toBe(true);
  });

  it("rejects a shift not in the 9 valid options (rule 1)", () => {
    const result = validateSuggestions([agent("Agente_1", "dom+seg", "09:30", "18:30")]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 1)).toBe(true);
  });

  it("rejects a folga combo outside the 4 valid options (rule 2)", () => {
    const a = agent("Agente_1", "dom+seg", "09:00", "18:00");
    a.folga = ["qua", "qui"];
    a.dias_trabalho = ["seg", "ter", "sex", "sab", "dom"];
    const result = validateSuggestions([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 2)).toBe(true);
  });

  it("rejects sabado and domingo both in dias_trabalho (rule 3)", () => {
    const a = agent("Agente_1", "dom+seg", "09:00", "18:00");
    a.dias_trabalho = ["seg", "ter", "qua", "sab", "dom"];
    a.folga = ["qui", "sex"];
    const result = validateSuggestions([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 3)).toBe(true);
  });

  it("rejects a schedule that doesn't split into 5 working days + 2 days off (rule 4)", () => {
    const a = agent("Agente_1", "dom+seg", "09:00", "18:00");
    a.dias_trabalho = ["ter", "qua", "qui", "sex"]; // only 4 days, missing "sab"
    const result = validateSuggestions([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 4)).toBe(true);
  });

  it("rejects more than 6 total agents (rule 5)", () => {
    const agents = Array.from({ length: 7 }, (_, i) =>
      agent(`Agente_${i + 1}`, i % 2 === 0 ? "dom+seg" : "sab+ter", "09:00", "18:00"),
    );
    const result = validateSuggestions(agents);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 5)).toBe(true);
  });

  it("rejects more than 2 agents sharing the same folga combo (rule 6)", () => {
    const agents = [
      agent("Agente_1", "dom+seg", "09:00", "18:00"),
      agent("Agente_2", "dom+seg", "10:00", "19:00"),
      agent("Agente_3", "dom+seg", "12:00", "21:00"),
    ];
    const result = validateSuggestions(agents);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 6)).toBe(true);
  });

  it("requires at least one late shift when 3+ agents are suggested (rule 7)", () => {
    const agents = [
      agent("Agente_1", "dom+seg", "07:00", "16:00"),
      agent("Agente_2", "sab+ter", "08:00", "17:00"),
      agent("Agente_3", "dom+ter", "09:00", "18:00"),
    ];
    const result = validateSuggestions(agents);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.rule === 7)).toBe(true);
  });
});

describe("toNewAgentHires", () => {
  it("converts abbreviated day codes into the app's full day names", () => {
    const hires = toNewAgentHires([agent("Agente_1", "dom+seg", "09:00", "18:00")]);
    expect(hires).toHaveLength(1);
    expect(hires[0].days).toEqual(["Terça", "Quarta", "Quinta", "Sexta", "Sábado"]);
    expect(hires[0].start_time).toBe("09:00");
    expect(hires[0].active).toBe(true);
  });
});

describe("AI prompts", () => {
  it("defines the input as the consolidated deficit of a single Helpdesk queue", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("ÚNICA FILA DE HELPDESK");
    expect(prompt).toContain("Não separe a análise por canal ou plataforma");
    expect(prompt).toContain("Care IA como agente humano");
    expect(prompt).toContain("Yooga Suporte ou Care IA à lista de agentes sugeridos");
    expect(prompt).toContain("ÚLTIMO horário permitido para novas contratações é 15:00 às 00:00");
    expect(prompt).toContain("não sugira turnos nem contratações para a madrugada");
  });

  it("defines positive values as missing human agents and reinforces this in the user input", () => {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt("Agosto 2026", [
      { start: "07:00", end: "07:10", seg: 1, ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0 },
    ]);

    expect(systemPrompt).toContain("0 = não falta agente");
    expect(systemPrompt).toContain("1 = falta 1 agente humano");
    expect(systemPrompt).toContain("Valores negativos não serão enviados");
    expect(userPrompt).toContain("defasagem consolidada da fila única de Helpdesk");
  });
});
