import type { SupabaseClient } from "@supabase/supabase-js";
import type { Override, OverrideKind } from "./types";

/**
 * Ponte entre as exceções de escala do EscalaOps (Record<dataISO,
 * Record<agenteId, Override>>) e a tabela `escala_excecoes`.
 *
 * O banco é a fonte de verdade quando o Supabase está configurado; o
 * localStorage continua como cache/fallback offline. As funções puras
 * (competenciaOf, rowToOverride, overrideToRow, changedDates) ficam
 * separadas das de I/O para serem testáveis sem mock de rede.
 */

export type ExcecaoRow = {
  competencia: string;
  agente_id: string;
  data: string;
  kind: OverrideKind;
  shift_start: string | null;
  shift_end: string | null;
  pause_override: boolean;
  pause_start: string | null;
  pause_end: string | null;
  note: string | null;
};

export type OverridesMap = Record<string, Record<string, Override>>;

const OVERRIDE_KINDS: readonly OverrideKind[] = ["falta", "atestado", "ferias", "extra", "ajuste"];

/** "2026-02-14" → "2026-02-01" (dia 1 da competência). */
export function competenciaOf(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

const hhmm = (t: string): string => t.slice(0, 5);

/** Converte uma linha de `escala_excecoes` no Override consumido pelo EscalaOps. */
export function rowToOverride(row: ExcecaoRow): Override {
  const ov: Override = { kind: row.kind };
  if (row.shift_start && row.shift_end) {
    ov.shift = [hhmm(row.shift_start), hhmm(row.shift_end)];
  }
  if (row.pause_override) {
    ov.pause =
      row.pause_start && row.pause_end ? [hhmm(row.pause_start), hhmm(row.pause_end)] : null;
  }
  if (row.note) ov.note = row.note;
  return ov;
}

/** Converte um Override na linha correspondente do banco. */
export function overrideToRow(dateISO: string, agenteId: string, ov: Override): ExcecaoRow {
  return {
    competencia: competenciaOf(dateISO),
    agente_id: agenteId,
    data: dateISO,
    kind: ov.kind,
    shift_start: ov.shift?.[0] ?? null,
    shift_end: ov.shift?.[1] ?? null,
    pause_override: ov.pause !== undefined,
    pause_start: ov.pause?.[0] ?? null,
    pause_end: ov.pause?.[1] ?? null,
    note: ov.note ?? null,
  };
}

/** Chave estável de um Override (independe da ordem das propriedades). */
function overrideKey(ov: Override | undefined): string {
  if (!ov) return "";
  return JSON.stringify({
    kind: ov.kind,
    shift: ov.shift ?? null,
    pauseSet: ov.pause !== undefined,
    pause: ov.pause ?? null,
    note: ov.note ?? "",
  });
}

function dateKey(entries: Record<string, Override> | undefined): string {
  if (!entries) return "";
  return Object.keys(entries)
    .sort()
    .map((agenteId) => `${agenteId}:${overrideKey(entries[agenteId])}`)
    .join("|");
}

/** Datas cujo conteúdo de exceções realmente mudou entre dois mapas. */
export function changedDates(prev: OverridesMap, next: OverridesMap): string[] {
  const dates = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...dates].filter((date) => dateKey(prev[date]) !== dateKey(next[date]));
}

/** Lê todas as exceções e remonta o mapa usado pelo EscalaOps. */
export async function loadExcecoes(client: SupabaseClient): Promise<OverridesMap> {
  const { data, error } = await client.from("escala_excecoes").select("*");
  if (error) throw error;

  const map: OverridesMap = {};
  for (const row of (data ?? []) as ExcecaoRow[]) {
    if (!OVERRIDE_KINDS.includes(row.kind)) continue;
    if (!map[row.data]) map[row.data] = {};
    map[row.data][row.agente_id] = rowToOverride(row);
  }
  return map;
}

/**
 * Persiste apenas as datas que mudaram, substituindo o conjunto inteiro
 * daquela data (delete + insert). Simples e idempotente — o volume de
 * exceções por dia é pequeno e a edição é single-user.
 */
export async function persistExcecoes(
  client: SupabaseClient,
  prev: OverridesMap,
  next: OverridesMap,
): Promise<void> {
  for (const date of changedDates(prev, next)) {
    const { error: deleteError } = await client
      .from("escala_excecoes")
      .delete()
      .eq("competencia", competenciaOf(date))
      .eq("data", date);
    if (deleteError) throw deleteError;

    const entries = next[date];
    if (!entries || Object.keys(entries).length === 0) continue;

    const rows = Object.entries(entries).map(([agenteId, ov]) => overrideToRow(date, agenteId, ov));
    const { error: insertError } = await client.from("escala_excecoes").insert(rows);
    if (insertError) throw insertError;
  }
}
