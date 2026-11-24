-- 060: Portal do cliente com PIN e sessão no banco.
-- Antes o PIN ficava só no navegador do cliente (localStorage): em outro aparelho qualquer
-- pessoa criava um PIN novo para o número de outro cliente, e o portal baixava o banco inteiro.
-- Agora: PIN com hash bcrypt em tabela fechada (RLS sem policies), bloqueio após 5 erros,
-- sessão por token e carga só dos dados daquele cliente (portal_load).
-- Limite conhecido: as demais tabelas continuam abertas à chave pública (ver PENDENCIAS, link seguro),
-- e portal_reset_pin pode ser chamada por quem tem a chave pública (o app interno usa a mesma chave).

create table if not exists public.client_portal_pins (
  client_id uuid primary key references public.clients(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.client_portal_pins enable row level security;
revoke all on public.client_portal_pins from anon, authenticated;

create table if not exists public.client_portal_sessions (
  token text primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists client_portal_sessions_client_idx on public.client_portal_sessions(client_id);
alter table public.client_portal_sessions enable row level security;
revoke all on public.client_portal_sessions from anon, authenticated;

-- Busca o cliente pelo celular (só dígitos; aceita com ou sem o 55). Devolve só o primeiro nome.
create or replace function public.portal_find_client(p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g'); c record;
begin
  if length(d) < 8 then return null; end if;
  select id, name into c from clients
   where regexp_replace(coalesce(phone,''), '\D', '', 'g') in (d, '55' || d)
   order by created_at limit 1;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'id', c.id,
    'name', split_part(trim(coalesce(c.name,'')), ' ', 1),
    'has_pin', exists(select 1 from client_portal_pins where client_id = c.id));
end $$;

create or replace function public._portal_new_session(p_client_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(32), 'hex');
begin
  insert into client_portal_sessions(token, client_id) values (tok, p_client_id);
  return tok;
end $$;
revoke all on function public._portal_new_session(uuid) from public, anon, authenticated;

-- Cria o PIN (só se o cliente ainda não tiver um) e já abre a sessão.
create or replace function public.portal_create_pin(p_client_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if coalesce(p_pin,'') !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'formato'); end if;
  if not exists(select 1 from clients where id = p_client_id) then return jsonb_build_object('ok', false, 'error', 'cliente'); end if;
  insert into client_portal_pins(client_id, pin_hash) values (p_client_id, crypt(p_pin, gen_salt('bf')))
  on conflict (client_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'existe'); end if;
  return jsonb_build_object('ok', true, 'token', _portal_new_session(p_client_id));
end $$;

-- Confere o PIN. 5 erros seguidos bloqueiam por 15 minutos.
create or replace function public.portal_login(p_client_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r client_portal_pins;
begin
  select * into r from client_portal_pins where client_id = p_client_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'sem_pin'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'bloqueado', 'until', r.locked_until);
  end if;
  if coalesce(p_pin,'') ~ '^\d{4}$' and r.pin_hash = crypt(p_pin, r.pin_hash) then
    update client_portal_pins set failed_attempts = 0, locked_until = null where client_id = p_client_id;
    return jsonb_build_object('ok', true, 'token', _portal_new_session(p_client_id));
  end if;
  if r.failed_attempts + 1 >= 5 then
    update client_portal_pins set failed_attempts = 0, locked_until = now() + interval '15 minutes' where client_id = p_client_id;
    return jsonb_build_object('ok', false, 'error', 'bloqueado', 'until', now() + interval '15 minutes');
  end if;
  update client_portal_pins set failed_attempts = r.failed_attempts + 1 where client_id = p_client_id;
  return jsonb_build_object('ok', false, 'error', 'pin', 'left', 5 - (r.failed_attempts + 1));
end $$;

create or replace function public.portal_logout(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from client_portal_sessions where token = p_token;
$$;

-- Reset pelo cadastro do cliente: apaga o PIN e encerra as sessões abertas.
create or replace function public.portal_reset_pin(p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from client_portal_pins where client_id = p_client_id;
  delete from client_portal_sessions where client_id = p_client_id;
end $$;

-- Tudo o que o portal mostra, só daquele cliente. Sessão expira após 180 dias sem uso.
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
    'quotes', (select coalesce(jsonb_agg(q order by q.created_at desc), '[]') from quotes q where q.client_id = cid or q.vehicle_id = any(vids)),
    'client_credits', (select coalesce(jsonb_agg(c order by c.created_at desc), '[]') from client_credits c where c.client_id = cid),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'division', division)), '[]') from employees where id = any(eids)),
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'photo', coalesce(photo, ''))), '[]') from stock where name = any(pnames)),
    'default_rate', (select default_rate from settings where id = 1)
  );
end $$;

grant execute on function public.portal_find_client(text), public.portal_create_pin(uuid, text), public.portal_login(uuid, text),
  public.portal_logout(text), public.portal_reset_pin(uuid), public.portal_load(text) to anon, authenticated;
