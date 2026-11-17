-- Consumo interno de estoque por funcionário (controle de uso de material; sem desconto em folha)
create table if not exists stock_usage (
  id uuid primary key default gen_random_uuid(),
  stock_id text not null,
  stock_name text not null,
  qty numeric not null,
  unit_cost numeric not null default 0,
  employee_id text,
  employee_name text,
  note text,
  used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists stock_usage_used_at_idx on stock_usage (used_at desc);
alter table stock_usage enable row level security;
drop policy if exists "stock_usage_all" on stock_usage;
create policy "stock_usage_all" on stock_usage for all to anon, authenticated using (true) with check (true);
