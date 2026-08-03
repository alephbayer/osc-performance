-- Migration 031: Client vehicle notes (pré-diagnóstico do cliente)
create table if not exists client_vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz
);

alter table client_vehicle_notes enable row level security;
create policy "anyone can manage client vehicle notes" on client_vehicle_notes for all using (true) with check (true);
