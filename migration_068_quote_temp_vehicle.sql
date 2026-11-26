-- 068: orçamento com veículo novo guarda todos os campos do veículo (marca, ano, cor, motorização, combustível, chassi, motor nº)
-- usados ao converter o orçamento em veículo cadastrado
alter table public.quotes add column if not exists temp_vehicle jsonb;
