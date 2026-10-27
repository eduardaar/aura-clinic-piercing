-- Apresentação pública do serviço no agendamento online.
-- `description` continua sendo a descrição completa já cadastrada; nada é
-- reescrito. O cartão usa `short_description` e, enquanto ela estiver vazia,
-- um resumo calculado na tela a partir da descrição existente.
ALTER TABLE services ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN IF NOT EXISTS image_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_evaluation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS requires_acknowledgement BOOLEAN NOT NULL DEFAULT false;
-- Seções ordenadas por serviço: [{ key, title, body }]. As chaves
-- `pre_service` e `aftercare` só marcam a posição; o texto continua nas
-- colunas `pre_service_notes` e `aftercare_instructions`.
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_info_sections JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_public_info_sections_array;
ALTER TABLE services ADD CONSTRAINT services_public_info_sections_array CHECK (jsonb_typeof(public_info_sections) = 'array');

-- Ciência registrada pelo cliente no agendamento online, com o hash do
-- conteúdo exibido para cada serviço no momento do envio.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS public_acknowledgements JSONB NOT NULL DEFAULT '[]'::jsonb;
