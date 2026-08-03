-- OSC Performance — Migração: função para abrir nova OS em veículo existente
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

create or replace function open_vehicle_os(
  p_vehicle_id uuid,
  p_employee_id uuid,
  p_entered_at timestamptz
) returns integer language plpgsql as $$
declare
  v_os_number integer;
begin
  -- Get next OS number from sequence
  v_os_number := nextval('os_number_seq');

  -- Update vehicle with new OS data
  update vehicles set
    os_number     = v_os_number,
    entered_at    = p_entered_at,
    delivered_at  = null,
    paused_at     = null,
    total_paused_ms = 0,
    status        = 'active',
    priority      = 'medium'
  where id = p_vehicle_id;

  -- Add mechanic to vehicle_mechanics if not already there
  insert into vehicle_mechanics (vehicle_id, employee_id)
  values (p_vehicle_id, p_employee_id)
  on conflict (vehicle_id, employee_id) do nothing;

  return v_os_number;
end;
$$;
