import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Dynamic env helper: reads process.env first, then falls back to reading .env directly
 * from disk so changes in .env are picked up immediately without restarting dev server.
 */
function getEnvVar(key: string): string {
  if (process.env[key]) return process.env[key]!;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
      if (match) {
        let val = match[1].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
        return val;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

/**
 * Server-only module: calls OpenRouter to suggest shift+hiring schedule for
 * new analysts, validates the response against the 5 absolute rules of the
 * 5x2 work schedule (with re-generation up to 3 retries), and caches the
 * resulting suggestion in Supabase for 24h.
 *
 * Required env:
 *   OPENROUTER_API_KEY   (server-only, no VITE_ prefix)
 *   OPENROUTER_MODEL      (optional, default: openai/gpt-4o-mini)
 *   VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY  (already used elsewhere)
 *
 * Supabase table expected: `ai_sugestoes` (see supabase/migrations/001_ai_sugestoes.sql).
 */

const NVIDIA_URL_DEFAULT = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_DEFAULT_MODEL = "z-ai/glm-5.2";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CACHE_TTL_HOURS = 24;
const MAX_RETRIES = 3;

// 9 valid 9-hour shifts (HH:00 - HH:00). Shift end is always exactly 9h after start.
// (7, 8, 9, 10, 11, 12, 13, 14, 15) -> (16, 17, 18, 19, 20, 21, 22, 23, 00)
const VALID_SHIFTS: ReadonlyArray<readonly [string, string]> = [
  ["07:00", "16:00"],
  ["08:00", "17:00"],
  ["09:00", "18:00"],
  ["10:00", "19:00"],
  ["11:00", "20:00"],
  ["12:00", "21:00"],
  ["13:00", "22:00"],
  ["14:00", "23:00"],
  ["15:00", "00:00"],
];

// 4 valid day-off combos. Everything else is forbidden by rule 3 of the prompt.
const VALID_DAY_OFF_COMBOS = [
  { folga: ["sab", "seg"], trabalha: ["ter", "qua", "qui", "sex", "dom"] },
  { folga: ["sab", "ter"], trabalha: ["seg", "qua", "qui", "sex", "dom"] },
  { folga: ["dom", "seg"], trabalha: ["ter", "qua", "qui", "sex", "sab"] },
  { folga: ["dom", "ter"], trabalha: ["seg", "qua", "qui", "sex", "sab"] },
] as const;

// Map from full Portuguese day name to the abbreviated form the AI uses.
// Reverse map for converting the AI's output back to the Day type used in app.
const SHORT_TO_DAY: Record<string, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

const DAYS_SET = new Set(Object.values(SHORT_TO_DAY));

const MAX_AGENTS_PER_MONTH = 4;

export type AiAgentSuggestion = {
  agente: string; // "Agente_1" .. "Agente_4" (or Agente_5/6 for extras)
  inicio: string; // HH:00
  fim: string; // HH:00
  dias_trabalho: string[]; // ["seg","ter","qui","sex","sab"]
  folga: string[]; // ["dom","seg"]
};

export type AiValidationError = {
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  message: string;
  agent?: string; // when error is per-agent
};

export type AiValidationResult =
  | { valid: true; agents: AiAgentSuggestion[] }
  | { valid: false; errors: AiValidationError[]; partial?: AiAgentSuggestion[] };

export type AiSuggestionResponse = {
  success: boolean;
  message: string;
  month: string;
  cached: boolean;
  attempts: number;
  agents: AiAgentSuggestion[];
  justification?: string;
  validationErrors?: AiValidationError[];
  model: string;
  generatedAt: string; // ISO
};

export type AiSuggestionRequest = {
  month: string;
  /** Input table expected by the AI prompt:
   *  [{ start: "10:00", end: "10:10", seg: 1, ter: 1, qua: 1, qui: 1, sex: 1, sab: 1, dom: 1 }, ...]
   */
  deficitTable: Array<Record<string, number | string>>;
  /** Optional override for the model. Defaults to env or DEFAULT_MODEL. */
  model?: string;
  /** When true, bypasses the 24h Supabase cache and always calls the LLM. */
  skipCache?: boolean;
};

function getSupabase() {
  const url = getEnvVar("VITE_SUPABASE_URL");
  const serviceKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = getEnvVar("VITE_SUPABASE_ANON_KEY");
  const key = serviceKey || anonKey;
  if (!url || !key) return null;
  return createClient(url, key);
}

type ChatProvider = {
  name: "nvidia" | "deepseek" | "dashscope" | "openrouter";
  url: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
  missingKeyMessage: string;
};

/**
 * Resolves which OpenAI-compatible chat provider to use.
 * Primary: NVIDIA API (z-ai/glm-5.2) → OpenRouter (z-ai/glm-5.2).
 */
function getProvider(modelOverride?: string): ChatProvider {
  const nvidiaKey = getEnvVar("NVIDIA_API_KEY");
  const openrouterKey = getEnvVar("OPENROUTER_API_KEY");

  // 1. NVIDIA API (GLM 5.2) - Primary Provider
  if (nvidiaKey || !openrouterKey) {
    return {
      name: "nvidia",
      url: getEnvVar("NVIDIA_BASE_URL") || NVIDIA_URL_DEFAULT,
      apiKey: nvidiaKey,
      model: modelOverride || getEnvVar("NVIDIA_MODEL") || NVIDIA_DEFAULT_MODEL,
      extraHeaders: {},
      missingKeyMessage:
        "NVIDIA_API_KEY não está preenchida no arquivo .env. Adicione 'NVIDIA_API_KEY=nvapi-...' no seu arquivo .env para usar o GLM-5.2.",
    };
  }

  // 2. OpenRouter fallback (preserves GLM-5.2 model target)
  return {
    name: "openrouter",
    url: OPENROUTER_URL,
    apiKey: openrouterKey,
    model: modelOverride || getEnvVar("OPENROUTER_MODEL") || NVIDIA_DEFAULT_MODEL,
    extraHeaders: {
      "HTTP-Referer": "https://dimensionamento.yooga.local",
      "X-Title": "Yooga Dimensionamento AI",
    },
    missingKeyMessage: "OPENROUTER_API_KEY não configurado no .env.",
  };
}

// --- Validation ---------------------------------------------------------

/**
 * Per-agent validation: checks rules 1, 2, 3, 4 of the prompt
 * (shift, day-off combo, sat/sun separation, 5/2 split).
 * Returns the list of errors, or empty array if valid.
 */
function validateAgent(a: AiAgentSuggestion): AiValidationError[] {
  const errors: AiValidationError[] = [];
  const id = a.agente;

  // Rule 1: shift must be one of the 9 valid shifts (exact HH:00 match, 9h span).
  const shiftOk = VALID_SHIFTS.some(([start, end]) => start === a.inicio && end === a.fim);
  if (!shiftOk) {
    errors.push({
      rule: 1,
      agent: id,
      message: `Turno ${a.inicio}–${a.fim} não está na lista dos 9 turnos válidos (07:00-16:00 até 15:00-00:00).`,
    });
  }

  // Rule 2 + 3: folga must be one of the 4 valid combos
  // AND sat/sun must not both appear in dias_trabalho.
  const folga = (a.folga as string[]).map((d) => d.toLowerCase());
  const trab = (a.dias_trabalho as string[]).map((d) => d.toLowerCase());

  const comboOk = VALID_DAY_OFF_COMBOS.some((combo) => {
    const validFolga = combo.folga;
    return (
      validFolga.length === folga.length &&
      validFolga.every((d) => folga.includes(d)) &&
      folga.every((d) => (validFolga as readonly string[]).includes(d))
    );
  });
  if (!comboOk) {
    errors.push({
      rule: 2,
      agent: id,
      message: `Combinação de folga [${a.folga.join(", ")}] inválida. Use apenas: (sáb+seg), (sáb+ter), (dom+seg) ou (dom+ter).`,
    });
  }

  if (trab.includes("sab") && trab.includes("dom")) {
    errors.push({
      rule: 3,
      agent: id,
      message: `Sábado e domingo não podem aparecer juntos nos dias_trabalho.`,
    });
  }

  // Rule 4: 5x2 split — exactly 5 working days, 2 days off.
  // Also checks that together they form exactly 7 unique days with no overlap.
  if (a.dias_trabalho.length !== 5) {
    errors.push({
      rule: 4,
      agent: id,
      message: `Dias de trabalho = ${a.dias_trabalho.length}, esperado 5.`,
    });
  }
  if (a.folga.length !== 2) {
    errors.push({
      rule: 4,
      agent: id,
      message: `Dias de folga = ${a.folga.length}, esperado 2.`,
    });
  }

  const allDays = [...trab, ...folga];
  const uniqueDays = new Set(allDays);
  if (uniqueDays.size !== 7) {
    const overlaps = allDays.filter((d, i) => allDays.indexOf(d) !== i);
    errors.push({
      rule: 4,
      agent: id,
      message: `Inconsistência nos dias: total único = ${uniqueDays.size} (esperado 7). Dias de trabalho e folga juntos devem cobrir todos os 7 dias da semana sem sobreposição.${overlaps.length > 0 ? ` Dias duplicados: [${[...new Set(overlaps)].join(", ")}].` : ""}`,
    });
  }

  return errors;
}

/**
 * Validates the full agent list. Returns the structured result.
 */
export function validateSuggestions(agents: AiAgentSuggestion[]): AiValidationResult {
  const allErrors: AiValidationError[] = [];

  for (const a of agents) {
    allErrors.push(...validateAgent(a));
  }

  // Rule 5: total agents cap (6 max)
  if (agents.length > 6) {
    allErrors.push({
      rule: 5,
      message: `Total de agentes sugeridos (${agents.length}) excede o máximo absoluto de 6.`,
    });
  }

  // Rule 6: Max 2 agents with the exact same folga combination
  const folgaCounts: Record<string, number> = {};
  for (const a of agents) {
    const folgaKey = [...a.folga].sort().join(",");
    folgaCounts[folgaKey] = (folgaCounts[folgaKey] || 0) + 1;
  }
  for (const [key, count] of Object.entries(folgaCounts)) {
    if (count > 2) {
      allErrors.push({
        rule: 6,
        message: `Muitos agentes (${count}) com a exata mesma combinação de folga [${key}]. Máximo permitido são 2 agentes por combinação para garantir cobertura diária.`,
      });
    }
  }

  // Rule 7: If >= 3 agents, at least one must start at 12:00 or later
  if (agents.length >= 3) {
    const hasLateShift = agents.some((a) => {
      const startHour = parseInt(a.inicio.split(":")[0], 10);
      return startHour >= 12;
    });
    if (!hasLateShift) {
      allErrors.push({
        rule: 7,
        message: `Como foram sugeridos ${agents.length} agentes, pelo menos um DEVE obrigatoriamente realizar o turno da tarde/noite (início às 12:00 ou mais tarde), para garantir cobertura no final do dia.`,
      });
    }
  }

  if (allErrors.length === 0) {
    return { valid: true, agents };
  }

  return { valid: false, errors: allErrors, partial: agents };
}

// --- OpenRouter call ----------------------------------------------------

function buildSystemPrompt(): string {
  return [
    "Você é um analista operacional responsável por definir a quantidade, os horários e os dias de trabalho dos agentes que devem ser contratados a cada mês para um time de suporte ao cliente.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "REGRAS ABSOLUTAS — NUNCA VIOLAR",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "R1. OS ÚNICOS TURNOS VÁLIDOS SÃO OS 9 ABAIXO. NENHUM OUTRO TURNO PODE SER SUGERIDO:",
    "   07:00 às 16:00  (inicio: '07:00', fim: '16:00')",
    "   08:00 às 17:00  (inicio: '08:00', fim: '17:00')",
    "   09:00 às 18:00  (inicio: '09:00', fim: '18:00')",
    "   10:00 às 19:00  (inicio: '10:00', fim: '19:00')",
    "   11:00 às 20:00  (inicio: '11:00', fim: '20:00')",
    "   12:00 às 21:00  (inicio: '12:00', fim: '21:00')",
    "   13:00 às 22:00  (inicio: '13:00', fim: '22:00')",
    "   14:00 às 23:00  (inicio: '14:00', fim: '23:00')",
    "   15:00 às 00:00  (inicio: '15:00', fim: '00:00')",
    "",
    "   A tabela de entrada tem faixas de 10 minutos (ex: 07:10, 08:20, 10:40).",
    "   Os turnos devem ser EXCLUSIVAMENTE horários inteiros (HH:00).",
    "   Nunca use horários fracionados como 07:10, 08:40 ou 10:20.",
    "   Escolha o turno inteiro que melhor englobe os picos de defasagem.",
    "",
    "R2. AS ÚNICAS COMBINAÇÕES DE FOLGA PERMITIDAS SÃO AS 4 ABAIXO:",
    "   Opção A — folga: ['sab', 'seg']  |  trabalha: ['ter', 'qua', 'qui', 'sex', 'dom']",
    "   Opção B — folga: ['sab', 'ter']  |  trabalha: ['seg', 'qua', 'qui', 'sex', 'dom']",
    "   Opção C — folga: ['dom', 'seg']  |  trabalha: ['ter', 'qua', 'qui', 'sex', 'sab']",
    "   Opção D — folga: ['dom', 'ter']  |  trabalha: ['seg', 'qua', 'qui', 'sex', 'sab']",
    "",
    "R3. NUNCA coloque 'sab' e 'dom' JUNTOS em dias_trabalho do mesmo agente.",
    "    Se o agente trabalha sábado, folga domingo. Se trabalha domingo, folga sábado.",
    "",
    "R4. Cada agente tem EXATAMENTE 5 dias de trabalho e 2 dias de folga (jornada 5x2).",
    "    Os 7 dias da semana devem estar cobertos sem repetição e sem omissão.",
    "    dias_trabalho.length === 5 E folga.length === 2.",
    "    Nenhum dia pode aparecer em ambos os arrays simultaneamente.",
    "",
    "R5. Limite de contratação flexível: Você deve sugerir a quantidade NECESSÁRIA de agentes (mínimo 1, máximo absoluto 6).",
    "    Tente cobrir o maior volume com 4 agentes. Se após simular 4 agentes ainda sobrarem grandes buracos na escala (defasagem alta), você ESTÁ AUTORIZADA e DEVE gerar o 5º e até o 6º agente.",
    "    Não trave no número 4 se a operação precisar de 5 ou 6.",
    "",
    "R6. LIMITE DE FOLGAS SOBREPOSTAS: No máximo 2 agentes podem ter a mesma",
    "    combinação de folgas. É terminantemente proibido colocar todos os agentes com",
    "    folga no mesmo dia (ex: todos folgando dom/seg). Você DEVE distribuir as folgas.",
    "",
    "R7. COBERTURA NOTURNA OBRIGATÓRIA: Se você sugerir 3 ou mais agentes,",
    "    pelo menos um deles DEVE obrigatoriamente fazer o turno da tarde/noite,",
    "    ou seja, iniciar às 12:00, 13:00, 14:00 ou 15:00.",
    "    Não engesse todos os agentes apenas nos turnos da manhã.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "COMO INTERPRETAR A TABELA DE DEFASAGEM",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Você receberá uma tabela com faixas de 10 minutos indicando quantos agentes",
    "estão faltando em cada horário, por dia da semana. Exemplo:",
    "",
    "  start_time  end_time  seg  ter  qua  qui  sex  sab  dom",
    "  10:00       10:10      1    1    1    1    1    1    1",
    "  10:20       10:30      2    1    1    1    1    1    0",
    "  10:30       10:40      3    2    1    1    1    1    0",
    "  10:40       10:50      2    3    2    1    1    1    0",
    "",
    "Interpretação: das 10:00 às 10:10 falta 1 agente em todos os dias.",
    "Das 10:20 às 10:40 a defasagem na segunda cresce para 2 e depois 3.",
    "No domingo de 10:20 em diante não há defasagem (0).",
    "",
    "Dica: analise a tabela como um todo, identificando onde a defasagem",
    "se concentra (horários de pico, dias mais críticos). Um turno de 8h cobre",
    "48 faixas consecutivas de 10 minutos (ex: 09:00 às 18:00 cobre de 09:00",
    "até 17:50). Priorize turnos que englobem os picos de maior defasagem.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "CRITÉRIOS DE PRIORIDADE E EQUILÍBRIO",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "P1. EQUILÍBRIO ENTRE DIAS — Os agentes devem reduzir a defasagem de forma",
    "    equilibrada entre todos os dias da semana. É melhor ter pequenas",
    "    defasagens residuais em vários dias do que um dia perfeito e outros",
    "    com gargalos severos.",
    "",
    "    Exemplo: se segunda tem defasagem alta (média 3.0) e terça tem",
    "    defasagem moderada (média 1.5), distribua 2-3 agentes para segunda",
    "    e 1-2 para terça. Não concentre todos os 4 agentes só na segunda.",
    "",
    "P2. ORDEM DE PRIORIDADE — Liste os agentes do mais impactante ao menos",
    "    impactante. O Agente_1 deve ser aquele que, sozinho, resolve o maior",
    "    volume de defasagem (maior soma de deficits cobertos pelo turno e dias",
    "    escolhidos). Agente_2 o segundo mais impactante, e assim por diante.",
    "",
    "P3. COBERTURA DE PICOS E NOITES — O turno de cada agente deve cobrir o máximo",
    "    possível das faixas com defasagem 2 ou superior. Analise a tabela",
    "    inteira antes de decidir. NÃO OTIMIZE APENAS A MANHÃ. Se houver defasagem",
    "    no final da tarde (17h-21h), você deve alocar um agente com início tardio.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "FORMATO DE SAÍDA OBRIGATÓRIO (JSON)",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Responda APENAS com um objeto JSON. Não use markdown, não adicione",
    "comentários, não inclua texto fora do JSON. O objeto deve conter",
    "obrigatoriamente as chaves 'justification' e 'agents'.",
    "",
    "{",
    '  "justification": "Análise detalhada justificando cada agente...",',
    '  "agents": [',
    "    {",
    '      "agente": "Agente_1",',
    '      "inicio": "09:00",',
    '      "fim": "18:00",',
    '      "dias_trabalho": ["ter", "qua", "qui", "sex", "sab"],',
    '      "folga": ["dom", "seg"]',
    "    }",
    "  ]",
    "}",
    "",
    "No campo 'justification' (QUE DEVE SER O PRIMEIRO CAMPO DO JSON), você DEVE " +
      "fazer uma análise reflexiva passo-a-passo ANTES de definir os agentes. " +
      "Pense em voz alta da seguinte forma:",
    "  1. Identifique os maiores picos de defasagem (dias e horários críticos) na tabela.",
    "  2. Pense na alocação do Agente_1 para cobrir o pior gargalo (escolhendo o melhor turno e folga).",
    "  3. Pense no Agente_2, Agente_3 e Agente_4 garantindo escalonamento.",
    "  4. AVALIAÇÃO CRÍTICA DE VOLUME: Analise o cenário pós-4 agentes. Sobrou defasagem severa? Se sim, decida se precisa de um Agente_5 e Agente_6. O limite máximo é 6 agentes.",
    "  5. Valide mentalmente se as folgas estão equilibradas e não violam a regra de 2 agentes com a mesma folga.",
    "  6. Conclua explicando quais defasagens residuais sobraram.",
    "  Somente APÓS escrever todo esse raciocínio detalhado em 'justification', gere o array 'agents'.",
    "IMPORTANTE: use as abreviações exatas de 3 letras: seg, ter, qua, qui, sex, sab, dom.",
    "Use APENAS os 9 turnos listados em R1. Use APENAS as 4 combinações de folga listadas em R2.",
  ].join("\n");
}

function buildUserPrompt(month: string, table: AiSuggestionRequest["deficitTable"]): string {
  const header = "start_time\tend_time\tseg\tter\tqua\tqui\tsex\tsab\tdom";
  const rows = table.map((r) =>
    [
      String(r.start ?? ""),
      String(r.end ?? ""),
      r.seg ?? 0,
      r.ter ?? 0,
      r.qua ?? 0,
      r.qui ?? 0,
      r.sex ?? 0,
      r.sab ?? 0,
      r.dom ?? 0,
    ].join("\t"),
  );
  return [
    `Mês de planejamento: ${month}`,
    "",
    "Segue a quantidade de agentes que estão faltando para cada horário:",
    "",
    header,
    ...rows,
  ].join("\n");
}

type OpenRouterMessage = { role: "system" | "user" | "assistant"; content: string };

async function callChatCompletion(
  messages: OpenRouterMessage[],
  provider: ChatProvider,
): Promise<{ content: string; raw: unknown }> {
  if (!provider.apiKey) {
    throw new Error(provider.missingKeyMessage);
  }

  const requestBody: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: 0.2,
    max_tokens: 4000,
  };

  if (provider.name !== "nvidia") {
    requestBody.response_format = { type: "json_object" };
  }

  const res = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
      ...provider.extraHeaders,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Provedor (${provider.name}) retornou ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Provedor (${provider.name}) retornou resposta vazia.`);
  }
  return { content, raw: data };
}

type ParsedAgentOutput = {
  agents: AiAgentSuggestion[];
  justification?: string;
};

/**
 * Removes reasoning/markdown wrappers that some OpenRouter providers add around
 * the JSON payload (e.g. <think> blocks, ```json fences, leading prose).
 */
function stripToJson(content: string): string {
  let text = content.trim();
  // Drop <think>...</think> reasoning blocks emitted by reasoning models.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Drop markdown code fences — tolerate a missing closing fence (truncation).
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return text.trim();
}

/**
 * Extracts the first balanced JSON object/array from arbitrary text, ignoring
 * any prose the model may have wrapped around it. Returns null if no balanced
 * structure is found (e.g. the response was truncated mid-object).
 */
function extractBalancedJson(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  if (startObj === -1 && startArr === -1) return null;

  let start: number;
  let open: string;
  let close: string;
  if (startArr === -1 || (startObj !== -1 && startObj < startArr)) {
    start = startObj;
    open = "{";
    close = "}";
  } else {
    start = startArr;
    open = "[";
    close = "]";
  }

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Strips wrappers, then JSON.parses. Falls back to extracting the first balanced
 * JSON structure when the response carries extra prose around the payload.
 */
function parseAgentJson(content: string): ParsedAgentOutput {
  const stripped = stripToJson(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const extracted = extractBalancedJson(stripped);
    if (extracted === null) {
      throw new Error("Resposta da IA não continha um JSON balanceado (possível truncamento).");
    }
    parsed = JSON.parse(extracted);
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const justification = typeof obj.justification === "string" ? obj.justification : undefined;

    // Check if agents array is directly inside a key
    for (const key of ["agents", "suggestions", "result", "data", "schedule"]) {
      if (Array.isArray(obj[key])) {
        return {
          agents: coerceAgents(obj[key] as unknown[]),
          justification,
        };
      }
    }

    // If parsed itself is an array
    if (Array.isArray(parsed)) {
      return {
        agents: coerceAgents(parsed),
        justification,
      };
    }
  }

  throw new Error("Resposta da IA não é um objeto JSON válido ou não contém um array de agentes.");
}

function normalizeTime(t: string): string {
  const clean = String(t).trim();
  if (/^\d:\d{2}$/.test(clean)) {
    return "0" + clean;
  }
  return clean;
}

function normalizeDay(d: string): string {
  const normalized = String(d)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized.startsWith("sab") ? "sab" : normalized.slice(0, 3);
}

function coerceAgents(raw: unknown[]): AiAgentSuggestion[] {
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r, i) => {
      const folga = Array.isArray(r.folga)
        ? r.folga.map(normalizeDay)
        : Array.isArray(r.days_off)
          ? r.days_off.map(normalizeDay)
          : [];

      // Auto-correct LLM hallucinations: if folga perfectly matches a valid combo,
      // override dias_trabalho with the strict mathematical complement.
      let dias_trabalho: string[] = [];
      const matchedCombo = VALID_DAY_OFF_COMBOS.find(
        (c) =>
          c.folga.length === folga.length &&
          c.folga.every((d) => folga.includes(d)) &&
          folga.every((d) => (c.folga as readonly string[]).includes(d)),
      );

      if (matchedCombo) {
        dias_trabalho = [...matchedCombo.trabalha];
      } else {
        dias_trabalho = Array.isArray(r.dias_trabalho)
          ? r.dias_trabalho.map(normalizeDay)
          : Array.isArray(r.working_days)
            ? r.working_days.map(normalizeDay)
            : [];
      }

      return {
        agente: String(r.agente ?? r.agent ?? `Agente_${i + 1}`),
        inicio: normalizeTime(String(r.inicio ?? r.start ?? "09:00")),
        fim: normalizeTime(String(r.fim ?? r.end ?? "18:00")),
        dias_trabalho,
        folga,
      };
    });
}

