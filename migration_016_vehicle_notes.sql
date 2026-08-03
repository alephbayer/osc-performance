-- OSC Performance — Migração: observações do veículo em serviço
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists notes text default '';
