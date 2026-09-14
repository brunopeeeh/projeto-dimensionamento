-- ============================================================
-- 0015_schema_canonico.sql
-- Schema canônico multi-fonte do Dimensionamento Care.
--
-- Princípios:
--   1. Multi-fonte desde o dia 1: toda entidade de atendimento carrega
--      `fonte` ('freshchat' | 'hubspot' | 'manual') e `id_externo`.
--      O motor de cálculo NUNCA lê a fonte — só as tabelas canônicas.
--   2. Nada de JSONB para dado de negócio. JSONB permitido apenas em
--      payloads brutos de auditoria e configurações estruturadas.
--   3. Convenções: dia_semana ISO (1=Segunda ... 7=Domingo);
--      faixas de 10 min como `time` (07:00, 07:10, ...);
--      competência = date no dia 1 do mês (ex.: 2026-02-01).
--
-- Compatível com o projeto existente (tabelas legadas meses/escala_equipe/
-- volumes_chamados/parametros_operacionais NÃO são tocadas aqui —
-- a migração de dados acontece na 004).
-- ============================================================


-- Extensão e wrapper IMMUTABLE (unaccent puro é STABLE e não pode ser usado
-- em índices; a forma com dicionário explícito é determinística).
create extension if not exists unaccent;

create or replace function public.fn_unaccent_imm(p text)
returns text language sql immutable parallel safe as $$
  select public.unaccent('public.unaccent'::regdictionary, p)
$$;

-- ------------------------------------------------------------
-- 1. AGENTES (humanos, bots e IA — unificados)
-- ------------------------------------------------------------
create table if not exists public.agentes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          text not null default 'humano'
                check (tipo in ('humano', 'bot', 'ia')),
  -- IDs externos: o mesmo humano existirá nas duas plataformas durante a
  -- migração Freshchat → HubSpot. Sem este de-para, o capacity dele se
  -- divide em dois "agentes fantasmas".
  id_freshchat  text unique,
  id_hubspot    text unique,
  ativo         boolean not null default true,
  data_inicio   date,
  data_fim      date,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists agentes_nome_uidx
  on public.agentes (lower(public.fn_unaccent_imm(nome)));

comment on table public.agentes is
  'Agentes de atendimento: humanos, bots (Yooga Suporte) e IA (Care AI).  Yooga Suporte e Care AI são linhas normais com tipo bot/ia — nunca  constantes hardcoded no código.';

-- ------------------------------------------------------------
-- 2. ATENDIMENTOS (tabela canônica — o "fato" central)
-- ------------------------------------------------------------
create table if not exists public.atendimentos (
  id               bigint generated always as identity primary key,
  fonte            text not null
                   check (fonte in ('freshchat', 'hubspot', 'manual')),
  id_externo       text not null,          -- conversation_id / ticket_id na origem
  contato_externo  text,                   -- contact/cliente na origem (análise de recontato)
  canal            text
                   check (canal in ('webchat', 'whatsapp', 'outro')),
  grupo_externo    text,                   -- group_id/pipeline na origem
  agente_id        uuid references public.agentes (id),
  created_at       timestamptz not null,
  resolved_at      timestamptz,
  tpr_min          numeric,                -- tempo de primeira resposta (min)
  tma_min          numeric,                -- tempo de atendimento (min)
  tempo_total_min  numeric,
  payload          jsonb,                  -- linha bruta da origem (auditoria)
  ingerido_em      timestamptz not null default now(),
  unique (fonte, id_externo)
);

create index if not exists atendimentos_created_idx
  on public.atendimentos (created_at);
create index if not exists atendimentos_agente_created_idx
  on public.atendimentos (agente_id, created_at);
create index if not exists atendimentos_contato_idx
  on public.atendimentos (contato_externo);
create index if not exists atendimentos_fonte_idx
  on public.atendimentos (fonte);

comment on table public.atendimentos is
  'Fato canônico de atendimentos. Adaptadores (Freshchat Extract API,  HubSpot tickets, cargas manuais) traduzem a origem para este formato.  ATENÇÃO à unidade: 1 linha = 1 interação/atribuição, não 1 conversa  única (ver protocolo de reconciliação BI x Databricks x API).';

