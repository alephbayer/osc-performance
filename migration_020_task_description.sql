-- OSC Performance — Migração: descrição opcional da tarefa
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table tasks add column if not exists description text default '';
