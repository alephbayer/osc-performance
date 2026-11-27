-- 070: evolução do menu Vendas
-- Venda ligada ao cadastro do cliente, venda a prazo, desconto em coluna própria,
-- custo por item (margem), vínculo com o estoque e com o pagamento (estorno ao excluir).
-- Só adiciona colunas; vendas antigas ficam como "paid".

alter table public.sales add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.sales add column if not exists status text not null default 'paid';
alter table public.sales add column if not exists due_date date;
alter table public.sales add column if not exists paid_at timestamptz;
alter table public.sales add column if not exists discount numeric not null default 0;
alter table public.sales add column if not exists created_by text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_status_check') then
    alter table public.sales add constraint sales_status_check check (status in ('paid','pending'));
  end if;
end $$;
create index if not exists sales_client_id_idx on public.sales(client_id);

alter table public.sale_items add column if not exists stock_item_id uuid references public.stock(id) on delete set null;
alter table public.sale_items add column if not exists cost numeric;
alter table public.sale_items add column if not exists kind text not null default 'item';
alter table public.sale_items add column if not exists catalog_id uuid references public.service_catalog(id) on delete set null;

alter table public.payments add column if not exists sale_id uuid references public.sales(id) on delete set null;
create index if not exists payments_sale_id_idx on public.payments(sale_id);
