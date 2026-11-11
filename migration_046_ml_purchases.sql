-- Mercado Livre: tokens (somente servidor) e compras puxadas da conta
create table if not exists ml_tokens (
  id int primary key default 1,
  ml_user_id text,
  nickname text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  last_sync_at timestamptz,
  updated_at timestamptz default now(),
  check (id = 1)
);
alter table ml_tokens enable row level security;   -- sem policy: só a Edge Function (service role) acessa

create table if not exists ml_purchase_items (
  id uuid primary key default gen_random_uuid(),
  ml_order_id text not null,
  ml_item_id text not null,
  variation_id text not null default '',
  title text,
  qty numeric,
  unit_price numeric,
  ordered_at timestamptz,
  order_status text,
  ship_status text,
  seller text,
  permalink text,
  thumbnail text,
  -- destino (preenchido pelo app)
  destination text,                 -- null = pendente | vehicle | stock | ignored
  vehicle_id uuid,
  vehicle_label text,
  task_id text,
  task_label text,
  stock_id uuid,
  assigned_by text,
  assigned_at timestamptz,
  created_at timestamptz default now(),
  unique (ml_order_id, ml_item_id, variation_id)
);
create index if not exists ml_purchase_items_dest on ml_purchase_items(destination, ordered_at desc);
alter table ml_purchase_items enable row level security;
drop policy if exists "ml_items_read" on ml_purchase_items;
drop policy if exists "ml_items_update" on ml_purchase_items;
create policy "ml_items_read" on ml_purchase_items for select to anon using (true);
create policy "ml_items_update" on ml_purchase_items for update to anon using (true) with check (true);
