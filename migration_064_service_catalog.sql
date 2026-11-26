-- 064: catálogo de serviços (menu padrão usado na Nova tarefa, no orçamento e no agendamento).
-- rate_type 'hour': hours = horas estimadas; rate nulo = usa a MO padrão vigente (settings.default_rate).
-- rate_type 'qty': hours = quantidade padrão; rate = R$ por unidade.
-- Ao escolher um serviço, os valores são copiados para a tarefa/item: mudar o catálogo nunca altera OS antiga.
create table if not exists service_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  division text not null default 'performance' check (division in ('performance','finishing','both')),
  rate_type text not null default 'hour' check (rate_type in ('hour','qty')),
  hours numeric not null default 0,
  rate numeric,
  notes text,
  active boolean not null default true,
  source_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_catalog_division_idx on service_catalog (division, active);

alter table service_catalog enable row level security;
drop policy if exists "service_catalog_anon" on service_catalog;
create policy "service_catalog_anon" on service_catalog for all to anon using (true) with check (true);
