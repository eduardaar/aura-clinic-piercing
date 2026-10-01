-- Comissões por profissional.
--
-- Regras: por profissional, um padrão para serviços, regras específicas por
-- serviço e um padrão para produtos/joias aplicados no atendimento. Cada regra
-- é percentual (0–100) ou valor fixo. Regras não são apagadas pela interface:
-- desativar preserva o histórico (as alterações também vão para a auditoria).
CREATE TABLE IF NOT EXISTS professional_commission_rules (
  id SERIAL PRIMARY KEY,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('servico_padrao', 'servico', 'produto_padrao')),
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('percentual', 'valor_fixo')),
  rate_value NUMERIC(12,2) NOT NULL CHECK (rate_value >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT professional_commission_rules_scope_service_check
    CHECK ((scope = 'servico') = (service_id IS NOT NULL)),
  CONSTRAINT professional_commission_rules_percent_range_check
    CHECK (rate_type <> 'percentual' OR rate_value <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_professional_commission_rules_scope
  ON professional_commission_rules(professional_id, scope, COALESCE(service_id, 0));

-- Lançamento de comissão: imutável. Gravado na finalização do atendimento com
-- a base completa (bruto, desconto e ajuste rateados, líquido) e a regra
-- aplicada. Recalcular = estornar o lançamento ativo e gravar outro, nunca
-- editar valores.
CREATE TABLE IF NOT EXISTS commission_entries (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  service_execution_id INTEGER REFERENCES service_executions(id) ON DELETE SET NULL,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('servico', 'produto')),
  appointment_item_id INTEGER,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES jewelry_inventory(id) ON DELETE SET NULL,
  item_description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  base_amount NUMERIC(12,2) NOT NULL CHECK (base_amount >= 0),
  rule_id INTEGER REFERENCES professional_commission_rules(id) ON DELETE SET NULL,
  rule_scope TEXT NOT NULL CHECK (rule_scope IN ('servico_padrao', 'servico', 'produto_padrao')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('percentual', 'valor_fixo')),
  rate_value NUMERIC(12,2) NOT NULL CHECK (rate_value >= 0),
  commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
  reference_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'estornada')),
  calculated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  CONSTRAINT commission_entries_reversal_check
    CHECK (status <> 'estornada' OR reversed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_commission_entries_professional_date
  ON commission_entries(professional_id, reference_date, id);
CREATE INDEX IF NOT EXISTS idx_commission_entries_appointment
  ON commission_entries(appointment_id, status);
CREATE INDEX IF NOT EXISTS idx_commission_entries_status_date
  ON commission_entries(status, reference_date);

-- O percentual único que já existia em professionals.commission_percentage
-- (sem tela para configurá-lo) vira a regra padrão de serviços do profissional.
INSERT INTO professional_commission_rules (professional_id, scope, service_id, rate_type, rate_value, notes)
SELECT id, 'servico_padrao', NULL, 'percentual', commission_percentage,
       'Migrado do percentual de comissão do cadastro do profissional'
  FROM professionals
 WHERE COALESCE(commission_percentage, 0) > 0
ON CONFLICT DO NOTHING;
