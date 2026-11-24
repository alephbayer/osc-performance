-- Peças importadas passam a ser guardadas no histórico da OS ao fechar
-- (antes o fechamento não as somava no total nem as guardava; ficavam no veículo).
alter table public.os_history add column if not exists import_parts jsonb not null default '[]'::jsonb;
