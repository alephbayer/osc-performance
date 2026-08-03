-- Migration 032: Despesas fixas (salários, aluguel, etc)
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null default 0,
  category text not null default 'outros', -- salario | aluguel | outros
  recurrent boolean not null default true,
  division text not null default 'performance' check (division in ('performance','finishing','ambos')),
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;
create policy "anyone can manage expenses" on expenses for all using (true) with check (true);
