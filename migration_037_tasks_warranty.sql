-- Adiciona coluna warranty na tabela tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS warranty boolean NOT NULL DEFAULT false;
