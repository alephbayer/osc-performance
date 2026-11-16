-- Mercado Livre: previsão de entrega original (a 1ª informada) e preservação da última previsão conhecida
alter table ml_purchase_items add column if not exists eta_first_at timestamptz;
update ml_purchase_items set eta_first_at = eta_at where eta_first_at is null and eta_at is not null;
create or replace function ml_keep_eta() returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.eta_at is null and OLD.eta_at is not null and coalesce(NEW.ship_status,'') <> 'delivered' then NEW.eta_at := OLD.eta_at; end if;
    if OLD.eta_first_at is not null then NEW.eta_first_at := OLD.eta_first_at; end if;
  end if;
  if NEW.eta_first_at is null and NEW.eta_at is not null then NEW.eta_first_at := NEW.eta_at; end if;
  return NEW;
end $$;
drop trigger if exists ml_keep_eta_trg on ml_purchase_items;
create trigger ml_keep_eta_trg before insert or update on ml_purchase_items for each row execute function ml_keep_eta();
