-- Entregas 99 (99Entrega / 99 Moto): registro manual agora; a integração pela API oficial
-- vai preencher as mesmas linhas (source='api', external_order_id) quando a 99 liberar o token.
create table if not exists deliveries_99 (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  direction text not null default 'envio',          -- envio | coleta
  description text,                                  -- o que foi levado/buscado
  origin text,
  destination text,
  vehicle_id uuid references vehicles(id) on delete set null,
  vehicle_label text,
  tracking_url text,                                 -- link de rastreamento da 99
  status text not null default 'requested',          -- requested | pickup | delivering | delivered | canceled | returned
  driver_name text,
  driver_plate text,
  eta timestamptz,
  cost numeric(10,2),                                -- só owner/admin veem (ocultação na interface)
  notes text,
  delivered_at timestamptz,
  source text not null default 'manual',             -- manual | api
  external_order_id text unique,                     -- id que o sistema envia à 99 (API)
  api_order_id text,                                 -- id da 99 (API)
  api_payload jsonb,                                 -- último retorno/webhook da 99
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists deliveries_99_date on deliveries_99(delivery_date desc);
create index if not exists deliveries_99_status on deliveries_99(status);

alter table deliveries_99 enable row level security;
drop policy if exists "deliveries_99_anon" on deliveries_99;
create policy "deliveries_99_anon" on deliveries_99 for all to anon using (true) with check (true);