-- ------------------------------------------------------------
-- 3. CAPACITY SNAPSHOTS (resolvidos por agente por competência)
--    Substitui o JSONB capacity_agents. Yooga Suporte / Care AI entram
--    aqui com origem = 'manual' (decisão operacional atual).
-- ------------------------------------------------------------
create table if not exists public.capacity_snapshots (
  id             bigint generated always as identity primary key,
  competencia    date not null check (extract(day from competencia) = 1),
  agente_id      uuid not null references public.agentes (id),
  resolvidos_tri numeric not null check (resolvidos_tri >= 0),
  origem         text not null default 'manual'
                 check (origem in ('freshchat_sync', 'hubspot_sync', 'manual')),
  editado_por    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (competencia, agente_id)
);

comment on table public.capacity_snapshots is
  'Volume resolvido no trimestre por agente, por competência. Histórico  preservado mês a mês (foi este histórico que revelou a queda de 8.000 →  4.899 da Care AI). origem=manual para Yooga Suporte/Care AI e para  agentes com valor congelado durante a migração HubSpot.';

-- ------------------------------------------------------------
-- 4. CURVAS DE VOLUME por faixa de 10 min
--    Substitui os JSONBs webchat_volumes / whatsapp_volumes.
--    `fonte` no unique permite comparar Power BI x API lado a lado (PoC
--    de reconciliação) antes de eleger a fonte oficial.
-- ------------------------------------------------------------
create table if not exists public.volumes_faixa (
  id          bigint generated always as identity primary key,
  competencia date not null check (extract(day from competencia) = 1),
  canal       text not null check (canal in ('webchat', 'whatsapp')),
  dia_semana  smallint not null check (dia_semana between 1 and 7),
  faixa       time not null,
  volume      numeric not null check (volume >= 0),
  fonte       text not null default 'powerbi_upload'
              check (fonte in ('powerbi_upload', 'freshchat_api',
                               'hubspot_api', 'legado_jsonb', 'manual')),
  upload_id   bigint,                      -- fk criada abaixo (auditoria)
  criado_em   timestamptz not null default now(),
  unique (competencia, canal, dia_semana, faixa, fonte)
);

create index if not exists volumes_faixa_lookup_idx
  on public.volumes_faixa (competencia, canal, fonte);

-- Auditoria dos uploads manuais (enquanto o Power BI for a fonte).
create table if not exists public.uploads_volume (
  id             bigint generated always as identity primary key,
  competencia    date not null,
  canal          text not null check (canal in ('webchat', 'whatsapp')),
  nome_arquivo   text,
  periodo_inicio date,
  periodo_fim    date,
  linhas         integer,
  conteudo_bruto text,                     -- CSV original, para reprocesso
  enviado_por    text,
  criado_em      timestamptz not null default now()
);

alter table public.volumes_faixa
  drop constraint if exists volumes_faixa_upload_fk;
alter table public.volumes_faixa
  add constraint volumes_faixa_upload_fk
  foreign key (upload_id) references public.uploads_volume (id);

comment on table public.volumes_faixa is
  'Curva média de volume por faixa de 10 min / dia da semana / canal /  competência. A média deve ser calculada dividindo pela CONTAGEM REAL de  ocorrências de cada dia no período (nunca por 13 fixo — 90 dias = 12,86  semanas; o viés chega a 8%).';

-- ------------------------------------------------------------
-- 5. ESCALA (blocos de 20 min por agente/dia — substitui o JSONB
--    team_agents.schedules)
-- ------------------------------------------------------------
create table if not exists public.escala_blocos (
  id          bigint generated always as identity primary key,
  competencia date not null check (extract(day from competencia) = 1),
  agente_id   uuid not null references public.agentes (id),
  dia_semana  smallint not null check (dia_semana between 1 and 7),
  bloco       time not null,               -- início do bloco de 20 min
  status      text not null
              check (status in ('trabalhando', 'pausa', 'folga', 'externo')),
  unique (competencia, agente_id, dia_semana, bloco)
);

create index if not exists escala_blocos_lookup_idx
  on public.escala_blocos (competencia, dia_semana, bloco);

comment on table public.escala_blocos is
  'Escala vigente em blocos de 20 min (mesma granularidade do front:  IntervalStatus = trabalhando|pausa|folga|externo). ~6k linhas/mês para  14 agentes — trivial para o Postgres e consultável por SQL.';

