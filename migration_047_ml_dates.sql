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
