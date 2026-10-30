CREATE TABLE financial_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('bank','cash','wallet','card')),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_accounts_name_unique ON financial_accounts (lower(trim(name)));

CREATE TABLE financial_account_movements (
  id SERIAL PRIMARY KEY,
  from_account_id INTEGER REFERENCES financial_accounts(id),
  to_account_id INTEGER REFERENCES financial_accounts(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  movement_date DATE NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  idempotency_key TEXT UNIQUE,
  reversal_of_id INTEGER UNIQUE REFERENCES financial_account_movements(id),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
  CHECK (from_account_id IS DISTINCT FROM to_account_id)
);
CREATE INDEX account_movements_from ON financial_account_movements(from_account_id, movement_date, id);
CREATE INDEX account_movements_to ON financial_account_movements(to_account_id, movement_date, id);

ALTER TABLE payments ADD COLUMN financial_account_id INTEGER REFERENCES financial_accounts(id);
ALTER TABLE payments ADD COLUMN card_surcharge_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (card_surcharge_amount >= 0);
ALTER TABLE financial_entry_payments ADD COLUMN financial_account_id INTEGER REFERENCES financial_accounts(id);
ALTER TABLE financial_entry_payments ADD COLUMN fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE financial_entry_payments ADD COLUMN card_surcharge_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE financial_entry_payments ADD COLUMN card_fee_snapshot JSONB;
ALTER TABLE financial_entries ADD COLUMN financial_account_id INTEGER REFERENCES financial_accounts(id);
ALTER TABLE card_fee_tables ADD COLUMN fee_policy TEXT NOT NULL DEFAULT 'studio' CHECK (fee_policy IN ('studio','customer'));
ALTER TABLE card_fee_tables ADD COLUMN source_details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE FUNCTION financial_account_post_delta(account_id INTEGER, delta NUMERIC, description TEXT,
  movement_date DATE, source_type TEXT, source_id INTEGER, actor INTEGER) RETURNS void AS $$
BEGIN
  IF account_id IS NULL OR delta = 0 THEN RETURN; END IF;
  INSERT INTO financial_account_movements
    (from_account_id,to_account_id,amount,movement_date,description,source_type,source_id,created_by_user_id)
  VALUES (CASE WHEN delta<0 THEN account_id END, CASE WHEN delta>0 THEN account_id END,
    abs(delta),movement_date,description,source_type,source_id,actor);
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;

-- Os saldos seguem as origens reais, inclusive alterações/estornos feitos fora
-- da tela financeira. Uma atualização repetida não gera movimento duplicado.
CREATE FUNCTION financial_account_source_changed() RETURNS trigger AS $$
DECLARE
  old_amount NUMERIC := 0; new_amount NUMERIC := 0;
  old_account INTEGER; new_account INTEGER; item_id INTEGER;
  movement_day DATE := CURRENT_DATE; actor INTEGER; label TEXT; entry_kind TEXT;
BEGIN
  IF TG_TABLE_NAME='payments' THEN
    IF TG_OP<>'INSERT' THEN
      old_account:=OLD.financial_account_id;
      old_amount:=CASE WHEN OLD.status IN ('pago','confirmado') THEN OLD.amount+COALESCE(OLD.card_surcharge_amount,0)-COALESCE(OLD.fee_amount,0)
        WHEN OLD.status IN ('refunded','estornado') THEN -COALESCE(OLD.fee_amount,0) ELSE 0 END;
      IF OLD.financial_entry_id IS NOT NULL THEN old_amount:=0; END IF;
    END IF;
    IF TG_OP<>'DELETE' THEN
      new_account:=NEW.financial_account_id;
      new_amount:=CASE WHEN NEW.status IN ('pago','confirmado') THEN NEW.amount+COALESCE(NEW.card_surcharge_amount,0)-COALESCE(NEW.fee_amount,0)
        WHEN NEW.status IN ('refunded','estornado') THEN -COALESCE(NEW.fee_amount,0) ELSE 0 END;
      IF NEW.financial_entry_id IS NOT NULL THEN new_amount:=0; END IF;
      item_id:=NEW.id; actor:=NEW.created_by_user_id;
      movement_day:=COALESCE(NULLIF(substring(NEW.paid_at,1,10),'')::date,CURRENT_DATE);
    ELSE item_id:=OLD.id; END IF;
    label:='Recebimento #'||item_id;
  ELSIF TG_TABLE_NAME='financial_entry_payments' THEN
    IF TG_OP<>'INSERT' THEN
      SELECT entry_type INTO entry_kind FROM financial_entries WHERE id=OLD.entry_id;
      old_account:=OLD.financial_account_id;
      old_amount:=CASE WHEN entry_kind IN ('income','receivable') THEN OLD.amount+OLD.card_surcharge_amount-OLD.fee_amount ELSE -OLD.amount END;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT entry_type INTO entry_kind FROM financial_entries WHERE id=NEW.entry_id;
      new_account:=NEW.financial_account_id;
      new_amount:=CASE WHEN entry_kind IN ('income','receivable') THEN NEW.amount+NEW.card_surcharge_amount-NEW.fee_amount ELSE -NEW.amount END;
      item_id:=NEW.id; actor:=NEW.user_id;
      movement_day:=COALESCE(NULLIF(substring(NEW.paid_at,1,10),'')::date,CURRENT_DATE);
    ELSE item_id:=OLD.id; END IF;
    label:='Baixa financeira #'||item_id;
  ELSE
    -- Receitas manuais não possuem uma linha em payments. As demais origens
    -- usam payments ou financial_entry_payments, evitando espelhos em dobro.
    IF TG_OP<>'INSERT' THEN
      old_account:=OLD.financial_account_id;
      IF OLD.entry_type IN ('income','receivable') AND COALESCE(OLD.source_type,'manual_entry')='manual_entry'
        AND OLD.status NOT IN ('canceled','refunded') AND COALESCE(OLD.lifecycle_status,'active')='active'
      THEN old_amount:=OLD.paid_amount; END IF;
    END IF;
    IF TG_OP<>'DELETE' THEN
      new_account:=NEW.financial_account_id; item_id:=NEW.id; actor:=NEW.responsible_user_id;
      IF NEW.entry_type IN ('income','receivable') AND COALESCE(NEW.source_type,'manual_entry')='manual_entry'
        AND NEW.status NOT IN ('canceled','refunded') AND COALESCE(NEW.lifecycle_status,'active')='active'
      THEN new_amount:=NEW.paid_amount; END IF;
      movement_day:=COALESCE(NULLIF(substring(NEW.paid_at,1,10),'')::date,CURRENT_DATE);
    ELSE item_id:=OLD.id; END IF;
    label:='Receita manual #'||item_id;
  END IF;
  IF old_account IS NOT DISTINCT FROM new_account THEN
    PERFORM financial_account_post_delta(new_account,new_amount-old_amount,label,movement_day,TG_TABLE_NAME,item_id,actor);
  ELSE
    PERFORM financial_account_post_delta(old_account,-old_amount,'Reversão: '||label,movement_day,TG_TABLE_NAME,item_id,actor);
    PERFORM financial_account_post_delta(new_account,new_amount,label,movement_day,TG_TABLE_NAME,item_id,actor);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path FROM CURRENT;
CREATE TRIGGER payments_account_movement AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION financial_account_source_changed();
CREATE TRIGGER payable_account_movement AFTER INSERT OR UPDATE OR DELETE ON financial_entry_payments
  FOR EACH ROW EXECUTE FUNCTION financial_account_source_changed();

CREATE FUNCTION protect_account_history() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Movimentações de contas são imutáveis. Registre um estorno.'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_account_movements BEFORE UPDATE OR DELETE ON financial_account_movements
  FOR EACH ROW EXECUTE FUNCTION protect_account_history();
