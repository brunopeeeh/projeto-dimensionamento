import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAYS,
  type Day,
  type TeamAgent,
  type CapacityAgent,
  type NewAgentHire,
  type ScenarioParams,
  type AgentSchedule,
  type IntervalStatus,
} from "@/context/types";
import { isAiAgent, isSupportAgent, normalizeName } from "@/lib/agents";

/**
 * Dual-write para o schema canônico (tabelas `agentes`, `escala_blocos`,
 * `capacity_snapshots`, `volumes_faixa`, `parametros`, `novas_contratacoes`).
 *
 * O legado JSONB continua sendo a fonte de leitura nesta fase — o canônico
 * é espelhado a cada salvamento para permitir a verificação de paridade e a
 * virada de leitura depois. Falhas aqui são registradas, nunca propagadas
 * para o save legado.
 */

export type CanonicalArea = "escala" | "volumes" | "parametros";

export type CanonicalSnapshot = {
  teamAgents?: TeamAgent[];
  capacityAgents?: CapacityAgent[];
  helpdeskVolumes?: Record<string, Record<Day, number>>;
  tmaFactors?: Record<Day, number>;
  simultaneous?: number;
  scenarios?: ScenarioParams;
  newHires?: NewAgentHire[];
};

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

export const DAY_ISO: Record<Day, number> = {
  Segunda: 1,
  Terça: 2,
  Quarta: 3,
  Quinta: 4,
  Sexta: 5,
  Sábado: 6,
  Domingo: 7,
};

export const ISO_DAY: Record<number, Day> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

const INTERVAL_STATUSES = new Set<string>(["trabalhando", "pausa", "folga", "externo"]);

// ---------------------------------------------------------------------------
// Assinaturas de paridade (guard da virada de leitura)
//
// O canônico só é confiável para leitura quando espelha o legado. Enquanto
// houver cliente escrevendo só no legado (código antigo), o canônico pode
// estar defasado — ler dele apagaria dados no próximo save. Estas assinaturas
// comparam as duas fontes; divergiu, a leitura usa o legado.
// ---------------------------------------------------------------------------

export function teamAgentsSignature(agents: TeamAgent[]): string {
  return agents
    .map((agent) => {
      const keys: string[] = [];
      for (const day of DAYS) {
        const intervals = agent.schedules?.[day]?.intervals;
        if (!intervals) continue;
        for (const [time, status] of Object.entries(intervals)) {
          keys.push(`${day}|${time}|${status}`);
        }
      }
      return `${agent.id}#${agent.name}#${agent.active}#${keys.sort().join(";")}`;
    })
    .join("||");
}

export function capacitySignature(agents: CapacityAgent[]): string {
  return agents
    .map((a) => `${a.name}#${a.mediaTri}#${a.active ?? ""}`)
    .sort()
    .join("||");
}

export function volumesSignature(volumes: Record<string, Record<Day, number>>): string {
  const keys: string[] = [];
  for (const [time, byDay] of Object.entries(volumes)) {
    for (const day of DAYS) {
      const value = byDay?.[day];
      if (typeof value === "number") keys.push(`${day}|${time}|${value}`);
    }
  }
  return keys.sort().join("||");
}

export function newHiresSignature(hires: NewAgentHire[]): string {
  return hires
    .map(
      (h) =>
        `${h.id}#${h.name}#${h.start_time}#${h.end_time}#${h.lunch_start_time ?? ""}#${h.days.join(",")}#${h.active}`,
    )
    .join("||");
}