// --- 24h cache ----------------------------------------------------------

function normalizeDeficitTableForHash(
  table: AiSuggestionRequest["deficitTable"],
): AiSuggestionRequest["deficitTable"] {
  return [...table]
    .sort((a, b) => String(a.start ?? "").localeCompare(String(b.start ?? "")))
    .map((row) => ({
      start: String(row.start ?? ""),
      end: String(row.end ?? ""),
      seg: Number(row.seg ?? 0),
      ter: Number(row.ter ?? 0),
      qua: Number(row.qua ?? 0),
      qui: Number(row.qui ?? 0),
      sex: Number(row.sex ?? 0),
      sab: Number(row.sab ?? 0),
      dom: Number(row.dom ?? 0),
    }));
}

function hashInput(
  month: string,
  table: AiSuggestionRequest["deficitTable"],
  model: string,
): string {
  return createHash("sha256")
    .update(month)
    .update("\n")
    .update(model)
    .update("\n")
    .update(JSON.stringify(normalizeDeficitTableForHash(table)))
    .digest("hex");
}

type CachedRow = {
  id: string;
  month: string;
  input_hash: string;
  agents: AiAgentSuggestion[];
  justification: string | null;
  model: string;
  generated_at: string;
  validation_errors: AiValidationError[] | null;
};

