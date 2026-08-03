-- Migration 033: Pedidos de Compra
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,

  -- Mechanic fills
  part_name text not null,
  description text,
  photo_url text,
  quantity integer not null default 1,

  -- Admin fills
  link text,
  cost_price numeric,
  markup_pct numeric default 30,
  notes_admin text,

  -- Status flow
  status text not null default 'pending'
    check (status in ('pending','ready_to_buy','bought','received')),

  created_at timestamptz not null default now(),
  ready_at timestamptz,
  bought_at timestamptz,
  received_at timestamptz
);

alter table purchase_orders enable row level security;
create policy "anyone can manage purchase orders"
  on purchase_orders for all using (true) with check (true);
