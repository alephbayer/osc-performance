ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS import_parts jsonb DEFAULT '[]'::jsonb;
