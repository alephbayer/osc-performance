-- OSC Performance — Migração: tipo de cobrança da tarefa (hora ou quantidade)
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table tasks add column if not exists rate_type text default 'hour';
