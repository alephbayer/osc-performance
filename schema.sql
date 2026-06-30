-- OSC Performance — Schema do banco de dados
-- Execute este script no SQL Editor do Supabase

create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text default '',
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text default '',
  created_at timestamptz default now()
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  model text not null,
  plate text not null,
  photo text,
  photos jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  label text not null,
  done boolean default false,
  material text default '',
  material_cost numeric default 0,
  hours numeric default 0,
  rate_per_hour numeric,
  from_stock boolean default false,
  stock_item_id uuid,
  created_at timestamptz default now()
);

create table stock (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text default '',
  type text default '',
  qty integer default 0,
  cost_price numeric default 0,
  markup numeric default 100,
  sale_price numeric default 0,
  photo text,
  created_at timestamptz default now()
);

create table settings (
  id integer primary key default 1,
  default_rate numeric default 0,
  constraint single_row check (id = 1)
);
insert into settings (id, default_rate) values (1, 0);

create table payments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  amount numeric not null,
  method text default '',
  paid_at date not null,
  note text default '',
  created_at timestamptz default now()
);

-- Habilita acesso público (anon key) para leitura e escrita
-- (adequado para uso interno da oficina; se quiser restringir por login depois, ajustamos)
alter table employees enable row level security;
alter table clients enable row level security;
alter table vehicles enable row level security;
alter table tasks enable row level security;
alter table stock enable row level security;
alter table settings enable row level security;
alter table payments enable row level security;

create policy "allow all employees" on employees for all using (true) with check (true);
create policy "allow all clients" on clients for all using (true) with check (true);
create policy "allow all vehicles" on vehicles for all using (true) with check (true);
create policy "allow all tasks" on tasks for all using (true) with check (true);
create policy "allow all stock" on stock for all using (true) with check (true);
create policy "allow all settings" on settings for all using (true) with check (true);
create policy "allow all payments" on payments for all using (true) with check (true);
