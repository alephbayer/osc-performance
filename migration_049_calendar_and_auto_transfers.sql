-- Calendário: período, funcionário e concluído; tipos novos
alter table calendar_events add column if not exists end_date date, add column if not exists employee_id uuid, add column if not exists done boolean default false;
alter table calendar_events drop constraint if exists calendar_events_type_check;
alter table calendar_events add constraint calendar_events_type_check check (type in ('manual','visit','delivery','note','appointment','reminder','task','important','holiday','vacation','maintenance'));
-- Acertos internos automáticos (peças da Finishing pagas pela Performance)
alter table internal_transfers add column if not exists auto boolean default false, add column if not exists source_key text;
create unique index if not exists internal_transfers_source_key_uq on internal_transfers(source_key);
