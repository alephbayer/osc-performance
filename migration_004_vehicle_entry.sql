-- OSC Performance — Migração: data de entrada do veículo na oficina
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists entered_at timestamptz;
