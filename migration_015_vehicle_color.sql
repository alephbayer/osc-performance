-- OSC Performance — Migração: cor do veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists color text default '';
