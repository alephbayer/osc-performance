-- Migration 027: Fix open_vehicle_os to reset all OS fields on new OS
-- Also adds parts_list_finishing for separate parts per company

-- 1. Add parts_list_finishing column
alter table vehicles add column if not exists parts_list_finishing jsonb not null default '[]'::jsonb;

-- 2. Fix open_vehicle_os to reset photos, checklist, notes, parts on new OS
create or replace function open_vehicle_os(
  p_vehicle_id uuid,
  p_employee_id uuid,
  p_entered_at timestamptz
) returns integer language plpgsql as $$
declare
  v_os_number integer;
begin
  v_os_number := nextval('os_number_seq');

  update vehicles set
    os_number       = v_os_number,
    entered_at      = p_entered_at,
    delivered_at    = null,
    paused_at       = null,
    total_paused_ms = 0,
    status          = 'active',
    priority        = 'medium',
    -- Reset OS-specific fields
    photos          = '[]'::jsonb,
    notes           = '',
    checklist       = '[]'::jsonb,
    parts_list      = '[]'::jsonb,
    fuels           = '[]'::jsonb,
    tows            = '[]'::jsonb,
    fuel_cost       = 0,
    os_discount_pct = 0,
    sort_order      = 0
  where id = p_vehicle_id;

  insert into vehicle_mechanics (vehicle_id, employee_id)
  values (p_vehicle_id, p_employee_id)
  on conflict (vehicle_id, employee_id) do nothing;

  return v_os_number;
end;
$$;

-- 3. Fix open_vehicle_os_finishing to reset finishing fields on new OS
create or replace function open_vehicle_os_finishing(
  p_vehicle_id  uuid,
  p_employee_id uuid default null,
  p_entered_at  timestamptz default now()
) returns integer language plpgsql as $$
declare
  v_os_number integer;
begin
  select nextval('os_number_finishing_seq') into v_os_number;

  update vehicles set
    os_number_finishing       = v_os_number,
    entered_at_finishing      = p_entered_at,
    status_finishing          = 'active',
    paused_at_finishing       = null,
    total_paused_ms_finishing = 0,
    -- Reset finishing-specific fields
    photos_finishing          = '[]'::jsonb,
    notes_finishing           = '',
    checklist_finishing       = '[]'::jsonb,
    parts_list_finishing      = '[]'::jsonb,
    os_discount_pct_finishing = 0
  where id = p_vehicle_id;

  return v_os_number;
end;
$$;
