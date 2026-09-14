-- ============================================================
-- 009_paridade_canonico.sql
-- Paridade legado → canônico antes da virada de leitura (Fase C).
--
-- Contexto: o front ainda lê/escreve o legado JSONB (meses, escala_equipe,
-- volumes_chamados, parametros_operacionais). A partir desta migration o app
-- passa a fazer DUAL-WRITE (legado + canônico). Esta migration:
--   1. adiciona colunas de identidade/estado que o front precisa e o
--      canônico ainda não tinha (id_front, capacity_snapshots.ativo);
--   2. refaz o backfill do canônico a partir do legado ATUAL (o 004 rodou
--      antes das últimas edições; aqui o espelho fica exato);
--   3. backfill dos volumes da fila única (helpdesk), que o 004 não cobria
--      (ele só existia para webchat/whatsapp).
--
-- Idempotente: pode rodar de novo sem efeito colateral. NÃO dropa nada.
-- A virada de leitura e o drop do legado são passos posteriores, após a
-- verificação de paridade.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Colunas de identidade/estado
-- ------------------------------------------------------------
-- id_front: id do front (ex.: "a_1739..."), usado pelas exceções da escala
-- (escala_excecoes.agente_id) e por referências locais. Sem ele, a leitura
-- canônica trocaria os ids para uuid e quebraria as exceções existentes.
alter table public.agentes add column if not exists id_front text;
alter table public.novas_contratacoes add column if not exists id_front text;

-- ativo: espelha CapacityAgent.active do front (separado de agentes.ativo,
-- que representa a escala CLT).
alter table public.capacity_snapshots
  add column if not exists ativo boolean not null default true;

create index if not exists agentes_id_front_idx
  on public.agentes (id_front) where id_front is not null;
create index if not exists novas_contratacoes_competencia_idx
  on public.novas_contratacoes (competencia);

