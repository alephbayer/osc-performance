-- 061: portal_load deixa de enviar orçamentos em rascunho ao cliente (só depois de "Enviar" na oficina).
create or replace function public.portal_load(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; vids uuid[]; hids uuid[]; aids uuid[]; eids uuid[]; pnames text[];
begin
  delete from client_portal_sessions where last_seen_at < now() - interval '180 days';
  update client_portal_sessions set last_seen_at = now() where token = p_token returning client_id into cid;
  if cid is null then return null; end if;

  select coalesce(array_agg(v.id), '{}') into vids from vehicles v
   where exists(select 1 from vehicle_owners o where o.vehicle_id = v.id and o.is_current and o.client_id = cid)
      or (v.client_id = cid and not exists(select 1 from vehicle_owners o where o.vehicle_id = v.id and o.is_current));
  select coalesce(array_agg(id), '{}') into hids from os_history where client_id = cid or vehicle_id = any(vids);
  select coalesce(array_agg(id), '{}') into aids from appointments where vehicle_id = any(vids);
  select coalesce(array_agg(distinct e), '{}') into eids from (
    select employee_id e from vehicle_mechanics where vehicle_id = any(vids)
    union select employee_id from vehicles where id = any(vids)
    union select completed_by_employee_id from tasks where vehicle_id = any(vids)) x where e is not null;
  select coalesce(array_agg(distinct n), '{}') into pnames from (
    select jsonb_array_elements(case when jsonb_typeof(parts_list) = 'array' then parts_list else '[]'::jsonb end)->>'name' n from vehicles where id = any(vids)
    union select jsonb_array_elements(case when jsonb_typeof(parts_list_finishing) = 'array' then parts_list_finishing else '[]'::jsonb end)->>'name' from vehicles where id = any(vids)) x where n is not null;

  return jsonb_build_object(
    'client', (select jsonb_build_object('id', id, 'name', name) from clients where id = cid),
    'vehicles', (select coalesce(jsonb_agg(v order by v.created_at), '[]') from vehicles v where v.id = any(vids)),
    'mechanics', (select coalesce(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'employee_id', employee_id)), '[]') from vehicle_mechanics where vehicle_id = any(vids)),
    'tasks', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from tasks t where t.vehicle_id = any(vids)),
    'payments', (select coalesce(jsonb_agg(p order by p.paid_at), '[]') from payments p where p.vehicle_id = any(vids) or p.os_history_id = any(hids)),
    'os_history', (select coalesce(jsonb_agg(h order by h.delivered_at desc), '[]') from os_history h where h.id = any(hids)),
    'purchase_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vehicle_id', vehicle_id, 'task_id', task_id, 'part_name', part_name, 'description', description, 'photo_url', photo_url, 'quantity', quantity, 'status', status, 'created_at', created_at, 'ready_at', ready_at, 'bought_at', bought_at, 'received_at', received_at, 'consumed_at', consumed_at) order by created_at desc), '[]') from purchase_orders where vehicle_id = any(vids)),
    'appointments', (select coalesce(jsonb_agg(a order by a.created_at desc), '[]') from appointments a where a.id = any(aids)),
    'appointment_services', (select coalesce(jsonb_agg(s order by s.created_at), '[]') from appointment_services s where s.appointment_id = any(aids)),
    'appointment_payments', (select coalesce(jsonb_agg(p order by p.paid_at), '[]') from appointment_payments p where p.appointment_id = any(aids)),
    'quotes', (select coalesce(jsonb_agg(q order by q.created_at desc), '[]') from quotes q where coalesce(q.status, 'draft') <> 'draft' and (q.client_id = cid or q.vehicle_id = any(vids))),
    'client_credits', (select coalesce(jsonb_agg(c order by c.created_at desc), '[]') from client_credits c where c.client_id = cid),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'division', division)), '[]') from employees where id = any(eids)),
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'photo', coalesce(photo, ''))), '[]') from stock where name = any(pnames)),
    'default_rate', (select default_rate from settings where id = 1)
  );
end $$;
