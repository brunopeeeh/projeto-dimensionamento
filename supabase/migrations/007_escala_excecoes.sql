-- ============================================================
-- 007_escala_excecoes.sql
-- Exceções pontuais da escala (falta, atestado, férias, extra, ajuste)
-- por dia-calendário. Antes viviam só no localStorage (chave
-- `escalaops.v1`), sem sincronizar entre navegadores/máquinas.
--
-- Decisão de modelagem:
--   * `data` é o dia-calendário específico (não dia-da-semana) — uma
--     exceção vale para 14/02, não "toda sexta".
--   * `agente_id` é o id do TeamAgent do front (texto, ex.: "a_1739...").
--     NÃO é FK para public.agentes (uuid) porque o schema canônico ainda
--     está dormente; a reconciliação acontece na fase de paridade.
--   * `pause_override` distingue "pausa não alterada" (false) de
--     "pausa removida explicitamente" (true + pause_start/end nulos) —
--     o Override do front usa undefined vs null para essa diferença.
-- ============================================================

create table if not exists public.escala_excecoes (
  id             bigint generated always as identity primary key,
  competencia    date not null check (extract(day from competencia) = 1),
  agente_id      text not null,
  data           date not null,
  kind           text not null check (kind in ('falta','atestado','ferias','extra','ajuste')),
  shift_start    time,
  shift_end      time,
  pause_override boolean not null default false,
  pause_start    time,
  pause_end      time,
  note           text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (competencia, agente_id, data)
);

create index if not exists escala_excecoes_data_idx
  on public.escala_excecoes (data);

comment on table public.escala_excecoes is
  'Exceções pontuais por dia-calendário (falta/atestado/férias/extra/ajuste). '
  'agente_id é o id do TeamAgent do front (texto), não o uuid de public.agentes. '
  'pause_override=true com pause_start/end nulos significa "sem pausa nesse dia".';

-- RLS — mesmo modo transição do restante do app (anon key lê e escreve).
alter table public.escala_excecoes enable row level security;

drop policy if exists escala_excecoes_all_transicao on public.escala_excecoes;
create policy escala_excecoes_all_transicao on public.escala_excecoes
  for all to anon, authenticated using (true) with check (true);

-- Trigger de atualizado_em (fn_touch_atualizado_em criada na 0015).
drop trigger if exists trg_escala_excecoes_touch on public.escala_excecoes;
create trigger trg_escala_excecoes_touch before update on public.escala_excecoes
  for each row execute function public.fn_touch_atualizado_em();
