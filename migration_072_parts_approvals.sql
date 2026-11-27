-- 072: aprovação de peças pelo cliente (carro já em serviço), item a item, no portal (celular + PIN).
-- A lista é montada no app (chefe como rascunho sem valores; gestor/administrativo completa e envia).
-- A decisão só pode ser gravada pela função portal_decide_parts (sessão válida do portal):
-- o trigger bloqueia qualquer outra mudança na lista depois de enviada, para valer como prova.

create table if not exists parts_approvals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  division text not null default 'performance',
  status text not null default 'draft' check (status in ('draft','sent','decided','cancelled')),
  -- items: [{key,name,brand,qty,cost,markup,price,total,taskId,newTask:{label,category},import:{cur,amount,rate,taxPct,extra},decision,decidedAt}]
  items jsonb not null default '[]'::jsonb,
  note text not null default '',
  valid_days integer not null default 3,
  valid_until timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  decided_by_client uuid,
  decided_meta jsonb,
  total_approved numeric,
  cancelled_at timestamptz
);
create index if not exists parts_approvals_vehicle_idx on parts_approvals(vehicle_id);
alter table parts_approvals enable row level security;
drop policy if exists parts_approvals_all on parts_approvals;
create policy parts_approvals_all on parts_approvals for all using (true) with check (true);

