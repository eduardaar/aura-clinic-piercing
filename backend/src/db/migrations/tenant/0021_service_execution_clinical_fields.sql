-- Dados clínicos pertencem à execução do atendimento, nunca ao catálogo.
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS clinical_notes TEXT;
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS occurrences TEXT;
ALTER TABLE service_executions ADD COLUMN IF NOT EXISTS aftercare_notes TEXT;
