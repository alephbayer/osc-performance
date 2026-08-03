-- OSC Performance — Migração: prioridade do veículo
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists priority text default 'medium' check (priority in ('high','medium','low'));
