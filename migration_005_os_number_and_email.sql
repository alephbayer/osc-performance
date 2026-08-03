-- OSC Performance — Migração Lote A
-- 1) Numeração sequencial de OS nos veículos
-- 2) Campo de e-mail nos clientes
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- Sequência para numeração automática das OSs
create sequence if not exists os_number_seq start 1;

-- Adiciona número de OS ao veículo (gerado automaticamente ao criar)
alter table vehicles add column if not exists os_number integer default nextval('os_number_seq');

-- Preenche veículos existentes que ainda não têm número
update vehicles set os_number = nextval('os_number_seq') where os_number is null;

-- Torna o número único e não nulo daqui pra frente
alter table vehicles alter column os_number set not null;
alter table vehicles add constraint vehicles_os_number_unique unique (os_number);

-- Campo de e-mail nos clientes
alter table clients add column if not exists email text default '';
