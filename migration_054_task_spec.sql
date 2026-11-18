-- Ficha detalhada do serviço (página dedicada no PDF do orçamento)
alter table tasks add column if not exists featured boolean not null default false;
alter table tasks add column if not exists spec jsonb;
alter table tasks add column if not exists spec_photos jsonb;
