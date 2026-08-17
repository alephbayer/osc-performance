-- Adiciona categoria 'materiais' na tabela investments
ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_category_check;
ALTER TABLE investments ADD CONSTRAINT investments_category_check 
  CHECK (category IN ('pesado', 'leve', 'materiais'));