export function paramsMatch(
  canonical: {
    tmaFactors: Record<Day, number> | null;
    simultaneous: number | null;
    scenarios: ScenarioParams | null;
  },
  legacy: {
    tmaFactors: Record<Day, number>;
    simultaneous: number;
    scenarios: ScenarioParams;
  },
): boolean {
  if (!canonical.tmaFactors || canonical.simultaneous === null || !canonical.scenarios)
    return false;
  for (const day of DAYS) {
    if (Math.abs((canonical.tmaFactors[day] ?? NaN) - (legacy.tmaFactors[day] ?? NaN)) > 1e-9) {
      return false;
    }
  }
  if (canonical.simultaneous !== legacy.simultaneous) return false;
  const a = canonical.scenarios;
  const b = legacy.scenarios;
  return (
    a.clientBase === b.clientBase &&
    a.contactRate === b.contactRate &&
    a.turnoverRate === b.turnoverRate &&
    a.slaTarget === b.slaTarget
  );
}

/**
 * Normalização equivalente a `lower(fn_unaccent(nome))` do banco: minúsculas
 * e sem acentos, mas preservando espaços/números/pontuação. Não usar
 * `normalizeName` (de @/lib/agents) aqui: ele remove tudo que não é letra e
 * colidiria "Agente 1" com "Agente 2".
 */
