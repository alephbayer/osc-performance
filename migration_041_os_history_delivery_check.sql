alter table public.os_history add column if not exists delivery_check jsonb not null default '{}'::jsonb;
alter table public.os_history add column if not exists delivery_check_pdf text;
alter table public.os_history add column if not exists delivery_check_at timestamptz;
