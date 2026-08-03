-- OSC Performance — Migração: desconto por tarefa e desconto % por OS
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- Desconto em R$ por tarefa (incide sobre mão de obra)
alter table tasks add column if not exists discount numeric default 0;

-- Desconto % por OS (incide sobre o total de mão de obra de todas as tarefas)
alter table vehicles add column if not exists os_discount_pct numeric default 0;