-- ------------------------------------------------------------
-- 6. SIMULAÇÕES DE CONTRATAÇÃO (substitui o JSONB new_hires)
-- ------------------------------------------------------------
create table if not exists public.novas_contratacoes (
  id            uuid primary key default gen_random_uuid(),
  competencia   date not null check (extract(day from competencia) = 1),
  nome          text not null,
  hora_inicio   time not null,
  hora_fim      time not null,
  almoco_inicio time,
  dias_semana   smallint[] not null,       -- ISO 1..7
  ativo         boolean not null default true,
  escala_custom jsonb,                     -- override opcional (formato AgentSchedule do front)
  criado_em     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. PARÂMETROS com vigência (substitui parametros_operacionais e as
--    constantes hardcoded: group IDs do Freshchat, exclude/rename,
--    simultaneidade, shrinkage, marco da migração HubSpot...)
-- ------------------------------------------------------------
create table if not exists public.parametros (
  id              bigint generated always as identity primary key,
  chave           text not null,
  valor           jsonb not null,          -- número, string ou estrutura
  vigencia_inicio date not null default current_date,
  atualizado_por  text,
  criado_em       timestamptz not null default now(),
  unique (chave, vigencia_inicio)
);

comment on table public.parametros is
  'Parâmetros de negócio com vigência e auditoria. Mudar premissa = INSERT  com nova vigência (nunca UPDATE destrutivo, nunca deploy de código).';

-- Helper: valor vigente de um parâmetro em uma data.
create or replace function public.fn_parametro(p_chave text, p_data date default current_date)
returns jsonb
language sql
stable
as $$
  select valor
  from public.parametros
  where chave = p_chave
    and vigencia_inicio <= p_data
  order by vigencia_inicio desc
  limit 1;
$$;

-- ------------------------------------------------------------
-- 8. DIMENSIONAMENTOS (snapshot mensal do resultado) e PROVA REAL
-- ------------------------------------------------------------
create table if not exists public.dimensionamentos (
  id                bigint generated always as identity primary key,
  competencia       date not null check (extract(day from competencia) = 1),
  canal             text not null check (canal in ('webchat', 'whatsapp')),
  dia_semana        smallint not null check (dia_semana between 1 and 7),
  faixa             time not null,
  volume_previsto   numeric,
  capacity_escalada numeric,
  deficit           numeric,
  versao_modelo     text not null default 'v1',
  gerado_em         timestamptz not null default now(),
  unique (competencia, canal, dia_semana, faixa, versao_modelo)
);

create table if not exists public.prova_real (
  competencia     date not null,
  canal           text not null check (canal in ('webchat', 'whatsapp')),
  dia_semana      smallint not null check (dia_semana between 1 and 7),
  faixa           time not null,
  volume_previsto numeric,
  volume_real     numeric,
  erro_abs        numeric generated always as (abs(coalesce(volume_real,0) - coalesce(volume_previsto,0))) stored,
  calculado_em    timestamptz not null default now(),
  primary key (competencia, canal, dia_semana, faixa)
);

comment on table public.prova_real is
  'Previsto x realizado por faixa, calculado no fechamento de cada mês.  É a validação contra a REALIDADE (não contra o próprio modelo).';

-- ------------------------------------------------------------
-- 9. RLS — modo transição
--    O app atual usa a anon key sem autenticação. Para não quebrar o front
--    durante a refatoração, as policies abaixo são permissivas e nomeadas
--    *_transicao. Quando o Supabase Auth entrar:
--      1) drop das policies *_transicao;
--      2) select para authenticated; escrita restrita a role de owner.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  -- Em ambiente fora do Supabase (CI/teste local) as roles padrão não
  -- existem; cria como NOLOGIN para as policies serem aplicáveis.
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  foreach t in array array[
    'agentes','atendimentos','capacity_snapshots','volumes_faixa',
    'uploads_volume','escala_blocos','novas_contratacoes','parametros',
    'dimensionamentos','prova_real'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all_transicao', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_all_transicao', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 10. trigger de atualizado_em
-- ------------------------------------------------------------
create or replace function public.fn_touch_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists trg_agentes_touch on public.agentes;
create trigger trg_agentes_touch before update on public.agentes
  for each row execute function public.fn_touch_atualizado_em();

drop trigger if exists trg_capacity_touch on public.capacity_snapshots;
create trigger trg_capacity_touch before update on public.capacity_snapshots
  for each row execute function public.fn_touch_atualizado_em();
