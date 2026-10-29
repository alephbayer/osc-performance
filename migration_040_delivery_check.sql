alter table public.vehicles add column if not exists delivery_check jsonb not null default '{}'::jsonb;
