-- OSC Performance — Migração: combustível, reboque e desconto no histórico de OSs
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table os_history add column if not exists fuel_cost numeric default 0;
alter table os_history add column if not exists tows jsonb default '[]'::jsonb;
alter table os_history add column if not exists os_discount_pct numeric default 0;
