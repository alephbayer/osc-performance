-- Migration 030: Client push subscriptions
create table if not exists client_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table client_push_subscriptions enable row level security;
create policy "anyone can manage client push subs" on client_push_subscriptions for all using (true) with check (true);
