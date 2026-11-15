-- Tarefa interna: null = automático (sem valor = interna), true = interna, false = sempre visível
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS internal boolean DEFAULT NULL;
