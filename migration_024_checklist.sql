-- OSC Performance — Migração: checklist de entrada do veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists checklist jsonb default '[]'::jsonb;