async function getCachedSuggestion(month: string, inputHash: string): Promise<CachedRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("ai_sugestoes")
    .select("id, month, input_hash, agents, justification, model, generated_at, validation_errors")
    .eq("month", month)
    .eq("input_hash", inputHash)
    .gt("generated_at", cutoff)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[ai-agent] cache read failed:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as CachedRow;
  const hasValidationErrors =
    Array.isArray(row.validation_errors) && row.validation_errors.length > 0;
  const hasAgents = Array.isArray(row.agents) && row.agents.length > 0;

  // Never reuse failed or empty generations — force a fresh LLM call.
  if (hasValidationErrors || !hasAgents) return null;

  return row;
}

async function saveCachedSuggestion(
  month: string,
  inputHash: string,
  agents: AiAgentSuggestion[],
  justification: string | null,
  model: string,
  validationErrors: AiValidationError[] | null,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("ai_sugestoes").insert({
    month,
    input_hash: inputHash,
    agents,
    justification,
    model,
    generated_at: new Date().toISOString(),
    validation_errors: validationErrors,
  });
  if (error) {
    console.warn("[ai-agent] cache write failed:", error.message);
  }
}

// --- Public API ---------------------------------------------------------

/**
 * End-to-end: cache → generate → validate → retry → cache.
 */
