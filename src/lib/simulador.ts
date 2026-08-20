import { DAYS, type Day, type RowCalculation, type TeamAgent } from "@/context/types";
import { isTimeInShift } from "@/lib/time";

export type VolumeMap = Record<string, Record<Day, number>>;

/**
 * Faixa de horário "HH:MM" com fim exclusivo, usada para restringir uma
 * perturbação a parte do dia (pico do almoço, meio período, atraso).
 * `null`/`undefined` = dia inteiro. Vira-noite é tratado por `isTimeInShift`.
 */
export type TimeRange = { start: string; end: string };

const inRange = (time: string, range?: TimeRange | null) =>
  !range || isTimeInShift(time, range.start, range.end);

/**
 * Aplica um pico de chamados (+pct%) nas colunas dos dias selecionados.
 *
 * Usado pelo simulador de cenários para responder "e se a Segunda tiver +30%
 * de chamados?" sem tocar nos volumes reais — retorna uma cópia; o mapa
 * original nunca é mutado.
 *
 * Os volumes reais são médias fracionárias por bloco de 10min (ex.: 0,31
 * chamado), não contagens inteiras — arredondar aqui zeraria os blocos abaixo
 * de 0,5 e o pico acabaria REDUZINDO o volume. A engine já aplica ceil() onde
 * o número precisa virar agente.
 *
 * Com `range`, o pico vale só naquela faixa de horário (ex.: rush do almoço),
 * e não no dia inteiro.
 */
export function applyVolumeSpike(
  vols: VolumeMap,
  days: readonly Day[],
  pct: number,
  range?: TimeRange | null,
): VolumeMap {
  if (pct === 0 || days.length === 0) return vols;

  const factor = 1 + pct / 100;
  const affected = new Set(days);
  const out: VolumeMap = {};

  for (const time of Object.keys(vols)) {
    const row = vols[time];
    const nextRow = { ...row } as Record<Day, number>;
    if (inRange(time, range)) {
      for (const day of affected) {
        const value = row[day];
        if (value) nextRow[day] = value * factor;
      }
    }
    out[time] = nextRow;
  }

  return out;
}

export type DeficitBlock = {
  day: Day;
  time: string;
  base: number;
  sim: number;
};

/**
 * Os blocos de 10min onde o cenário simulado mais dói, do pior para o menos
 * pior.
 *
 * "Faltam 3 agentes na semana" não diz onde alocar ninguém; "Segunda 11h10
 * passou de 1 para 4" diz. Ordena pelo déficit simulado e, em empate, pela
 * piora em relação ao cenário real — um bloco que já era ruim importa menos
 * que um que o cenário quebrou.
 */
export function worstDeficitBlocks(
  base: RowCalculation[],
  sim: RowCalculation[],
  limit = 8,
): DeficitBlock[] {
  const baseByTime = new Map(base.map((row) => [row.time, row]));
  const blocks: DeficitBlock[] = [];

  for (const row of sim) {
    const baseRow = baseByTime.get(row.time);
    DAYS.forEach((day, dayIndex) => {
      const simDeficit = Math.max(0, row.waFaltam10[dayIndex] ?? 0);
      if (simDeficit <= 0) return;
      blocks.push({
        day,
        time: row.time,
        base: Math.max(0, baseRow?.waFaltam10[dayIndex] ?? 0),
        sim: simDeficit,
      });
    });
  }

  return blocks.sort((a, b) => b.sim - a.sim || b.sim - b.base - (a.sim - a.base)).slice(0, limit);
}

/**
 * Varia o TMA em `pct`%: atendimento mais lento derruba a capacidade por
 * agente na mesma proporção.
 *
 * `dynamicTmaFactors` é chats por agente a cada 10min — inversamente
 * proporcional ao TMA. Por isso +20% de TMA DIVIDE o fator por 1,2 em vez de
 * multiplicar: o sinal invertido aqui é a diferença entre simular gargalo e
 * simular folga.
 */
export function applyTmaVariation(factors: Record<Day, number>, pct: number): Record<Day, number> {
  if (pct === 0) return factors;

  const divisor = 1 + pct / 100;
  // TMA -100% ou menos não tem significado físico (atendimento instantâneo).
  if (divisor <= 0) return factors;

  const out = {} as Record<Day, number>;
  for (const day of Object.keys(factors) as Day[]) {
    out[day] = factors[day] / divisor;
  }
  return out;
}

/**
 * Marca analistas como ausentes na escala simulada.
 *
 * Sem dias selecionados (`days` vazio) a ausência é total — o agente sai da
 * conta de capacidade via `active: false`. Com dias selecionados, o agente
 * continua ativo mas seus horários viram "folga" só nesses dias.
 *
 * Espelha tanto um analista mudando de setor (saída do time) quanto férias ou
 * atestado. Retorna uma cópia; a escala real nunca é mutada.
 */
export function applyAbsence(
  agents: TeamAgent[],
  absentIds: ReadonlySet<string>,
  days: readonly Day[],
  range?: TimeRange | null,
): TeamAgent[] {
  if (absentIds.size === 0) return agents;

  // Sem faixa e sem dias, a ausência é total. Com faixa, "sem dias" passa a
  // significar "essa faixa em todos os dias" (atraso fixo, meio período) —
  // desativar o agente aqui apagaria o resto do turno dele.
  const fullAbsence = !range && days.length === 0;
  const targetDays = days.length > 0 ? days : DAYS;

  return agents.map((agent) => {
    if (!absentIds.has(agent.id)) return agent;
    if (fullAbsence) return { ...agent, active: false };

    const schedules = { ...agent.schedules };
    for (const day of targetDays) {
      const schedule = schedules[day];
      if (!schedule) continue;
      const intervals = { ...schedule.intervals };
      for (const time of Object.keys(intervals)) {
        if (inRange(time, range)) intervals[time] = "folga";
      }
      schedules[day] = { intervals };
    }
    return { ...agent, schedules };
  });
}
