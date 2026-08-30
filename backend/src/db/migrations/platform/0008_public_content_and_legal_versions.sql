-- Conteúdo institucional global: versões legais, notícias e manual do produto.
CREATE TABLE IF NOT EXISTS platform.legal_document_versions (
  id BIGSERIAL PRIMARY KEY,
  document_key TEXT NOT NULL REFERENCES platform.legal_documents(document_key) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL,
  UNIQUE (document_key, version)
);

CREATE INDEX IF NOT EXISTS ix_legal_document_versions_document
  ON platform.legal_document_versions(document_key, version DESC);

INSERT INTO platform.legal_document_versions
  (document_key, version, title, content, published_at, published_by)
SELECT document_key, version, title, content, updated_at, updated_by
FROM platform.legal_documents
ON CONFLICT (document_key, version) DO NOTHING;

UPDATE platform.legal_documents
SET title = 'Termos de Uso da Plataforma Aura',
    content = $terms$
1. Objeto e aceitação

Estes Termos regulam o acesso e o uso da plataforma Aura Clinic por clínicas, estúdios, profissionais e integrantes autorizados de suas equipes. Ao criar uma conta, contratar um plano ou continuar usando o serviço, o contratante declara que leu e aceitou este documento e a Política de Privacidade vigentes.

2. Conta e acessos

O contratante deve fornecer informações verdadeiras, manter seus dados atualizados e proteger as credenciais de acesso. A conta administrativa responde pela criação de usuários, definição de permissões e atividades realizadas por sua equipe. Credenciais são pessoais e não devem ser compartilhadas.

3. Finalidade do serviço

A Aura disponibiliza recursos de gestão, como agenda, clientes, documentos digitais, estoque, vendas, financeiro, comunicações e relatórios, conforme o plano contratado. Funcionalidades podem evoluir para melhorar segurança, desempenho e adequação operacional, sem reduzir direitos já adquiridos durante o período pago.

4. Responsabilidades da clínica

A clínica é responsável pela legalidade, qualidade e exatidão dos dados que cadastra, pelas informações prestadas aos seus clientes e pelo cumprimento das normas profissionais, sanitárias, fiscais, consumeristas e de proteção de dados aplicáveis à sua atividade. A plataforma não substitui avaliação profissional, orientação jurídica, contábil ou clínica.

5. Dados pessoais e documentos clínicos

Em relação aos dados dos clientes da clínica, a clínica atua como controladora e define as finalidades do tratamento; a Aura atua como operadora nos limites necessários para prestar o serviço. A clínica deve possuir base legal, informar os titulares, limitar acessos e não registrar dados excessivos. Informações clínicas e de menores exigem cuidado reforçado e permissões adequadas.

6. Uso permitido

É proibido usar a plataforma para atividade ilícita, fraude, assédio, violação de propriedade intelectual, envio de conteúdo malicioso, tentativa de acesso indevido, engenharia reversa não autorizada ou operação que prejudique a disponibilidade e a segurança do serviço. A Aura poderá restringir acessos diante de risco relevante, preservando evidências e informando o contratante quando permitido.

7. Planos, cobrança e cancelamento

Preços, limites, período de teste e recursos de cada plano são informados antes da contratação. Cobranças recorrentes, vencimentos e condições de cancelamento seguem a oferta aceita. O não pagamento pode gerar período de tolerância e posterior suspensão, sem apagar imediatamente os dados. Valores já devidos e obrigações anteriores ao cancelamento permanecem exigíveis.

8. Disponibilidade, manutenção e suporte

A Aura adota esforços razoáveis para manter o serviço disponível e seguro. Manutenções programadas, falhas de fornecedores, internet, caso fortuito ou força maior podem causar indisponibilidade temporária. Incidentes relevantes serão tratados e comunicados conforme a legislação e a natureza do risco. O suporte é prestado pelos canais oficiais exibidos na plataforma.

9. Propriedade intelectual

O software, a marca, o desenho das interfaces e os materiais próprios da Aura permanecem protegidos. O contratante conserva a titularidade sobre seus dados e conteúdos e concede apenas a autorização técnica necessária para armazená-los, processá-los, copiá-los em backup e exibi-los durante a prestação do serviço.

10. Limitação e colaboração

Cada parte responde pelos danos diretos que causar por violação comprovada de suas obrigações. A Aura não responde por decisões profissionais da clínica, dados incorretos inseridos por usuários, integrações externas fora de seu controle ou lucros cessantes indiretos, ressalvadas as hipóteses em que a legislação não permita limitação. As partes devem cooperar para reduzir impactos e corrigir falhas.

