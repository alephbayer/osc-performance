-- OSC Performance — Migração Lote B
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- ── 1. Múltiplos mecânicos por veículo ─────────────────────────────────────
create table if not exists vehicle_mechanics (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  added_at timestamptz default now(),
  unique(vehicle_id, employee_id)
);

alter table vehicle_mechanics enable row level security;
create policy "allow all vehicle_mechanics" on vehicle_mechanics for all using (true) with check (true);

-- Migra o mecânico único existente para a nova tabela
insert into vehicle_mechanics (vehicle_id, employee_id)
select id, employee_id from vehicles where employee_id is not null
on conflict do nothing;

-- ── 2. Assinatura de tarefa (quem concluiu) ─────────────────────────────────
alter table tasks add column if not exists completed_by_employee_id uuid references employees(id) on delete set null;

-- ── 3. Histórico de donos do veículo ────────────────────────────────────────
create table if not exists vehicle_owners (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  started_at timestamptz default now(),
  ended_at timestamptz,     -- null = dono atual
  is_current boolean default true
);

alter table vehicle_owners enable row level security;
create policy "allow all vehicle_owners" on vehicle_owners for all using (true) with check (true);

-- Migra donos atuais para a nova tabela
insert into vehicle_owners (vehicle_id, client_id, started_at, is_current)
select id, client_id, created_at, true from vehicles where client_id is not null
on conflict do nothing;

-- ── 4. Status e timers do veículo ───────────────────────────────────────────
alter table vehicles add column if not exists status text default 'active' check (status in ('active','paused','ready'));
alter table vehicles add column if not exists paused_at timestamptz;
alter table vehicles add column if not exists total_paused_ms bigint default 0;
-- total_paused_ms acumula tempo de pausas anteriores; paused_at marca início da pausa atual
