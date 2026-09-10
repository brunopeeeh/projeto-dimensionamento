-- ============================================================
-- 006_canal_unico_helpdesk.sql
-- Migração de plataforma: Webchat + WhatsApp viram uma fila única
-- ("Helpdesk"). Ver DOCUMENTACAO_DIMENSIONAMENTO_HELPDESK.md (raiz do
-- projeto) para a regra de negócio completa.
--
-- Não-destrutiva de propósito: adiciona colunas novas nas tabelas
-- legadas (volumes_chamados, parametros_operacionais) e faz backfill a
-- partir das colunas antigas. As colunas antigas (webchat_volumes,
-- whatsapp_volumes, simultaneous_wc, simultaneous_wa) NÃO são
-- removidas aqui — o app já parou de lê-las/escrevê-las
-- (useSupabasePersistence.ts), mas ficam como histórico/rollback até
-- confirmação de que a migração está estável em produção.
-- ============================================================

-- Helper: soma dois JSONBs no formato { "HH:MM": { "Dia": number, ... }, ... },
-- usado para juntar webchat_volumes + whatsapp_volumes em helpdesk_volumes.
create or replace function public.fn_sum_volume_jsonb(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(time_key, day_sums),
    '{}'::jsonb
  )
  from (
    select
      time_key,
      jsonb_object_agg(day_key, day_sum) as day_sums
    from (
      select
        time_key,
        day_key,
        coalesce((a -> time_key ->> day_key)::numeric, 0)
          + coalesce((b -> time_key ->> day_key)::numeric, 0) as day_sum
      from (
        select distinct time_key
        from (
          select jsonb_object_keys(coalesce(a, '{}'::jsonb)) as time_key
          union
          select jsonb_object_keys(coalesce(b, '{}'::jsonb)) as time_key
        ) t
      ) times
      cross join lateral (
        select distinct day_key
        from (
          select jsonb_object_keys(coalesce(a -> times.time_key, '{}'::jsonb)) as day_key
          union
          select jsonb_object_keys(coalesce(b -> times.time_key, '{}'::jsonb)) as day_key
        ) d
      ) days
    ) leaves
    group by time_key
  ) grouped;
$$;

comment on function public.fn_sum_volume_jsonb is
  'Soma dois JSONBs { "HH:MM": { "Dia": number } } chave a chave. Usado só '
  'no backfill de helpdesk_volumes (006) — não é chamado pelo app.';

-- volumes_chamados: nova coluna com o volume único (webchat + whatsapp somados).
alter table public.volumes_chamados
  add column if not exists helpdesk_volumes jsonb;

update public.volumes_chamados
set helpdesk_volumes = public.fn_sum_volume_jsonb(webchat_volumes, whatsapp_volumes)
where helpdesk_volumes is null;

-- parametros_operacionais: nova coluna com o simultâneos único (mesmo valor
-- do antigo Webchat — 3 — conforme decisão de negócio).
alter table public.parametros_operacionais
  add column if not exists simultaneous_helpdesk integer;

update public.parametros_operacionais
set simultaneous_helpdesk = coalesce(simultaneous_wc, 3)
where simultaneous_helpdesk is null;
