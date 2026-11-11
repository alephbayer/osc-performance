alter table ml_purchase_items add column if not exists status_at timestamptz;     -- data do status de entrega atual
alter table ml_purchase_items add column if not exists shipped_at timestamptz;
alter table ml_purchase_items add column if not exists delivered_at timestamptz;
alter table ml_purchase_items add column if not exists paid_at timestamptz;       -- pagamento aprovado
alter table ml_purchase_items add column if not exists ship_history jsonb;         -- [{status,date}] etapas do envio
