-- OSC Performance — Migração: ordem de sequência dos veículos
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table vehicles add column if not exists sort_order integer default 0;
