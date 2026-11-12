alter table ml_purchase_items add column if not exists status_at timestamptz;     -- data do status de entrega atual
alter table ml_purchase_items add column if not exists shipped_at timestamptz;
alter table ml_purchase_items add column if not exists delivered_at timestamptz;
alter table ml_purchase_items add column if not exists paid_at timestamptz;       -- pagamento aprovado
alter table ml_purchase_items add column if not exists ship_history jsonb;         -- [{status,date}] etapas do envio
-- alertas de entrega
alter table ml_purchase_items add column if not exists ship_substatus text;
alter table ml_purchase_items add column if not exists eta_at timestamptz;            -- previsão de entrega
alter table ml_purchase_items add column if not exists notif_route_at timestamptz;     -- push "saiu para entrega" já enviado
alter table ml_purchase_items add column if not exists notif_today_at timestamptz;     -- push "chega hoje" já enviado
alter table ml_purchase_items add column if not exists notif_delivered_at timestamptz; -- push "entregue" já enviado
-- vínculo com pedidos de compra
alter table ml_purchase_items add column if not exists user_product_id text;
alter table ml_purchase_items add column if not exists catalog_product_id text;
alter table ml_purchase_items add column if not exists link_type text;        -- po (pedido de veículo) | inv (pedido de compra avulso)
alter table ml_purchase_items add column if not exists link_id uuid;
alter table ml_purchase_items add column if not exists link_label text;
alter table ml_purchase_items add column if not exists link_done_at timestamptz;
create index if not exists ml_purchase_items_link on ml_purchase_items(link_type, link_id);
alter table ml_purchase_items add column if not exists freight numeric default 0;   -- frete rateado do pedido
alter table ml_purchase_items add column if not exists delivery_key text;   -- palavra-chave de entrega (manual)
alter table ml_purchase_items add column if not exists ml_key text;         -- palavra-chave encontrada na API do ML
alter table ml_purchase_items add column if not exists ship_probe jsonb;    -- diagnóstico: campos do envio que parecem código/senha
alter table ml_purchase_items add column if not exists expense_id uuid;   -- despesa gerada ao destinar como Insumos

-- Ferramentas (patrimônio da oficina; não é despesa)
create table if not exists tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  value numeric default 0,
  qty integer default 1,
  purchased_at date,
  location text default '',
  notes text default '',
  link text,
  seller text,
  ml_item_id uuid,
  created_at timestamptz default now()
);
alter table ml_purchase_items add column if not exists tool_id uuid;
alter table tools disable row level security;
grant select, insert, update, delete on tools to anon, authenticated;
alter table ml_purchase_items add column if not exists stock_plan jsonb;   -- entrada no estoque aguardando a entrega
alter table ml_purchase_items add column if not exists is_split boolean default false; -- linha dividida: sync não sobrescreve qty/freight
alter table expenses add column if not exists qty numeric; -- quantidade (insumos)
