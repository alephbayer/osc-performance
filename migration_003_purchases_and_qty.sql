-- OSC Performance — Migração: histórico de compras + quantidade de material por tarefa
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- 1) Novos campos no produto: localização e quantidade mínima (para alerta de estoque baixo)
alter table stock add column if not exists location text default '';
alter table stock add column if not exists min_qty integer default 2;

-- 2) Nova tabela: histórico de compras por produto
create table if not exists stock_purchases (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid references stock(id) on delete cascade,
  purchase_date date not null,
  supplier text default '',
  qty integer not null,
  unit_cost numeric not null,
  total_cost numeric not null,
  invoice_number text default '',
  created_at timestamptz default now()
);

alter table stock_purchases enable row level security;
create policy "allow all stock_purchases" on stock_purchases for all using (true) with check (true);

-- 3) Materiais de tarefas agora suportam quantidade (campo "qty" dentro de cada item do array materials).
--    Não requer alteração de schema, pois "materials" já é jsonb — apenas o app passa a gravar
--    {"name":..., "cost":..., "qty":..., "fromStock":..., "stockItemId":...} em vez de cost já multiplicado.
