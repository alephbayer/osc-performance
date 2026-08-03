-- OSC Performance — Migração: categoria das tarefas
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table tasks add column if not exists category text default null;
