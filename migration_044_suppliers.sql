-- Cadastro de fornecedores (usado no autocompletar das compras de estoque)
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  phone text,
  email text,
  contact text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table suppliers enable row level security;
drop policy if exists "suppliers_anon" on suppliers;
create policy "suppliers_anon" on suppliers for all to anon using (true) with check (true);

-- Notas (PDF) anexadas ao fornecedor
create table if not exists supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  file_url text not null,
  file_name text,
  vehicle_label text,
  total numeric(12,2),
  note text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists supplier_documents_supplier on supplier_documents(supplier_id, created_at desc);
alter table supplier_documents enable row level security;
drop policy if exists "supplier_documents_anon" on supplier_documents;
create policy "supplier_documents_anon" on supplier_documents for all to anon using (true) with check (true);
