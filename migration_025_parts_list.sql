-- OSC Performance — Migração: lista de peças por veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists parts_list jsonb default '[]'::jsonb;
