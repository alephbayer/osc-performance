-- OSC Performance — Migração: histórico de OSs encerradas
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

create table if not exists os_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete set null,
  os_number integer,
  client_id uuid references clients(id) on delete set null,
  mechanic_ids jsonb default '[]'::jsonb,   -- snapshot dos mecânicos no momento da entrega
  entered_at timestamptz,
  delivered_at timestamptz,
  total_paused_ms bigint default 0,
  tasks_snapshot jsonb default '[]'::jsonb, -- snapshot completo das tarefas + materiais
  total_value numeric default 0,
  created_at timestamptz default now()
);

alter table os_history enable row level security;
create policy "allow all os_history" on os_history for all using (true) with check (true);
