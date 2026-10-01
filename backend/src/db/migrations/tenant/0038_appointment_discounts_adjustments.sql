-- Desconto manual e ajustes de valor do atendimento.
--
-- `appointments.discount_value` continua sendo o desconto TOTAL do atendimento
-- (cupom + desconto manual) e segue alimentando o snapshot financeiro, o
-- financeiro e os relatórios. A parcela manual fica separada para que se saiba
-- quem a lançou, quando e por quê.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS manual_discount_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS manual_discount_reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS manual_discount_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS manual_discount_updated_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_manual_discount_nonnegative_check
    CHECK (manual_discount_value >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Soma assinada dos ajustes ATIVOS (acréscimos menos abatimentos). É cache do
-- que está em appointment_value_adjustments, recalculado na mesma transação de
-- cada inclusão ou anulação.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS adjustment_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Ajuste de valor é separado do desconto: tem tipo, motivo obrigatório, autor
-- e data. Nunca é apagado nem editado; corrigir significa anular com motivo,
-- preservando o histórico discriminado de cada ajuste.
CREATE TABLE IF NOT EXISTS appointment_value_adjustments (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('acrescimo', 'abatimento')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'anulado')),
  -- Valor líquido do atendimento imediatamente antes e depois deste ajuste:
  -- o histórico mostra "de quanto para quanto" sem depender de recálculo.
  net_before NUMERIC(12,2) NOT NULL,
  net_after NUMERIC(12,2) NOT NULL,
  -- Preenchido quando o atendimento é finalizado (ou na hora, se já estiver).
  service_execution_id INTEGER REFERENCES service_executions(id) ON DELETE SET NULL,
  -- Chave enviada pela tela a cada clique em "Adicionar": duplo clique ou
  -- repetição por falha de rede não viram dois ajustes.
  idempotency_key TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  CONSTRAINT appointment_value_adjustments_void_check
    CHECK (status <> 'anulado' OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0))
);

CREATE INDEX IF NOT EXISTS idx_appointment_value_adjustments_appointment
  ON appointment_value_adjustments(appointment_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointment_value_adjustments_idempotency
  ON appointment_value_adjustments(appointment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A execução do atendimento guarda a fotografia financeira do fechamento.
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS adjustment_total NUMERIC(12,2) NOT NULL DEFAULT 0;
