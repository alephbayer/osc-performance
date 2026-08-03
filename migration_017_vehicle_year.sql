-- OSC Performance — Migração: ano do veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists year integer default null;