const dbNorm = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** "Fevereiro 2026" → "2026-02-01". Retorna null se não reconhecer. */
export function competenciaFromMonthName(name: string): string | null {
  const yearMatch = name.match(/\d{4}/);
  if (!yearMatch) return null;
  const firstWord = normalizeName(name.trim().split(/\s+/)[0] ?? "");
  const month = MONTHS[firstWord];
  if (!month) return null;
  return `${yearMatch[0]}-${String(month).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Builders puros (testáveis sem rede)
// ---------------------------------------------------------------------------

export type EscalaBlocoRow = {
  competencia: string;
  agente_id: string;
  dia_semana: number;
  bloco: string;
  status: string;
};

export function buildEscalaBlocosRows(
  competencia: string,
  teamAgents: TeamAgent[],
  idByNorm: Map<string, string>,
): EscalaBlocoRow[] {
  const rows: EscalaBlocoRow[] = [];
  for (const agent of teamAgents) {
    const agenteId = idByNorm.get(dbNorm(agent.name));
    if (!agenteId) continue;
    for (const day of DAYS) {
      const intervals = agent.schedules?.[day]?.intervals;
      if (!intervals) continue;
      for (const [bloco, status] of Object.entries(intervals)) {
        rows.push({
          competencia,
          agente_id: agenteId,
          dia_semana: DAY_ISO[day],
          bloco,
          status,
        });
      }
    }
  }
  return rows;
}

export type VolumeFaixaRow = {
  competencia: string;
  canal: string;
  dia_semana: number;
  faixa: string;
  volume: number;
  fonte: string;
};

export function buildVolumesFaixaRows(
  competencia: string,
  volumes: Record<string, Record<Day, number>>,
): VolumeFaixaRow[] {
  const rows: VolumeFaixaRow[] = [];
  for (const [faixa, byDay] of Object.entries(volumes)) {
    for (const day of DAYS) {
      const volume = byDay?.[day];
      if (typeof volume !== "number") continue;
      rows.push({
        competencia,
        canal: "helpdesk",
        dia_semana: DAY_ISO[day],
        faixa,
        volume,
        fonte: "manual",
      });
    }
  }
  return rows;
}

export type NovaContratacaoRow = {
  competencia: string;
  nome: string;
  hora_inicio: string;
  hora_fim: string;
  almoco_inicio: string | null;
  dias_semana: number[];
  ativo: boolean;
  escala_custom: NewAgentHire["schedules"] | null;
  id_front: string;
};

export function buildNewHiresRows(
  competencia: string,
  newHires: NewAgentHire[],
): NovaContratacaoRow[] {
  return newHires.map((nh) => ({
    competencia,
    nome: nh.name,
    hora_inicio: nh.start_time,
    hora_fim: nh.end_time,
    almoco_inicio: nh.lunch_start_time ?? null,
    dias_semana: nh.days.map((d) => DAY_ISO[d]),
    ativo: nh.active,
    escala_custom: nh.schedules ?? null,
    id_front: nh.id,
  }));
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

type AgenteRow = {
  id: string;
  nome: string;
  id_front: string | null;
  tipo: string;
  ativo: boolean;
};

async function fetchAgentes(client: SupabaseClient): Promise<AgenteRow[]> {
  const { data, error } = await client.from("agentes").select("id, nome, id_front, tipo, ativo");
  if (error) throw error;
  return (data ?? []) as AgenteRow[];
}

const PAGE_SIZE = 1000;

/**
 * PostgREST devolve no máximo ~1000 linhas por request (db-max-rows do
 * Supabase). Escala/volumes passam disso por mês, então pagina com range
 * até a última página vir incompleta.
 */
async function fetchAllPages<T>(
  buildQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function insertChunked(
  client: SupabaseClient,
  table: string,
  rows: unknown[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await client.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}

/**
 * Garante que todo agente (escala + capacity) exista em `agentes` e devolve
 * o mapa nome-normalizado → uuid. Também atualiza `id_front` e o `ativo` dos
 * humanos quando divergem.
 */
export async function ensureAgentes(
  client: SupabaseClient,
  teamAgents: TeamAgent[],
  capacityAgents: CapacityAgent[],
): Promise<Map<string, string>> {
  const desired = new Map<
    string,
    { nome: string; tipo: string; ativo: boolean; idFront: string | null }
  >();

  for (const agent of teamAgents) {
    desired.set(dbNorm(agent.name), {
      nome: agent.name,
      tipo: "humano",
      ativo: agent.active,
      idFront: agent.id,
    });
  }
  for (const ca of capacityAgents) {
    const key = dbNorm(ca.name);
    if (desired.has(key)) continue;
    desired.set(key, {
      nome: ca.name,
      tipo: isAiAgent(ca.name) ? "ia" : isSupportAgent(ca.name) ? "bot" : "humano",
      ativo: ca.active ?? true,
      idFront: null,
    });
  }

  let rows = await fetchAgentes(client);
  const byNorm = new Map(rows.map((r) => [dbNorm(r.nome), r]));

  const missing = [...desired.entries()].filter(([key]) => !byNorm.has(key));
  if (missing.length > 0) {
    const { error } = await client.from("agentes").insert(
      missing.map(([, d]) => ({
        nome: d.nome,
        tipo: d.tipo,
        ativo: d.ativo,
        id_front: d.idFront,
      })),
    );
    if (error) throw error;
    rows = await fetchAgentes(client);
    byNorm.clear();
    for (const r of rows) byNorm.set(dbNorm(r.nome), r);
  }

  const updates: { id: string; id_front?: string; ativo?: boolean }[] = [];
  for (const [key, d] of desired) {
    const row = byNorm.get(key);
    if (!row) continue;
    const patch: { id: string; id_front?: string; ativo?: boolean } = { id: row.id };
    let needsUpdate = false;
    if (d.idFront && row.id_front !== d.idFront) {
      patch.id_front = d.idFront;
      needsUpdate = true;
    }
    if (d.tipo === "humano" && row.ativo !== d.ativo) {
      patch.ativo = d.ativo;
      needsUpdate = true;
    }
    if (needsUpdate) updates.push(patch);
  }
  if (updates.length > 0) {
    const { error } = await client.from("agentes").upsert(updates, { onConflict: "id" });
    if (error) throw error;
  }

  const idByNorm = new Map<string, string>();
  for (const r of rows) idByNorm.set(dbNorm(r.nome), r.id);
  return idByNorm;
}

export async function saveEscalaBlocos(
  client: SupabaseClient,
  competencia: string,
  teamAgents: TeamAgent[],
  idByNorm: Map<string, string>,
): Promise<void> {
  const { error: deleteError } = await client
    .from("escala_blocos")
    .delete()
    .eq("competencia", competencia);
  if (deleteError) throw deleteError;

  const rows = buildEscalaBlocosRows(competencia, teamAgents, idByNorm);
  await insertChunked(client, "escala_blocos", rows);
}

export async function saveCapacitySnapshots(
  client: SupabaseClient,
  competencia: string,
  capacityAgents: CapacityAgent[],
  idByNorm: Map<string, string>,
): Promise<void> {
  const { error: deleteError } = await client
    .from("capacity_snapshots")
    .delete()
    .eq("competencia", competencia);
  if (deleteError) throw deleteError;

  const rows = capacityAgents
    .map((ca) => ({
      competencia,
      agente_id: idByNorm.get(dbNorm(ca.name)) ?? null,
      resolvidos_tri: ca.mediaTri,
      origem: "manual",
      ativo: ca.active ?? true,
    }))
    .filter((row) => row.agente_id !== null);

  await insertChunked(client, "capacity_snapshots", rows);
}

export async function saveVolumesFaixa(
  client: SupabaseClient,
  competencia: string,
  helpdeskVolumes: Record<string, Record<Day, number>>,
): Promise<void> {
  const { error: deleteError } = await client
    .from("volumes_faixa")
    .delete()
    .eq("competencia", competencia)
    .eq("canal", "helpdesk")
    .eq("fonte", "manual");
  if (deleteError) throw deleteError;

  const rows = buildVolumesFaixaRows(competencia, helpdeskVolumes);
  await insertChunked(client, "volumes_faixa", rows);
}

export async function saveParametros(
  client: SupabaseClient,
  competencia: string,
  tmaFactors: Record<Day, number>,
  simultaneous: number,
  scenarios: ScenarioParams,
): Promise<void> {
  const { error } = await client.from("parametros").upsert(
    [
      {
        chave: "tma_factors",
        valor: tmaFactors,
        vigencia_inicio: competencia,
        atualizado_por: "app",
      },
      {
        chave: "simultaneidade_helpdesk",
        valor: simultaneous,
        vigencia_inicio: competencia,
        atualizado_por: "app",
      },
      { chave: "cenarios", valor: scenarios, vigencia_inicio: competencia, atualizado_por: "app" },
    ],
    { onConflict: "chave,vigencia_inicio" },
  );
  if (error) throw error;
}

export async function saveNewHires(
  client: SupabaseClient,
  competencia: string,
  newHires: NewAgentHire[],
): Promise<void> {
  const { error: deleteError } = await client
    .from("novas_contratacoes")
    .delete()
    .eq("competencia", competencia);
  if (deleteError) throw deleteError;

  const rows = buildNewHiresRows(competencia, newHires);
  await insertChunked(client, "novas_contratacoes", rows);
}

export async function saveEscalaRoster(
  client: SupabaseClient,
  competencia: string,
  teamAgents: TeamAgent[],
  idByNorm: Map<string, string>,
): Promise<void> {
  const { error: deleteError } = await client
    .from("escala_roster")
    .delete()
    .eq("competencia", competencia);
  if (deleteError) throw deleteError;

  const rows = teamAgents
    .map((agent, index) => ({
      competencia,
      agente_id: idByNorm.get(dbNorm(agent.name)) ?? null,
      ordem: index,
      ativo: agent.active,
      id_front: agent.id,
    }))
    .filter((row) => row.agente_id !== null);

  await insertChunked(client, "escala_roster", rows);
}

/**
 * Espelha no canônico apenas as áreas sujas do save legado. Best-effort:
 * quem chama deve capturar e registrar, sem interromper o fluxo legado.
 */
export async function syncCanonicalAreas(
  client: SupabaseClient,
  monthName: string,
  snap: CanonicalSnapshot,
  areas: ReadonlySet<CanonicalArea>,
): Promise<void> {
  const competencia = competenciaFromMonthName(monthName);
  if (!competencia) return;

  if (areas.has("escala") && (snap.teamAgents || snap.capacityAgents)) {
    const idByNorm = await ensureAgentes(client, snap.teamAgents ?? [], snap.capacityAgents ?? []);
    if (snap.teamAgents) {
      await saveEscalaRoster(client, competencia, snap.teamAgents, idByNorm);
      await saveEscalaBlocos(client, competencia, snap.teamAgents, idByNorm);
    }
    if (snap.capacityAgents) {
      await saveCapacitySnapshots(client, competencia, snap.capacityAgents, idByNorm);
    }
  }

  if (areas.has("volumes") && snap.helpdeskVolumes) {
    await saveVolumesFaixa(client, competencia, snap.helpdeskVolumes);
  }

  if (areas.has("parametros")) {
    if (snap.tmaFactors && snap.simultaneous !== undefined && snap.scenarios) {
      await saveParametros(client, competencia, snap.tmaFactors, snap.simultaneous, snap.scenarios);
    }
    if (snap.newHires) await saveNewHires(client, competencia, snap.newHires);
  }
}

// ---------------------------------------------------------------------------
// Leitura canônica (virada de leitura) — builders puros + loaders
// ---------------------------------------------------------------------------

export type RosterReadRow = {
  agente_id: string;
  ordem: number;
  ativo: boolean;
  id_front: string | null;
};
export type BlocoReadRow = {
  agente_id: string;
  dia_semana: number;
  bloco: string;
  status: string;
};
export type AgenteReadRow = { id: string; nome: string; id_front: string | null };

export function buildTeamAgentsFromCanonical(
  roster: RosterReadRow[],
  blocks: BlocoReadRow[],
  agentes: AgenteReadRow[],
): TeamAgent[] | null {
  if (roster.length === 0) return null;

  const agenteById = new Map(agentes.map((a) => [a.id, a]));
  const schedulesByAgent = new Map<string, Partial<Record<Day, AgentSchedule>>>();

  for (const block of blocks) {
    const day = ISO_DAY[block.dia_semana];
    if (!day || !INTERVAL_STATUSES.has(block.status)) continue;
    let schedules = schedulesByAgent.get(block.agente_id);
    if (!schedules) {
      schedules = {};
      schedulesByAgent.set(block.agente_id, schedules);
    }
    const daySchedule = schedules[day] ?? { intervals: {} };
    daySchedule.intervals[block.bloco.slice(0, 5)] = block.status as IntervalStatus;
    schedules[day] = daySchedule;
  }

  return [...roster]
    .sort((a, b) => a.ordem - b.ordem)
    .flatMap((r) => {
      const agente = agenteById.get(r.agente_id);
      if (!agente) return [];
      return [
        {
          id: r.id_front ?? agente.id_front ?? agente.id,
          name: agente.nome,
          active: r.ativo,
          schedules: schedulesByAgent.get(r.agente_id) ?? {},
        },
      ];
    });
}

export function buildCapacityFromCanonical(
  rows: { nome: string; resolvidos_tri: number; ativo: boolean }[],
): CapacityAgent[] | null {
  if (rows.length === 0) return null;
  return rows.map((r) => ({ name: r.nome, mediaTri: r.resolvidos_tri, active: r.ativo }));
}

export function buildVolumesFromFaixaRows(
  rows: { dia_semana: number; faixa: string; volume: number; fonte: string }[],
): Record<string, Record<Day, number>> | null {
  // Quando a mesma faixa/dia existe em mais de uma fonte (ex.: 'manual' do
  // dual-write e 'legado_jsonb' do backfill), a manual vence.
  const best = new Map<string, { volume: number; fonte: string }>();
  for (const row of rows) {
    if (!ISO_DAY[row.dia_semana]) continue;
    const key = `${row.dia_semana}|${row.faixa}`;
    const existing = best.get(key);
    if (!existing || (existing.fonte !== "manual" && row.fonte === "manual")) {
      best.set(key, { volume: row.volume, fonte: row.fonte });
    }
  }
  if (best.size === 0) return null;

  const out: Record<string, Record<Day, number>> = {};
  for (const [key, value] of best) {
    const [iso, faixa] = key.split("|");
    const day = ISO_DAY[Number(iso)];
    const time = faixa.slice(0, 5);
    if (!out[time]) out[time] = {} as Record<Day, number>;
    out[time][day] = value.volume;
  }
  return out;
}

export type NovaContratacaoReadRow = {
  id: string;
  id_front: string | null;
  nome: string;
  hora_inicio: string;
  hora_fim: string;
  almoco_inicio: string | null;
  dias_semana: number[];
  ativo: boolean;
  escala_custom: NewAgentHire["schedules"] | null;
};

export function buildNewHiresFromCanonical(rows: NovaContratacaoReadRow[]): NewAgentHire[] | null {
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    id: r.id_front ?? r.id,
    name: r.nome,
    start_time: r.hora_inicio.slice(0, 5),
    end_time: r.hora_fim.slice(0, 5),
    ...(r.almoco_inicio ? { lunch_start_time: r.almoco_inicio.slice(0, 5) } : {}),
    days: r.dias_semana.flatMap((iso) => {
      const day = ISO_DAY[iso];
      return day ? [day] : [];
    }),
    active: r.ativo,
    ...(r.escala_custom ? { schedules: r.escala_custom } : {}),
  }));
}

async function loadTeamAgentsCanonical(
  client: SupabaseClient,
  competencia: string,
): Promise<TeamAgent[] | null> {
  const [roster, blocks] = await Promise.all([
    fetchAllPages<RosterReadRow>((from, to) =>
      client
        .from("escala_roster")
        .select("agente_id, ordem, ativo, id_front")
        .eq("competencia", competencia)
        .order("ordem")
        .range(from, to),
    ),
    fetchAllPages<BlocoReadRow>((from, to) =>
      client
        .from("escala_blocos")
        .select("agente_id, dia_semana, bloco, status")
        .eq("competencia", competencia)
        .order("id")
        .range(from, to),
    ),
  ]);

  if (roster.length === 0) return null;

  const ids = [...new Set(roster.map((r) => r.agente_id))];
  const { data: agentesData, error: agentesError } = await client
    .from("agentes")
    .select("id, nome, id_front")
    .in("id", ids);
  if (agentesError) throw agentesError;

  return buildTeamAgentsFromCanonical(roster, blocks, (agentesData ?? []) as AgenteReadRow[]);
}

async function loadCapacityCanonical(
  client: SupabaseClient,
  competencia: string,
): Promise<CapacityAgent[] | null> {
  const data = await fetchAllPages<{
    resolvidos_tri: number;
    ativo: boolean;
    agentes: { nome?: string } | null;
  }>((from, to) =>
    client
      .from("capacity_snapshots")
      .select("resolvidos_tri, ativo, agentes(nome)")
      .eq("competencia", competencia)
      .order("resolvidos_tri", { ascending: false })
      .range(from, to),
  );

  const rows = data.flatMap((row) => {
    const nome = row.agentes?.nome;
    if (!nome) return [];
    return [{ nome, resolvidos_tri: row.resolvidos_tri, ativo: row.ativo }];
  });
  return buildCapacityFromCanonical(rows);
}

async function loadVolumesCanonical(
  client: SupabaseClient,
  competencia: string,
): Promise<Record<string, Record<Day, number>> | null> {
  const data = await fetchAllPages<{
    dia_semana: number;
    faixa: string;
    volume: number;
    fonte: string;
  }>((from, to) =>
    client
      .from("volumes_faixa")
      .select("dia_semana, faixa, volume, fonte")
      .eq("competencia", competencia)
      .eq("canal", "helpdesk")
      .order("id")
      .range(from, to),
  );

  return buildVolumesFromFaixaRows(data);
}

async function loadParametrosCanonical(
  client: SupabaseClient,
  competencia: string,
): Promise<{
  tmaFactors: Record<Day, number> | null;
  simultaneous: number | null;
  scenarios: ScenarioParams | null;
} | null> {
  const { data, error } = await client
    .from("parametros")
    .select("chave, valor, vigencia_inicio")
    .in("chave", ["tma_factors", "simultaneidade_helpdesk", "cenarios"])
    .lte("vigencia_inicio", competencia)
    .order("vigencia_inicio", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as { chave: string; valor: unknown }[];
  if (rows.length === 0) return null;

  const firstByChave = new Map<string, unknown>();
  for (const row of rows) {
    if (!firstByChave.has(row.chave)) firstByChave.set(row.chave, row.valor);
  }

  const tma = firstByChave.get("tma_factors");
  const sim = firstByChave.get("simultaneidade_helpdesk");
  const scen = firstByChave.get("cenarios");

  const result = {
    tmaFactors: tma && typeof tma === "object" ? (tma as Record<Day, number>) : null,
    simultaneous: typeof sim === "number" ? sim : null,
    scenarios: scen && typeof scen === "object" ? (scen as ScenarioParams) : null,
  };
  if (!result.tmaFactors && result.simultaneous === null && !result.scenarios) return null;
  return result;
}

async function loadNewHiresCanonical(
  client: SupabaseClient,
  competencia: string,
): Promise<NewAgentHire[] | null> {
  const data = await fetchAllPages<NovaContratacaoReadRow>((from, to) =>
    client
      .from("novas_contratacoes")
      .select(
        "id, id_front, nome, hora_inicio, hora_fim, almoco_inicio, dias_semana, ativo, escala_custom",
      )
      .eq("competencia", competencia)
      .order("criado_em")
      .range(from, to),
  );

  return buildNewHiresFromCanonical(data);
}

export type CanonicalMonthData = {
  teamAgents: TeamAgent[] | null;
  capacityAgents: CapacityAgent[] | null;
  helpdeskVolumes: Record<string, Record<Day, number>> | null;
  tmaFactors: Record<Day, number> | null;
  simultaneous: number | null;
  scenarios: ScenarioParams | null;
  newHires: NewAgentHire[] | null;
};

const EMPTY_CANONICAL_MONTH: CanonicalMonthData = {
  teamAgents: null,
  capacityAgents: null,
  helpdeskVolumes: null,
  tmaFactors: null,
  simultaneous: null,
  scenarios: null,
  newHires: null,
};

/**
 * Lê o mês inteiro do canônico. Nunca lança: cada área cai em `null` quando
 * não há dado (ou a leitura falha), e quem chama decide o fallback legado.
 */
export async function loadCanonicalMonth(
  client: SupabaseClient,
  monthName: string,
): Promise<CanonicalMonthData> {
  const competencia = competenciaFromMonthName(monthName);
  if (!competencia) return EMPTY_CANONICAL_MONTH;

  const safe = async <T>(fn: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`Falha ao ler o canônico de ${monthName}:`, err);
      return null;
    }
  };

  const [teamAgents, capacityAgents, helpdeskVolumes, params, newHires] = await Promise.all([
    safe(() => loadTeamAgentsCanonical(client, competencia)),
    safe(() => loadCapacityCanonical(client, competencia)),
    safe(() => loadVolumesCanonical(client, competencia)),
    safe(() => loadParametrosCanonical(client, competencia)),
    safe(() => loadNewHiresCanonical(client, competencia)),
  ]);

  return {
    teamAgents,
    capacityAgents,
    helpdeskVolumes,
    tmaFactors: params?.tmaFactors ?? null,
    simultaneous: params?.simultaneous ?? null,
    scenarios: params?.scenarios ?? null,
    newHires,
  };
}