create or replace function parts_approvals_guard() returns trigger language plpgsql as $$
declare deciding boolean := coalesce(current_setting('osc.parts_decide', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft','sent') then raise exception 'Status inicial inválido'; end if;
    new.decided_at := null; new.decided_by_client := null; new.decided_meta := null; new.total_approved := null;
    if new.status = 'sent' then
      new.sent_at := now();
      new.valid_until := now() + make_interval(days => greatest(new.valid_days, 1));
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('sent','decided') then raise exception 'Lista enviada ou decidida não pode ser apagada (cancele)'; end if;
    return old;
  end if;
  -- UPDATE
  if deciding then return new; end if;
  if old.status = 'draft' then
    if new.status not in ('draft','sent','cancelled') then raise exception 'Status inválido'; end if;
    new.decided_at := null; new.decided_by_client := null; new.decided_meta := null; new.total_approved := null;
    if new.status = 'sent' then
      new.sent_at := now();
      new.valid_until := now() + make_interval(days => greatest(new.valid_days, 1));
    end if;
    if new.status = 'cancelled' then new.cancelled_at := now(); end if;
    return new;
  end if;
  if old.status = 'sent' and new.status = 'cancelled'
     and new.items = old.items and new.vehicle_id = old.vehicle_id then
    new.cancelled_at := now();
    return new;
  end if;
  raise exception 'Lista já enviada: não pode ser alterada';
end $$;
drop trigger if exists parts_approvals_guard on parts_approvals;
create trigger parts_approvals_guard before insert or update or delete on parts_approvals
  for each row execute function parts_approvals_guard();

-- Cliente da sessão é dono do veículo?
create or replace function portal_owns_vehicle(p_client uuid, p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from vehicles v where v.id = p_vehicle and (
    exists(select 1 from vehicle_owners o where o.vehicle_id = v.id and o.is_current and o.client_id = p_client)
    or (v.client_id = p_client and not exists(select 1 from vehicle_owners o where o.vehicle_id = v.id and o.is_current))));
$$;

-- Decisão do cliente. p_decisions: {"<key>":"approved"|"rejected", ...} (todos os itens).
create or replace function portal_decide_parts(p_token text, p_id uuid, p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid; r parts_approvals%rowtype; it jsonb; d text; newitems jsonb := '[]'::jsonb;
  ts timestamptz := now(); tot numeric := 0; nap int := 0; nrej int := 0;
  tid uuid; po uuid; mat jsonb; hdr jsonb; ntasks jsonb := '{}'::jsonb; lbl text;
begin
  update client_portal_sessions set last_seen_at = now() where token = p_token returning client_id into cid;
  if cid is null then raise exception 'Sessão expirada. Entre de novo.'; end if;
  select * into r from parts_approvals where id = p_id for update;
  if not found or not portal_owns_vehicle(cid, r.vehicle_id) then raise exception 'Lista não encontrada'; end if;
  if r.status <> 'sent' then raise exception 'Esta lista já foi respondida ou cancelada'; end if;
  if r.valid_until is not null and r.valid_until < now() then raise exception 'Prazo desta lista venceu. Fale com a oficina.'; end if;

  for it in select * from jsonb_array_elements(r.items) loop
    d := p_decisions->>(it->>'key');
    if d is null or d not in ('approved','rejected') then raise exception 'Responda todos os itens'; end if;
    newitems := newitems || jsonb_build_array(it || jsonb_build_object('decision', d, 'decidedAt', ts));
    if d = 'approved' then nap := nap + 1; tot := tot + coalesce((it->>'total')::numeric, 0); else nrej := nrej + 1; end if;
  end loop;

  begin hdr := current_setting('request.headers', true)::jsonb; exception when others then hdr := null; end;
  perform set_config('osc.parts_decide', '1', true);
  update parts_approvals set items = newitems, status = 'decided', decided_at = ts, decided_by_client = cid,
    total_approved = tot,
    decided_meta = jsonb_build_object('via', 'portal', 'ip', coalesce(hdr->>'x-forwarded-for', hdr->>'cf-connecting-ip'), 'ua', hdr->>'user-agent')
   where id = p_id;
  perform set_config('osc.parts_decide', '', true);

  -- Aplica os aprovados na OS
  for it in select * from jsonb_array_elements(newitems) loop
    continue when it->>'decision' <> 'approved';
    if it ? 'import' and jsonb_typeof(it->'import') = 'object' then
      update vehicles set import_parts = coalesce(case when jsonb_typeof(import_parts) = 'array' then import_parts end, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('name', it->>'name', 'cur', coalesce(it->'import'->>'cur','USD'),
             'amount', coalesce((it->'import'->>'amount')::numeric,0), 'rate', coalesce((it->'import'->>'rate')::numeric,0),
             'taxPct', coalesce((it->'import'->>'taxPct')::numeric,0), 'extra', coalesce((it->'import'->>'extra')::numeric,0),
             'discount', 0, 'arrived', false, 'approvalId', p_id))
       where id = r.vehicle_id;
      continue;
    end if;
    tid := nullif(it->>'taskId','')::uuid;
    if tid is null or not exists(select 1 from tasks where id = tid and vehicle_id = r.vehicle_id) then
      lbl := coalesce(nullif(it->'newTask'->>'label',''), 'Peças aprovadas');
      if ntasks ? lbl then tid := (ntasks->>lbl)::uuid;
      else
        insert into tasks(vehicle_id, label, done, hours, materials, division, category)
          values (r.vehicle_id, lbl, false, 0, '[]'::jsonb, r.division, nullif(it->'newTask'->>'category',''))
          returning id into tid;
        ntasks := ntasks || jsonb_build_object(lbl, tid);
      end if;
    end if;
    insert into purchase_orders(vehicle_id, task_id, part_name, description, quantity, notes_admin, cost_price, markup_pct, status, link)
      values (r.vehicle_id, tid, it->>'name', 'Aprovado pelo cliente no portal', greatest(1, round(coalesce((it->>'qty')::numeric,1))::int),
              coalesce(it->>'brand',''), nullif(it->>'cost','')::numeric, coalesce((it->>'markup')::numeric, 50), 'approved', '')
      returning id into po;
    mat := jsonb_build_object('name', it->>'name', 'brand', coalesce(it->>'brand',''), 'qty', coalesce((it->>'qty')::numeric,1),
      'cost', coalesce((it->>'cost')::numeric,0), 'markup', coalesce((it->>'markup')::numeric,50),
      'fromStock', false, 'stockItemId', null, 'purchaseOrderId', po, 'approvalId', p_id);
    update tasks set materials = coalesce(case when jsonb_typeof(materials) = 'array' then materials end, '[]'::jsonb) || jsonb_build_array(mat)
     where id = tid;
  end loop;

  return jsonb_build_object('approved', nap, 'rejected', nrej, 'total', tot, 'decided_at', ts);
end $$;
revoke all on function portal_decide_parts(text, uuid, jsonb) from public;
grant execute on function portal_decide_parts(text, uuid, jsonb) to anon, authenticated;
revoke all on function portal_owns_vehicle(uuid, uuid) from public, anon, authenticated;

-- Versão do cliente: só nome, marca, quantidade, valor final e decisão (sem custo nem margem)
create or replace function portal_parts_view(p_vids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'vehicle_id', a.vehicle_id, 'division', a.division, 'status', a.status, 'note', a.note,
    'sent_at', a.sent_at, 'valid_until', a.valid_until, 'decided_at', a.decided_at, 'total_approved', a.total_approved,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('key', i->>'key', 'name', i->>'name', 'brand', coalesce(i->>'brand',''),
               'qty', (i->>'qty')::numeric, 'total', (i->>'total')::numeric, 'decision', i->>'decision', 'decidedAt', i->>'decidedAt')), '[]'::jsonb)
              from jsonb_array_elements(a.items) i)
  ) order by a.sent_at desc), '[]'::jsonb)
  from parts_approvals a where a.vehicle_id = any(p_vids) and a.status in ('sent','decided');
$$;
revoke all on function portal_parts_view(uuid[]) from public, anon, authenticated;

-- portal_load: acrescenta 'parts_approvals' (versão do cliente)
CREATE OR REPLACE FUNCTION public.portal_load(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'parts_approvals', portal_parts_view(vids),
    'default_rate', (select default_rate from settings where id = 1),
    'company', (select jsonb_build_object('name', company_name, 'address', company_address, 'phone', company_phone, 'document', company_document) from settings where id = 1)
  );
end $function$;

-- realtime (aplicado junto com a correção 072b)
alter publication supabase_realtime add table parts_approvals;
