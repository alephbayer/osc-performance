-- OSC Performance — Correção: permite os_number nulo em veículos sem OS ativa
-- Execute no SQL Editor do Supabase.

alter table vehicles alter column os_number drop not null;
alter table vehicles alter column os_number drop default;
