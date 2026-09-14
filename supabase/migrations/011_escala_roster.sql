-- ============================================================
-- 011_escala_roster.sql
-- Roster da escala por competência. O canônico tinha só `escala_blocos`
-- (intervalos), o que não distingue "agente fora do time" de "agente no
-- time mas sem turno configurado" — ambos ficam sem bloco. O front
-- (TeamAgent[]) precisa da lista explícita, com ordem e ativo do mês.
--
-- Backfill a partir do team_agents legado (mesma fonte da 009).
-- Idempotente.
-- ============================================================

create table if not exists public.escala_roster (
  id          bigint generated always as identity primary key,
  competencia date not null check (extract(day from competencia) = 1),
  agente_id   uuid not null references public.agentes (id),
  ordem       smallint not null default 0,
  ativo       boolean not null default true,
  unique (competencia, agente_id)
);

create index if not exists escala_roster_competencia_idx
  on public.escala_roster (competencia, ordem);

comment on table public.escala_roster is
  'Lista de TeamAgents por competência (ordem + ativo). Preserva agentes sem '
  'bloco em escala_blocos e a ordem de exibição do front.';

alter table public.escala_roster enable row level security;

drop policy if exists escala_roster_all_transicao on public.escala_roster;
create policy escala_roster_all_transicao on public.escala_roster
  for all to anon, authenticated using (true) with check (true);

-- Backfill do roster a partir do legado
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

    delete from public.escala_roster where competencia = v_comp;

    for v_row in
      select ta->>'name' as nome,
             (ta->>'active')::boolean as ativo,
             (t.ord - 1)::smallint as ordem
      from public.escala_equipe ee,
           jsonb_array_elements(coalesce(ee.team_agents, '[]'::jsonb))
             with ordinality as t(ta, ord)
      where ee.mes_id = v_mes.id
        and coalesce(ta->>'isSimulated', 'false') <> 'true'
    loop
      insert into public.agentes (nome, tipo, ativo)
      values (v_row.nome, 'humano', coalesce(v_row.ativo, true))
      on conflict do nothing;

      select id into v_agente_id from public.agentes
      where lower(public.fn_unaccent_imm(nome)) = lower(public.fn_unaccent_imm(v_row.nome));

      if v_agente_id is not null then
        insert into public.escala_roster (competencia, agente_id, ordem, ativo)
        values (v_comp, v_agente_id, v_row.ordem, coalesce(v_row.ativo, true))
        on conflict (competencia, agente_id)
          do update set ordem = excluded.ordem, ativo = excluded.ativo;
      end if;
    end loop;
  end loop;
end $$;
