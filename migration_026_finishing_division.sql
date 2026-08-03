-- OSC Performance — Migração: OSC Finishing Division
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

-- 1. Employees: which division they belong to
alter table employees add column if not exists division text not null default 'performance' check (division in ('performance','finishing'));

-- 2. Tasks: which division the task belongs to
alter table tasks add column if not exists division text not null default 'performance' check (division in ('performance','finishing'));

-- 3. Payments: which division the payment belongs to
alter table payments add column if not exists division text not null default 'performance' check (division in ('performance','finishing'));

-- 4. OS History: which division the archived OS belongs to
alter table os_history add column if not exists division text not null default 'performance' check (division in ('performance','finishing'));

-- 5. Vehicles: Finishing Division OS fields
alter table vehicles add column if not exists os_number_finishing       integer;
alter table vehicles add column if not exists entered_at_finishing      timestamptz;
alter table vehicles add column if not exists status_finishing          text not null default 'active';
alter table vehicles add column if not exists paused_at_finishing       timestamptz;
alter table vehicles add column if not exists total_paused_ms_finishing bigint not null default 0;
alter table vehicles add column if not exists photos_finishing          jsonb not null default '[]'::jsonb;
alter table vehicles add column if not exists notes_finishing           text not null default '';
alter table vehicles add column if not exists checklist_finishing       jsonb not null default '[]'::jsonb;
alter table vehicles add column if not exists os_discount_pct_finishing numeric not null default 0;

-- 6. Finishing OS number sequence (FD-001, FD-002, ...)
create sequence if not exists os_number_finishing_seq start 1;

-- 7. RPC: open a new Finishing OS (mechanic and entry date optional)
create or replace function open_vehicle_os_finishing(
  p_vehicle_id  uuid,
  p_employee_id uuid default null,
  p_entered_at  timestamptz default now()
)
returns integer language plpgsql as $$
declare
  v_os_number integer;
begin
  select nextval('os_number_finishing_seq') into v_os_number;
  update vehicles
  set
    os_number_finishing       = v_os_number,
    entered_at_finishing      = p_entered_at,
    status_finishing          = 'active',
    paused_at_finishing       = null,
    total_paused_ms_finishing = 0
  where id = p_vehicle_id;
  return v_os_number;
end;
$$;
