-- 069: placa preta (veículo de coleção), marcada à mão no cadastro
alter table public.vehicles add column if not exists black_plate boolean not null default false;
