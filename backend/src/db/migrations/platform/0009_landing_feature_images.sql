-- Atualiza os recursos da página pública pelas respectivas funções.
-- Preserva ordem, campos adicionais e outros blocos personalizados.
UPDATE platform.landing_sections
SET content = jsonb_set(content, '{items}', (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'title' IN ('Agendamento online', 'Agendamento online') THEN item || '{"title":"Agendamento online","text":"Seus clientes marcam horário sozinhos por um link só seu.","image":"/assets/landing/features/agendamento-online.jpg","image_alt":"Cliente consultando o agendamento online pelo celular","image_width":1536,"image_height":1024}'::jsonb
      WHEN item->>'title' IN ('Catálogo de joias', 'Controle de estoque') THEN item || '{"title":"Controle de estoque","text":"Joias, materiais e alertas de estoque baixo organizados no mesmo lugar.","image":"/assets/landing/features/controle-de-estoque.jpg","image_alt":"Profissional conferindo o estoque de joias pelo tablet","image_width":1600,"image_height":900}'::jsonb
      WHEN item->>'title' IN ('Ficha digital', 'Ficha digital') THEN item || '{"title":"Ficha digital","text":"Anamnese e termo de consentimento assinados sem papel.","image":"/assets/landing/features/ficha-digital.jpg","image_alt":"Profissional preenchendo a ficha digital com a cliente","image_width":1600,"image_height":900}'::jsonb
      WHEN item->>'title' IN ('Financeiro e estoque', 'Controle financeiro') THEN item || '{"title":"Controle financeiro","text":"Acompanhe caixa, vendas e despesas do seu estúdio.","image":"/assets/landing/features/controle-financeiro.jpg","image_alt":"Profissional acompanhando o financeiro do estúdio no computador","image_width":1600,"image_height":900}'::jsonb
      ELSE item
    END ORDER BY position
  )
  FROM jsonb_array_elements(content->'items') WITH ORDINALITY AS entries(item, position)
)), updated_at = now()
WHERE section_key = 'features'
  AND jsonb_typeof(content->'items') = 'array'
  AND jsonb_array_length(content->'items') > 0;
