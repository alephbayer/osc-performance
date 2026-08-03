-- OSC Performance — Migração: data de entrega do veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists delivered_at timestamptz;
