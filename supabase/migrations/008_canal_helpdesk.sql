-- ============================================================
-- 008_canal_helpdesk.sql
-- Migração de plataforma: Webchat + WhatsApp viram uma fila única
-- ("Helpdesk"). A 006 fez isso apenas nas tabelas legadas (adicionou
-- helpdesk_volumes / simultaneous_helpdesk). O schema canônico ainda
-- restringia canal a ('webchat','whatsapp') — esta migration alinha o
-- canônico à regra de negócio.
-- Ver DOCUMENTACAO_DIMENSIONAMENTO_HELPDESK.md (raiz do projeto).
--
-- Não-destrutiva: apenas troca os CHECKs de `canal`. Linhas existentes
-- (webchat/whatsapp, fonte 'legado_jsonb') permanecem como histórico.
-- Escritores novos usam canal = 'helpdesk'.
-- ============================================================

-- Remove qualquer CHECK que restrinja a coluna `canal` das tabelas
-- canônicas. Constraints inline ganham nome automático do Postgres
-- (`<tabela>_canal_check`), que pode variar — por isso a busca é por
-- catálogo (pg_constraint + pg_attribute) em vez de nome fixo.
do $$
declare
  t text;
  r record;
begin
  foreach t in array array[
    'atendimentos', 'volumes_faixa', 'uploads_volume',
    'dimensionamentos', 'prova_real'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    for r in
      select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'c'
        and a.attname = 'canal'
        and c.conrelid = to_regclass('public.' || t)
    loop
      execute format('alter table public.%I drop constraint %I', t, r.conname);
    end loop;
  end loop;
end $$;

-- `atendimentos` é o fato canônico: além de helpdesk, mantém 'outro'
-- (cargas manuais/classificação desconhecida).
alter table public.atendimentos
  add constraint atendimentos_canal_check
  check (canal in ('webchat', 'whatsapp', 'outro', 'helpdesk'));

alter table public.volumes_faixa
  add constraint volumes_faixa_canal_check
  check (canal in ('webchat', 'whatsapp', 'helpdesk'));

alter table public.uploads_volume
  add constraint uploads_volume_canal_check
  check (canal in ('webchat', 'whatsapp', 'helpdesk'));

alter table public.dimensionamentos
  add constraint dimensionamentos_canal_check
  check (canal in ('webchat', 'whatsapp', 'helpdesk'));

alter table public.prova_real
  add constraint prova_real_canal_check
  check (canal in ('webchat', 'whatsapp', 'helpdesk'));
