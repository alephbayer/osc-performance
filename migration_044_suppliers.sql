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
