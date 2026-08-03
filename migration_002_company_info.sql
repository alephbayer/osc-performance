-- OSC Performance — Migração: dados da empresa para o PDF de orçamento
-- Execute no SQL Editor do Supabase. Segura: não apaga dados existentes.

alter table settings add column if not exists company_name text default 'OSC Performance';
alter table settings add column if not exists company_address text default '';
alter table settings add column if not exists company_phone text default '';
alter table settings add column if not exists company_document text default ''; -- CNPJ
