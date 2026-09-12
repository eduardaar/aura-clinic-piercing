-- Termos digitais como ferramenta vinculada ao cliente e ao atendimento:
--   * modelos de termo geridos pela clínica (consentimento, autorização,
--     termo específico de procedimento, outros documentos de aceite);
--   * solicitações com link individual e seguro, preenchidas pelo próprio
--     cliente no estúdio (celular/tablet) ou à distância (WhatsApp);
--   * rastreio do aceite (modelo, canal, IP, navegador, hash do conteúdo);
--   * termo concluído é imutável: gatilho recusa alteração do que foi assinado.

CREATE TABLE IF NOT EXISTS term_templates (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'consent' CHECK (kind IN ('consent', 'authorization', 'procedure', 'other')),
  description TEXT,
  content TEXT NOT NULL,
  requires_health_history BOOLEAN NOT NULL DEFAULT true,
  requires_guardian_for_minors BOOLEAN NOT NULL DEFAULT true,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_term_templates_active
  ON term_templates(is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS term_requests (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT REFERENCES term_templates(id) ON DELETE SET NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  -- Só o hash do token vai ao banco; o link completo aparece uma única vez,
  -- na criação, como um link de redefinição de senha.
  token_hash TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'remote' CHECK (channel IN ('in_studio', 'remote')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  digital_term_id INTEGER REFERENCES digital_terms(id) ON DELETE SET NULL,
  message TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_term_requests_client
  ON term_requests(client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_term_requests_status
  ON term_requests(status, expires_at);

ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES term_templates(id) ON DELETE SET NULL;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS term_request_id BIGINT REFERENCES term_requests(id) ON DELETE SET NULL;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'in_studio';
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS template_name TEXT;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS template_content TEXT;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS accepted_ip TEXT;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS accepted_user_agent TEXT;
ALTER TABLE digital_terms ADD COLUMN IF NOT EXISTS content_hash TEXT;

DO $$ BEGIN
  ALTER TABLE digital_terms ADD CONSTRAINT digital_terms_channel_check CHECK (channel IN ('in_studio', 'remote', 'staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Um termo concluído nunca muda: o que foi assinado, o texto aceito e a data
-- ficam congelados. `pdf_url`, vínculos e dados de contato do cadastro podem
-- ser complementados depois (ex.: anonimização por LGPD), o aceite em si não.
CREATE OR REPLACE FUNCTION digital_terms_block_changes() RETURNS trigger AS $$
BEGIN
  IF NEW.signature_data_url IS DISTINCT FROM OLD.signature_data_url
     OR NEW.guardian_signature_data_url IS DISTINCT FROM OLD.guardian_signature_data_url
     OR NEW.form_data IS DISTINCT FROM OLD.form_data
     OR NEW.orientations_confirmed IS DISTINCT FROM OLD.orientations_confirmed
     OR NEW.health_declaration IS DISTINCT FROM OLD.health_declaration
     OR NEW.template_content IS DISTINCT FROM OLD.template_content
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'Termo digital concluído não pode ser alterado (id %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_digital_terms_immutable ON digital_terms;
CREATE TRIGGER trg_digital_terms_immutable
  BEFORE UPDATE ON digital_terms
  FOR EACH ROW EXECUTE FUNCTION digital_terms_block_changes();

-- Modelos iniciais, só quando a clínica ainda não tem nenhum. Editáveis no
-- painel; servem para a clínica começar a enviar termos no mesmo dia.
INSERT INTO term_templates (name, kind, description, content, requires_health_history, requires_guardian_for_minors, sort_order)
SELECT
  'Termo de consentimento para procedimento de piercing',
  'consent',
  'Consentimento livre e esclarecido, com histórico de saúde e orientações de cuidado.',
  E'Declaro que fui informado(a) sobre o procedimento de perfuração corporal (body piercing) que será realizado, incluindo a região, a joia utilizada e os cuidados necessários durante a cicatrização.\n\nDeclaro que respondi com veracidade ao histórico de saúde apresentado e que informei ao(à) profissional qualquer condição, alergia ou medicamento em uso que possa interferir no procedimento.\n\nEstou ciente de que:\n1. Os materiais perfurantes são estéreis, de uso único e descartados após o atendimento, e as joias são higienizadas e esterilizadas conforme as normas sanitárias.\n2. Podem ocorrer intercorrências como dor, sangramento, inchaço, vermelhidão, formação de queloide, infecção ou rejeição, sobretudo quando as orientações de cuidado não são seguidas.\n3. O tempo de cicatrização varia conforme a região e o organismo, e o retorno para acompanhamento é recomendado.\n4. Devo seguir as orientações de higienização e cuidados recebidas e procurar o estúdio ou um serviço de saúde em caso de sinais de infecção.\n\nAutorizo a realização do procedimento e o registro fotográfico da região perfurada para fins de prontuário.',
  true,
  true,
  0
WHERE NOT EXISTS (SELECT 1 FROM term_templates);

INSERT INTO term_templates (name, kind, description, content, requires_health_history, requires_guardian_for_minors, sort_order)
SELECT
  'Autorização do responsável legal',
  'authorization',
  'Autorização para atendimento de menor de idade, assinada pelo responsável.',
  E'Eu, na condição de responsável legal, autorizo a realização do procedimento de perfuração corporal (body piercing) no(a) menor identificado(a) neste termo.\n\nDeclaro que acompanhei as informações prestadas sobre o procedimento, os riscos, as intercorrências possíveis e os cuidados de cicatrização, e que as informações de saúde fornecidas são verdadeiras.\n\nComprometo-me a acompanhar os cuidados de higienização e a procurar o estúdio ou um serviço de saúde em caso de sinais de infecção ou rejeição.',
  true,
  true,
  1
WHERE NOT EXISTS (SELECT 1 FROM term_templates WHERE kind = 'authorization');
