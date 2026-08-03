-- Migration 034: Investimentos
create table if not exists investments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  link text,
  value numeric not null default 0,
  quantity integer not null default 1,
  objective text,
  division text not null default 'performance' check (division in ('performance','finishing','ambos')),
  category text not null default 'leve' check (category in ('pesado','leve')),
  priority integer not null default 3 check (priority between 1 and 5),
  status text not null default 'pending' check (status in ('pending','approved','bought')),
  created_by text,
  created_at timestamptz not null default now()
);

alter table investments enable row level security;
create policy "anyone can manage investments"
  on investments for all using (true) with check (true);
