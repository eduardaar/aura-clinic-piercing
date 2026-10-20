-- Correct only the original studio copy; preserve other edited sections.
UPDATE platform.landing_sections SET content=content::jsonb || jsonb_build_object(
  'title','Sobre a Aura Clinic ERP',
  'body',E'A Aura Clinic ERP é uma plataforma de gestão para estúdios de piercing, criada a partir das necessidades de quem atende e administra o próprio negócio.\n\nAgenda, clientes, catálogo, compras, materiais e financeiro ficam conectados para facilitar a rotina e acompanhar cada operação.\n\nIdealizada por Eduarda Santos, a plataforma atende profissionais e estabelecimentos com identidades próprias. A Aura Clinic é o estúdio da idealizadora; o ERP é o produto de gestão oferecido a outros estúdios.',
  'signature','Aura Clinic ERP — gestão para a rotina do seu estúdio.')
WHERE section_key='about' AND content::jsonb->>'title'='Sobre a Aura Clinic';
