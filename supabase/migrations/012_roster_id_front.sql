-- ============================================================
-- 012_roster_id_front.sql
-- Preserva o id do front POR COMPETÊNCIA no roster.
--
-- O legado usa ids instáveis entre meses (o mesmo agente é "a1" em Julho e
-- "a_1781884420268" em Agosto). `agentes.id_front` (009) guarda só o id mais
-- recente, então a leitura canônica de meses antigos devolveria um id que não
-- casa com as exceções registradas naquela época (escala_excecoes.agente_id).
--
-- Esta migration adiciona `escala_roster.id_front` e o preenche com o id de
-- cada mês. Idempotente.
-- ============================================================

alter table public.escala_roster
  add column if not exists id_front text;

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

    for v_row in
      select ta->>'name' as nome, ta->>'id' as front_id
      from public.escala_equipe ee,
           jsonb_array_elements(coalesce(ee.team_agents, '[]'::jsonb)) ta
      where ee.mes_id = v_mes.id
        and coalesce(ta->>'isSimulated', 'false') <> 'true'
        and ta->>'id' is not null
    loop
      select id into v_agente_id from public.agentes
      where lower(public.fn_unaccent_imm(nome)) = lower(public.fn_unaccent_imm(v_row.nome));

      if v_agente_id is not null then
        update public.escala_roster
        set id_front = v_row.front_id
        where competencia = v_comp and agente_id = v_agente_id;
      end if;
    end loop;
  end loop;
end $$;