-- ------------------------------------------------------------
-- 2. Backfill de agentes.id_front (do team_agents legado, por nome)
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct on (lower(public.fn_unaccent_imm(ta->>'name')))
      lower(public.fn_unaccent_imm(ta->>'name')) as nome_norm,
      ta->>'id' as front_id
    from public.escala_equipe ee,
         jsonb_array_elements(coalesce(ee.team_agents, '[]'::jsonb)) ta
    where ta->>'id' is not null
    order by lower(public.fn_unaccent_imm(ta->>'name')), ee.mes_id desc
  loop
    update public.agentes
    set id_front = r.front_id
    where lower(public.fn_unaccent_imm(nome)) = r.nome_norm
      and (id_front is null or id_front <> r.front_id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Backfill de capacity_snapshots (resolvidos_tri + ativo) do legado
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select public._fn_competencia_from_nome(m.nome) as competencia,
           lower(public.fn_unaccent_imm(ca->>'name')) as nome_norm,
           (ca->>'mediaTri')::numeric as media_tri,
           (ca->>'active')::boolean as ativo
    from public.meses m
    join public.escala_equipe ee on ee.mes_id = m.id,
         jsonb_array_elements(coalesce(ee.capacity_agents, '[]'::jsonb)) ca
  loop
    if r.competencia is null then
      continue;
    end if;

    update public.capacity_snapshots cs
    set resolvidos_tri = coalesce(r.media_tri, cs.resolvidos_tri),
        ativo = coalesce(r.ativo, cs.ativo),
        atualizado_em = now()
    from public.agentes a
    where cs.competencia = r.competencia
      and cs.agente_id = a.id
      and lower(public.fn_unaccent_imm(a.nome)) = r.nome_norm;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. Backfill dos volumes da fila única (helpdesk)
--    Fonte: volumes_chamados.helpdesk_volumes (006). O 004 só migrou
--    webchat/whatsapp, então o helpdesk ficaria de fora da paridade.
-- ------------------------------------------------------------
insert into public.volumes_faixa
  (competencia, canal, dia_semana, faixa, volume, fonte)
select x.comp, 'helpdesk', public._fn_dia_iso(d.key), f.key::time,
       coalesce((d.value #>> '{}')::numeric, 0), 'legado_jsonb'
from (
  select public._fn_competencia_from_nome(m.nome) as comp,
         vc.helpdesk_volumes as blob
  from public.meses m
  join public.volumes_chamados vc on vc.mes_id = m.id
) x,
jsonb_each(coalesce(x.blob, '{}'::jsonb)) f,
jsonb_each(f.value) d
where x.comp is not null
  and public._fn_dia_iso(d.key) is not null
on conflict (competencia, canal, dia_semana, faixa, fonte)
  do update set volume = excluded.volume;

-- ------------------------------------------------------------
-- 5. Refresh da escala (escala_blocos) a partir do team_agents legado
--    Delete + insert por competência: o legado é a fonte neste momento.
-- ------------------------------------------------------------
do $$
declare
  v_mes record;
  v_comp date;
  v_row record;
  v_agente_id uuid;
begin
  for v_mes in select id, nome from public.meses loop
    v_comp := public._fn_competencia_from_nome(v_mes.nome);
    if v_comp is null then
      continue;
    end if;

    delete from public.escala_blocos where competencia = v_comp;

    for v_row in
      select ta->>'name' as nome,
             (ta->>'active')::boolean as ativo,
             d.key as dia_nome,
             i.key as bloco,
             i.value #>> '{}' as status
      from public.escala_equipe ee,
           jsonb_array_elements(coalesce(ee.team_agents, '[]'::jsonb)) ta,
           jsonb_each(coalesce(ta->'schedules', '{}'::jsonb)) d,
           jsonb_each(coalesce(d.value->'intervals', '{}'::jsonb)) i
      where ee.mes_id = v_mes.id
        and coalesce(ta->>'isSimulated', 'false') <> 'true'
    loop
      insert into public.agentes (nome, tipo, ativo)
      values (v_row.nome, 'humano', coalesce(v_row.ativo, true))
      on conflict do nothing;

      select id into v_agente_id from public.agentes
      where lower(public.fn_unaccent_imm(nome)) = lower(public.fn_unaccent_imm(v_row.nome));

      if v_agente_id is not null
         and v_row.status in ('trabalhando', 'pausa', 'folga', 'externo')
         and public._fn_dia_iso(v_row.dia_nome) is not null then
        insert into public.escala_blocos
          (competencia, agente_id, dia_semana, bloco, status)
        values
          (v_comp, v_agente_id, public._fn_dia_iso(v_row.dia_nome),
           v_row.bloco::time, v_row.status)
        on conflict (competencia, agente_id, dia_semana, bloco)
          do update set status = excluded.status;
      end if;
    end loop;

    -- ativo dos humanos (escala CLT)
    update public.agentes a
    set ativo = ta.ativo
    from (
      select ta2->>'name' as nome, (ta2->>'active')::boolean as ativo
      from public.escala_equipe ee2,
           jsonb_array_elements(coalesce(ee2.team_agents, '[]'::jsonb)) ta2
      where ee2.mes_id = v_mes.id
        and coalesce(ta2->>'isSimulated', 'false') <> 'true'
    ) ta
    where lower(public.fn_unaccent_imm(a.nome)) = lower(public.fn_unaccent_imm(ta.nome))
      and ta.ativo is not null;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. Refresh de novas_contratacoes a partir do new_hires legado
-- ------------------------------------------------------------
do $$
declare
  v_mes record;
  v_comp date;
begin
  for v_mes in select id, nome from public.meses loop
    v_comp := public._fn_competencia_from_nome(v_mes.nome);
    if v_comp is null then
      continue;
    end if;

    delete from public.novas_contratacoes where competencia = v_comp;

    insert into public.novas_contratacoes
      (competencia, nome, hora_inicio, hora_fim, almoco_inicio,
       dias_semana, ativo, escala_custom, id_front)
    select v_comp,
           nh->>'name',
           (nh->>'start_time')::time,
           (nh->>'end_time')::time,
           nullif(nh->>'lunch_start_time', '')::time,
           coalesce(array(
             select public._fn_dia_iso(x #>> '{}')
             from jsonb_array_elements(nh->'days') x
           ), '{}'),
           coalesce((nh->>'active')::boolean, true),
           nh->'schedules',
           nh->>'id'
    from public.parametros_operacionais po,
         jsonb_array_elements(coalesce(po.new_hires, '[]'::jsonb)) nh
    where po.mes_id = v_mes.id;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. Refresh dos parâmetros canônicos (chaves novas usadas pelo app)
-- ------------------------------------------------------------
insert into public.parametros (chave, valor, vigencia_inicio, atualizado_por)
select 'tma_factors', po.tma_factors, c.comp, 'migracao_009'
from public.parametros_operacionais po
join (
  select id, public._fn_competencia_from_nome(nome) as comp from public.meses
) c on c.id = po.mes_id
where c.comp is not null and po.tma_factors is not null
on conflict (chave, vigencia_inicio) do update set valor = excluded.valor;

insert into public.parametros (chave, valor, vigencia_inicio, atualizado_por)
select 'simultaneidade_helpdesk', to_jsonb(coalesce(po.simultaneous_helpdesk, 3)), c.comp, 'migracao_009'
from public.parametros_operacionais po
join (
  select id, public._fn_competencia_from_nome(nome) as comp from public.meses
) c on c.id = po.mes_id
where c.comp is not null
on conflict (chave, vigencia_inicio) do update set valor = excluded.valor;

insert into public.parametros (chave, valor, vigencia_inicio, atualizado_por)
select 'cenarios', po.scenarios, c.comp, 'migracao_009'
from public.parametros_operacionais po
join (
  select id, public._fn_competencia_from_nome(nome) as comp from public.meses
) c on c.id = po.mes_id
where c.comp is not null and po.scenarios is not null
on conflict (chave, vigencia_inicio) do update set valor = excluded.valor;
