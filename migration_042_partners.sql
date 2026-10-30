-- Módulo Parceiros: empresas parceiras que terceirizam serviços pontuais (fora de clientes/OS)
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Tabela de serviços com preço combinado (opcional, por parceiro)
create table if not exists partner_services (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  created_at timestamptz default now()
);

create table if not exists partner_jobs (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) on delete cascade,
  job_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  plate text,
  model text,
  color text,
  items jsonb not null default '[]'::jsonb,   -- [{name, value}]
  total numeric(10,2) not null default 0,
  done_by text,                                -- nomes de quem executou
  notes text,
  status text not null default 'doing',        -- doing | done
  delivered_at timestamptz,
  before_photos text[] not null default '{}',
  after_photos text[] not null default '{}',
  paid boolean not null default false,
  paid_at timestamptz,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists partner_jobs_partner_date on partner_jobs(partner_id, job_date desc);
create index if not exists partner_jobs_plate on partner_jobs(plate);

alter table partners enable row level security;
alter table partner_services enable row level security;
alter table partner_jobs enable row level security;
drop policy if exists "partners_anon" on partners;
drop policy if exists "partner_services_anon" on partner_services;
drop policy if exists "partner_jobs_anon" on partner_jobs;
create policy "partners_anon" on partners for all to anon using (true) with check (true);
create policy "partner_services_anon" on partner_services for all to anon using (true) with check (true);
create policy "partner_jobs_anon" on partner_jobs for all to anon using (true) with check (true);
