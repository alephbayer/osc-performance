-- Cobranças parciais registradas (botão "Cobrança parcial" na OS). Itens cobrados ficam travados
-- na próxima cobrança; cancelar (canceled_at) libera. O PDF final da OS não usa esta tabela.
create table if not exists partial_charges (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  division text not null default 'performance',     -- performance | finishing
  number int not null,                              -- nº da cobrança na OS/divisão
  items jsonb not null default '[]',                -- [{key,label,value}] valor no momento da cobrança
  total numeric(12,2) not null default 0,
  created_by text,
  created_at timestamptz default now(),
  canceled_at timestamptz
);
create index if not exists partial_charges_vehicle on partial_charges(vehicle_id, division);

alter table partial_charges enable row level security;
drop policy if exists "partial_charges_anon" on partial_charges;
create policy "partial_charges_anon" on partial_charges for all to anon using (true) with check (true);
