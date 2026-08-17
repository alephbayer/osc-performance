-- Tabela de itens da prateleira (catálogo de venda avulsa)
create table if not exists shelf_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0,
  category text not null default 'outros',
  stock_item_id uuid references stock(id) on delete set null, -- se vinculado ao estoque
  photo_url text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Tabela de vendas
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  sale_number serial,
  total numeric(10,2) not null default 0,
  method text not null default 'pix',
  note text,
  division text not null default 'performance',
  sold_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Itens de cada venda
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  shelf_item_id uuid references shelf_items(id) on delete set null,
  name text not null,
  price numeric(10,2) not null,
  qty integer not null default 1,
  from_stock boolean not null default false
);

-- RLS
alter table shelf_items enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

create policy "shelf_items_all" on shelf_items for all using (true);
create policy "sales_all" on sales for all using (true);
create policy "sale_items_all" on sale_items for all using (true);
