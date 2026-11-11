-- Controle anti-duplicidade das notas importadas (veículos e estoque)
create table if not exists purchase_imports (
  id uuid primary key default gen_random_uuid(),
  note_id text not null,
  item_key text not null,
  item_name text,
  qty numeric,
  unit_cost numeric,
  items_total int,
  doc_number text,
  supplier_name text,
  file_name text,
  destination text not null default 'vehicle',   -- vehicle | stock | ignored
  vehicle_id uuid,
  vehicle_label text,
  stock_id uuid,
  created_by text,
  created_at timestamptz default now(),
  unique (note_id, item_key)
);
create index if not exists purchase_imports_note on purchase_imports(note_id);
alter table purchase_imports enable row level security;
drop policy if exists "purchase_imports_anon" on purchase_imports;
create policy "purchase_imports_anon" on purchase_imports for all to anon using (true) with check (true);
alter table supplier_documents add column if not exists note_id text;
