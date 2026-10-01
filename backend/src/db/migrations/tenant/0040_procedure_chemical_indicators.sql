-- Indicador químico de esterilização registrado POR PROCEDIMENTO realizado.
--
-- O registro pertence ao atendimento (appointment_id) e ao procedimento
-- específico dentro dele. Como os itens do agendamento são regravados quando o
-- agendamento é editado, o procedimento fica também fotografado aqui
-- (procedure_name, região, joia), e appointment_item_id é só referência
-- informativa. service_execution_id é preenchido quando o atendimento é
-- finalizado (ou na hora, se a execução já existir).
CREATE TABLE IF NOT EXISTS procedure_chemical_indicators (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  service_execution_id INTEGER REFERENCES service_executions(id) ON DELETE SET NULL,
  appointment_item_id INTEGER,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  procedure_id INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  procedure_name TEXT NOT NULL,
  body_region TEXT,
  jewelry_id INTEGER REFERENCES jewelry_inventory(id) ON DELETE SET NULL,
  jewelry_name TEXT,
  indicator_type TEXT,
  indicator_brand TEXT,
  indicator_lot TEXT,
  indicator_date TEXT,
  identification TEXT,
  result TEXT NOT NULL DEFAULT 'nao_informado' CHECK (result IN ('aprovado', 'reprovado', 'nao_informado')),
  photo_filename TEXT REFERENCES private_files(filename) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'anulado')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  CONSTRAINT procedure_chemical_indicators_date_check
    CHECK (indicator_date IS NULL OR indicator_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT procedure_chemical_indicators_content_check
    CHECK (coalesce(nullif(btrim(indicator_type), ''), nullif(btrim(indicator_lot), ''),
                    nullif(btrim(identification), ''), photo_filename) IS NOT NULL),
  CONSTRAINT procedure_chemical_indicators_void_check
    CHECK (status <> 'anulado' OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0))
);

CREATE INDEX IF NOT EXISTS idx_procedure_chemical_indicators_appointment
  ON procedure_chemical_indicators(appointment_id, id);
CREATE INDEX IF NOT EXISTS idx_procedure_chemical_indicators_client
  ON procedure_chemical_indicators(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_procedure_chemical_indicators_execution
  ON procedure_chemical_indicators(service_execution_id);
