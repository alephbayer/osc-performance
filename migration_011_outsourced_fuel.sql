-- OSC Performance — Migração: tarefas terceirizadas + combustível por OS
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- Marca uma tarefa como serviço terceirizado
alter table tasks add column if not exists outsourced boolean default false;

-- Custo de combustível da OS atual do veículo (zerado ao encerrar a OS)
alter table vehicles add column if not exists fuel_cost numeric default 0;
