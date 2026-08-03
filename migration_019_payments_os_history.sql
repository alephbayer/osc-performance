-- OSC Performance — Migração: vincular pagamentos ao histórico de OS
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table payments add column if not exists os_history_id uuid references os_history(id) on delete set null;

-- Index para busca rápida por OS
create index if not exists payments_os_history_id_idx on payments(os_history_id);
