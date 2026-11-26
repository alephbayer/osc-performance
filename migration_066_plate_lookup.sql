-- 066: consulta de veículo pela placa (API Placas, consulta completa)
-- (065 está reservada para a importação de OSs antigas)

-- Dados novos do veículo, preenchidos pela consulta (o usuário confere antes de salvar)
alter table public.vehicles add column if not exists chassis text;
alter table public.vehicles add column if not exists engine_number text;
alter table public.vehicles add column if not exists fuel_type text;

-- Cache por placa: cada placa é paga uma vez só.
-- RLS ligado e sem policies: só a edge function plate-lookup (service role) lê e grava.
create table if not exists public.plate_lookups (
  plate       text primary key,           -- placa normalizada (ABC1D23)
  provider    text not null default 'apiplacas',
  product     text not null default 'completa',
  data        jsonb not null,             -- resposta normalizada devolvida ao app
  raw         jsonb,                      -- resposta original do provedor
  fetched_at  timestamptz not null default now()
);
alter table public.plate_lookups enable row level security;
create index if not exists plate_lookups_fetched_at_idx on public.plate_lookups (fetched_at);