export async function runAiSuggestion(req: AiSuggestionRequest): Promise<AiSuggestionResponse> {
  if (!req.month || typeof req.month !== "string") {
    return {
      success: false,
      message: "Mês/ano de planejamento é obrigatório.",
      month: req.month || "",
      cached: false,
      attempts: 0,
      agents: [],
      model: getProvider(req.model).model,
      generatedAt: new Date().toISOString(),
    };
  }
  if (!Array.isArray(req.deficitTable) || req.deficitTable.length === 0) {
    return {
      success: false,
      message: "A tabela de defasagens está vazia.",
      month: req.month,
      cached: false,
      attempts: 0,
      agents: [],
      model: getProvider(req.model).model,
      generatedAt: new Date().toISOString(),
    };
  }

  const provider = getProvider(req.model);
  const model = provider.model;
  const inputHash = hashInput(req.month, req.deficitTable, model);

  // 1. Cache lookup (skipped when the client requests a fresh analysis)
  if (!req.skipCache) {
    const cached = await getCachedSuggestion(req.month, inputHash);
    if (cached) {
      return {
        success: true,
        message: `Sugestão recuperada do cache (gerada em ${new Date(cached.generated_at).toLocaleString("pt-BR")}).`,
        month: req.month,
        cached: true,
        attempts: 0,
        agents: cached.agents,
        justification: cached.justification ?? undefined,
        model: cached.model,
        generatedAt: cached.generated_at,
      };
    }
  }

  // 2. Generate + validate + retry
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(req.month, req.deficitTable);

  let lastErrors: AiValidationError[] = [];
  let lastAgents: AiAgentSuggestion[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt;
    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    if (lastErrors.length > 0) {
      // Tell the model what's wrong so it can fix only those issues.
      messages.push({
        role: "user",
        content:
          `Sua resposta anterior violou ${lastErrors.length} regra(s). Corrija SOMENTE os pontos abaixo mantendo o restante:\n\n` +
          lastErrors
            .map((e) => `- [Regra ${e.rule}${e.agent ? ` · ${e.agent}` : ""}] ${e.message}`)
            .join("\n") +
          `\n\nLembre-se: ${MAX_AGENTS_PER_MONTH} agentes no máximo, turnos apenas da lista válida, folga entre (sáb+seg), (sáb+ter), (dom+seg) ou (dom+ter), sábado e domingo nunca juntos. Retorne obrigatoriamente um objeto JSON no formato {"agents": [...]}.`,
      });
    }

    let content: string;
    try {
      const r = await callChatCompletion(messages, provider);
      content = r.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro na chamada à IA.";
      console.warn(`[ai-agent] attempt ${attempt} failed:`, message);
      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          message: `Tentativa ${attempt}/${MAX_RETRIES} falhou: ${message}`,
          month: req.month,
          cached: false,
          attempts,
          agents: [],
          model,
          generatedAt: new Date().toISOString(),
        };
      }
      // Wait before retrying a network error
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    let agents: AiAgentSuggestion[];
    let justification: string | undefined;
    try {
      const parsedOutput = parseAgentJson(content);
      agents = parsedOutput.agents;
      justification = parsedOutput.justification;
    } catch {
      lastErrors = [
        {
          rule: 1,
          message:
            "A resposta não continha um objeto JSON válido no formato esperado. Tente novamente.",
        },
      ];
      continue;
    }

    const validation = validateSuggestions(agents);
    if (validation.valid) {
      await saveCachedSuggestion(req.month, inputHash, agents, justification ?? null, model, null);
      return {
        success: true,
        message: `Sugestão gerada com sucesso em ${attempt} tentativa(s).`,
        month: req.month,
        cached: false,
        attempts,
        agents,
        justification,
        model,
        generatedAt: new Date().toISOString(),
      };
    }

    lastErrors = validation.errors;
    lastAgents = agents;
  }

  // All retries exhausted — return best-effort with explicit warning + cache it.
  await saveCachedSuggestion(req.month, inputHash, lastAgents, null, model, lastErrors);
  return {
    success: false,
    message: `Não foi possível gerar uma sugestão válida após ${MAX_RETRIES} tentativas. Exibindo última resposta com avisos.`,
    month: req.month,
    cached: false,
    attempts: MAX_RETRIES,
    agents: lastAgents,
    validationErrors: lastErrors,
    model,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Converts the AI's output (abbreviated days) into the app's NewAgentHire shape.
 * Days not recognized are silently dropped.
 */
export function toNewAgentHires(agents: AiAgentSuggestion[]): Array<{
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  days: string[];
  active: boolean;
}> {
  return agents.map((a, i) => ({
    id: `ai-${Date.now()}-${i}`,
    name: a.agente,
    start_time: a.inicio,
    end_time: a.fim,
    days: a.dias_trabalho
      .map((d) => SHORT_TO_DAY[d.toLowerCase()] ?? d)
      .filter((d) => DAYS_SET.has(d)),
    active: true,
  }));
}
