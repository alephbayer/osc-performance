-- OSC Performance — Migration: múltiplos materiais por tarefa + data de conclusão
-- Execute este script no SQL Editor do Supabase (projeto já existente, dados preservados)

-- 1) Nova coluna: lista de materiais (array JSON), substituindo material/material_cost/from_stock/stock_item_id únicos
alter table tasks add column if not exists materials jsonb default '[]'::jsonb;

-- 2) Nova coluna: data/hora em que a tarefa foi marcada como concluída (necessária para produtividade mensal)
alter table tasks add column if not exists completed_at timestamptz;

-- 3) Migra dados existentes: transforma o material único antigo no primeiro item da nova lista
update tasks
set materials = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', material,
    'cost', coalesce(material_cost, 0),
    'fromStock', coalesce(from_stock, false),
    'stockItemId', stock_item_id
  )
)
where material is not null and material <> '' and (materials is null or materials = '[]'::jsonb);

-- 4) Para tarefas já concluídas sem completed_at, usa created_at como aproximação razoável
update tasks set completed_at = created_at where done = true and completed_at is null;

-- As colunas antigas (material, material_cost, from_stock, stock_item_id) são mantidas por segurança,
-- mas não são mais usadas pelo app a partir desta versão. Pode limpá-las depois de confirmar que está tudo certo:
-- alter table tasks drop column material, drop column material_cost, drop column from_stock, drop column stock_item_id;
