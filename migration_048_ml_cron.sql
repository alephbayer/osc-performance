-- Sincroniza o Mercado Livre a cada 15 min (07h–20h, horário de Brasília) para gerar os avisos de entrega
-- (a chave abaixo é a ANON pública do projeto — a mesma do app; troque <ANON_KEY> ao reaplicar)
select cron.schedule('ml-sync-entregas','*/15 10-23 * * *',$$
select net.http_post(
  url := 'https://lchfmoeyzgbepunetuch.supabase.co/functions/v1/ml-sync',
  headers := jsonb_build_object('Authorization','Bearer <ANON_KEY>','apikey','<ANON_KEY>','Content-Type','application/json'),
  body := '{"action":"sync","days":30}'::jsonb
)
$$);
