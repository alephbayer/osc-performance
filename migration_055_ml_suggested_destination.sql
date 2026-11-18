-- Destino do ML passa a ser sugerido (pedido feito para um carro/serviço) e confirmado pelo admin/gestor
alter table ml_purchase_items
  add column if not exists suggest_vehicle_id uuid,
  add column if not exists suggest_vehicle_label text,
  add column if not exists suggest_task_id text,
  add column if not exists suggest_task_label text;