11. Alterações e vigência

Uma nova versão destes Termos será identificada e publicada com data de atualização. Alterações relevantes serão comunicadas pelos canais disponíveis. Quando exigido, será solicitado novo aceite. O uso continuado após a vigência da nova versão representa concordância, sem prejuízo dos direitos previstos em lei.

12. Lei aplicável e contato

Aplica-se a legislação brasileira. Questões serão tratadas preferencialmente pelos canais oficiais de suporte, preservados os direitos do consumidor e o foro legalmente competente.
$terms$,
    version = 2,
    updated_at = now(),
    updated_by = NULL
WHERE document_key = 'terms_of_use' AND version = 1;

UPDATE platform.legal_documents
SET title = 'Política de Privacidade da Plataforma Aura',
    content = $privacy$
1. Escopo

Esta Política explica como a Aura trata dados pessoais de visitantes, responsáveis por clínicas, usuários da plataforma e pessoas que entram em contato com nossos canais. O tratamento realizado diretamente pela clínica com dados de seus clientes também depende das políticas e decisões da própria clínica.

2. Papéis no tratamento

A Aura atua como controladora dos dados necessários para cadastro, contratação, cobrança, segurança, suporte e relacionamento com seus próprios usuários. Quando processa dados dos clientes cadastrados por uma clínica para executar os recursos contratados, a clínica atua como controladora e a Aura como operadora, seguindo instruções documentadas e a legislação aplicável.

3. Dados tratados

Podemos tratar dados cadastrais e profissionais, informações de contato, dados de autenticação, registros de acesso e auditoria, informações de plano e cobrança, mensagens de suporte e dados técnicos do dispositivo e da conexão. Dados clínicos, documentos e imagens inseridos pela clínica são tratados apenas para disponibilizar os recursos solicitados e exigem acesso restrito.

4. Finalidades e bases legais

Usamos os dados para criar e proteger contas, prestar e melhorar o serviço, processar pagamentos, atender solicitações, prevenir fraude, manter auditoria, cumprir obrigações legais e exercer direitos. Conforme o caso, o tratamento se apoia na execução de contrato, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo interesse avaliado ou consentimento.

5. Compartilhamento e fornecedores

Dados podem ser compartilhados, no mínimo necessário, com fornecedores de infraestrutura, armazenamento, comunicação, monitoramento, suporte e pagamento. Esses operadores são contratados com deveres de segurança e confidencialidade. Também poderemos compartilhar dados por obrigação legal, ordem de autoridade competente ou para proteger direitos e segurança.

6. Transferências e armazenamento

Alguns fornecedores podem processar dados fora do Brasil. Nesses casos, adotamos mecanismos compatíveis com a legislação brasileira e avaliamos medidas contratuais e técnicas apropriadas. A localização e os fornecedores podem mudar conforme a evolução da infraestrutura.

7. Retenção e eliminação

Os dados são mantidos pelo tempo necessário à prestação do serviço, ao cumprimento de obrigações legais, à segurança, à auditoria e ao exercício de direitos. Após o encerramento, dados podem permanecer por prazos legais ou em backups protegidos até o ciclo seguro de eliminação. A clínica define a retenção dos dados de seus clientes, respeitando a lei e os recursos contratados.

8. Segurança

Adotamos controles técnicos e organizacionais proporcionais ao risco, incluindo separação de ambientes de clínicas, autenticação, permissões, registros de auditoria, proteção de credenciais e rotinas de backup. Nenhum sistema é totalmente imune; incidentes confirmados serão avaliados, contidos e comunicados quando exigido.

9. Direitos dos titulares

O titular pode solicitar confirmação do tratamento, acesso, correção, anonimização, portabilidade quando aplicável, informação sobre compartilhamentos, revisão de decisões automatizadas e eliminação ou oposição nos casos previstos em lei. Solicitações relativas a dados controlados por uma clínica devem ser dirigidas primeiro à própria clínica; a Aura prestará o apoio técnico cabível.

10. Cookies, logs e comunicações

Podemos usar armazenamento local, cookies essenciais e registros técnicos para manter sessão, preferências, segurança e funcionamento. Comunicações operacionais são enviadas para executar o serviço. Comunicações de marketing, quando usadas, respeitam a escolha do destinatário e oferecem forma de cancelamento.

11. Crianças, adolescentes e dados sensíveis

A plataforma é destinada ao uso profissional por adultos. A clínica é responsável por observar regras de consentimento, representação legal e melhor interesse ao registrar dados de menores, além de limitar o tratamento de dados sensíveis ao estritamente necessário.

