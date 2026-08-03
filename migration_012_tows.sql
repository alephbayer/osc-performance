-- OSC Performance — Migração: campo de reboques por OS
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists tows jsonb default '[]'::jsonb;
