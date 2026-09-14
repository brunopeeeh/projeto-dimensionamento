-- ============================================================
-- 010_volumes_legado_nullable.sql
-- O app (fila única) grava apenas `helpdesk_volumes` em volumes_chamados.
-- As colunas legadas `webchat_volumes`/`whatsapp_volumes` ficaram NOT NULL,
-- e o Postgres valida NOT NULL do tuple mesmo em
-- INSERT ... ON CONFLICT DO UPDATE — ou seja, todo upsert de volume (e a
-- criação de mês novo) falhava com 23502 desde a migração para fila única.
--
-- As colunas continuam existindo como histórico/rollback; apenas deixam de
-- ser obrigatórias. Idempotente (drop not null em coluna já nulável é no-op).
-- ============================================================

alter table public.volumes_chamados
  alter column webchat_volumes drop not null;

alter table public.volumes_chamados
  alter column whatsapp_volumes drop not null;