12. Atualizações e contato

Esta Política pode ser atualizada para refletir mudanças legais, técnicas ou operacionais. A versão e a data vigentes ficam publicadas nesta página. Dúvidas e solicitações podem ser enviadas pelos canais oficiais de suporte disponíveis na plataforma.
$privacy$,
    version = 2,
    updated_at = now(),
    updated_by = NULL
WHERE document_key = 'privacy_policy' AND version = 1;

INSERT INTO platform.legal_document_versions
  (document_key, version, title, content, published_at, published_by)
SELECT document_key, version, title, content, updated_at, updated_by
FROM platform.legal_documents
ON CONFLICT (document_key, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform.content_articles (
  id BIGSERIAL PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('news', 'manual')),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES platform.platform_users(id) ON DELETE SET NULL,
  UNIQUE (content_type, slug)
);

CREATE INDEX IF NOT EXISTS ix_content_articles_public
  ON platform.content_articles(content_type, status, sort_order, published_at DESC);

INSERT INTO platform.content_articles
  (content_type, slug, title, summary, content, category, status, sort_order, published_at)
VALUES
  ('news', 'bem-vindo-as-novidades-da-aura', 'Novidades da Aura', 'Acompanhe melhorias, novos recursos e orientações para aproveitar melhor a plataforma.', E'Este espaço reúne as mudanças mais importantes da Aura Clinic. Cada publicação explica o que mudou, para quem o recurso é útil e se alguma configuração é necessária.\n\nAs novidades aparecem também no menu Ajuda dentro do sistema.', 'Produto', 'published', 10, now()),
  ('manual', 'primeiros-passos', 'Primeiros passos', 'Configure a clínica e deixe a operação pronta para o primeiro atendimento.', E'1. Confira os dados da clínica e os usuários em Configurações.\n\n2. Cadastre os procedimentos, profissionais e horários na Agenda.\n\n3. Cadastre produtos e materiais que precisam de controle de estoque.\n\n4. Crie um cliente de teste e faça um agendamento completo antes de operar com dados reais.\n\n5. Revise permissões, integrações e modelos de comunicação.', 'Começar', 'published', 10, now()),
  ('manual', 'agenda-e-atendimentos', 'Agenda e atendimentos', 'Organize agendamentos, execução e conclusão dos procedimentos.', E'Use a Agenda como ponto de partida do atendimento. Cadastre o procedimento reutilizável nas configurações e escolha cliente, profissional, data e horário ao agendar.\n\nDurante a execução, registre somente os controles adotados pela clínica. Ao concluir, confira valores e pagamentos. Cancelamentos e reagendamentos devem ser feitos pelas ações do próprio agendamento para preservar o histórico.', 'Atendimento', 'published', 20, now()),
  ('manual', 'clientes-termos-e-pos-atendimento', 'Clientes, termos e pós-atendimento', 'Consulte os dados e o histórico completo no perfil do cliente.', E'Cadastre primeiro os dados básicos do cliente. No perfil, use as abas para consultar atendimentos, termos digitais e pós-atendimentos.\n\nDados clínicos devem permanecer nas áreas protegidas de anamnese e prontuário. Use a busca por nome, CPF, telefone ou e-mail para evitar cadastros duplicados.', 'Atendimento', 'published', 30, now()),
  ('manual', 'vendas-compras-e-financeiro', 'Vendas, compras e financeiro', 'Entenda quando usar cada fluxo e preserve a origem dos lançamentos.', E'Use Vendas para saída avulsa de produtos para clientes. Use Compras para entradas vindas de fornecedores e atualização do estoque. Procedimentos são concluídos pela Agenda.\n\nQuando o fluxo gera pagamento futuro, o sistema cria a conta correspondente. Despesas sem entrada de estoque devem ser lançadas diretamente em Contas a pagar.', 'Gestão', 'published', 40, now()),
  ('manual', 'seguranca-acessos-e-suporte', 'Segurança, acessos e suporte', 'Configure permissões claras e saiba onde pedir ajuda.', E'Crie um usuário para cada pessoa e conceda apenas as permissões necessárias. Não compartilhe senhas. Revise a Auditoria para acompanhar alterações importantes.\n\nEm caso de dúvida ou erro, abra Suporte pelo menu Ajuda e informe o fluxo realizado, o resultado esperado e o que apareceu na tela.', 'Administração', 'published', 50, now())
ON CONFLICT (content_type, slug) DO NOTHING;
