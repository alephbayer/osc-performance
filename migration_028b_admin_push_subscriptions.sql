-- Migration 028b: Admin push subscriptions (gestor, admin, supervisor)
-- Run separately if migration_028 was already applied

create table if not exists admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('owner','admin','supervisor')),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table admin_push_subscriptions enable row level security;

drop policy if exists "anyone can manage admin push subs" on admin_push_subscriptions;
create policy "anyone can manage admin push subs" on admin_push_subscriptions for all using (true) with check (true);
