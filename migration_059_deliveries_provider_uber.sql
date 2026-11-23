-- Entregas: tela única para 99 e Uber. A tabela continua se chamando deliveries_99 (já está no ar);
-- o campo provider diz de qual empresa é a entrega. Campos novos servem à API da Uber Direct.
alter table deliveries_99 add column if not exists provider text not null default '99';
alter table deliveries_99 drop constraint if exists deliveries_99_provider_check;
alter table deliveries_99 add constraint deliveries_99_provider_check check (provider in ('99','uber'));

alter table deliveries_99 add column if not exists pickup_address jsonb;   -- {street, number, complement, district, city, state, zip}
alter table deliveries_99 add column if not exists dropoff_address jsonb;
alter table deliveries_99 add column if not exists pickup_name text;
alter table deliveries_99 add column if not exists pickup_phone text;
alter table deliveries_99 add column if not exists dropoff_name text;
alter table deliveries_99 add column if not exists dropoff_phone text;
alter table deliveries_99 add column if not exists package_size text;      -- small | medium | large | xlarge
alter table deliveries_99 add column if not exists driver_phone text;
alter table deliveries_99 add column if not exists courier_lat numeric;
alter table deliveries_99 add column if not exists courier_lng numeric;
alter table deliveries_99 add column if not exists courier_updated_at timestamptz;
alter table deliveries_99 add column if not exists api_error text;
create index if not exists deliveries_99_api_order on deliveries_99(api_order_id);
create index if not exists deliveries_99_provider on deliveries_99(provider);

-- Endereço de coleta padrão (oficina) para pedir entregas pela API
alter table settings add column if not exists delivery_origin jsonb;
