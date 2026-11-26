-- 067: marca e motorização no cadastro do veículo
-- (chassi e número do motor já vieram na 066; "engine" é a motorização, ex.: "1.6 16V")
alter table public.vehicles add column if not exists brand text;
alter table public.vehicles add column if not exists engine text;
