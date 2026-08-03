-- Migration 028: Push Subscriptions for mechanic notifications
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Allow the app to insert/delete subscriptions
alter table push_subscriptions enable row level security;
create policy "anyone can manage push subs" on push_subscriptions for all using (true) with check (true);

-- Admin push subscriptions (for gestor, admin, supervisor roles)
create table if not exists admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('owner','admin','supervisor')),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table admin_push_subscriptions enable row level security;
create policy "anyone can manage admin push subs" on admin_push_subscriptions for all using (true) with check (true);
