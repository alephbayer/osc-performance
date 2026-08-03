-- OSC Performance — Migração: combustíveis por OS (array)
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists fuels jsonb default '[]'::jsonb;

-- Também adiciona ao os_history para snapshot
alter table os_history add column if not exists fuels jsonb default '[]'::jsonb;
