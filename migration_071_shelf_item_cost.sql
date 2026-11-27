-- 071: preço de custo opcional no item de prateleira (menu Vendas).
-- Usado na margem quando o item não está vinculado ao estoque (vinculado usa o custo do estoque).
alter table public.shelf_items add column if not exists cost numeric;
