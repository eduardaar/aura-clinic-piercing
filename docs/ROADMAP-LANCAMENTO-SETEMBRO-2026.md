# Roadmap de lançamento — setembro de 2026

> Documento vivo para conduzir o lançamento da Aura Clinic durante setembro de
> 2026. O foco é validar regras de negócio com uso real, corrigir bloqueios e
> evitar ampliar o produto antes de o fluxo principal estar confiável.

## Objetivo do mês

Colocar a Aura Clinic em produção para as primeiras clínicas, com cadastro,
agenda, clientes, atendimento, estoque, vendas, financeiro e cobrança da
assinatura funcionando ponta a ponta.

## Regra de prioridade

1. Bloqueia cadastro, venda, atendimento ou recebimento: corrigir imediatamente.
2. Pode gerar perda financeira, estoque incorreto ou vazamento de dados: não lançar sem corrigir.
3. Prejudica muito a operação diária: corrigir antes da entrada dos primeiros clientes.
4. Melhoria visual, conveniência ou automação não essencial: registrar para depois do lançamento.

## Estratégia técnica de execução

O plano detalhado de arquitetura, dependências, agentes, automações, testes e
ondas de entrega está em
[ESTUDO-TECNICO-EXECUCAO-ROADMAP-LANCAMENTO-SETEMBRO-2026.md](./ESTUDO-TECNICO-EXECUCAO-ROADMAP-LANCAMENTO-SETEMBRO-2026.md).

Para acelerar o lançamento, fica aprovado trabalhar com base descartável até o
primeiro dado real de produção: não criar dual-write, backfill ou compatibilidade
prolongada para dados antigos. Cada novo fluxo substitui e remove o fluxo anterior
no mesmo lote. Isso não reduz as validações obrigatórias de isolamento, permissão,
estoque, financeiro, pagamento, arquivos privados e auditoria.

### Aceleração e limpeza antecipada incorporadas ao lançamento

- [x] Criar uma branch de integração do lançamento e worktrees separados por fatia vertical, com um integrador e até três agentes executores.
- [x] Reservar ao integrador os hotspots compartilhados: migrations e schema, registro de rotas/menu, permissões, entrypoint, CSS global, pacotes e lockfiles.
- [x] Fixar Node `20.19+` como mínimo comum para desenvolvimento, CI e produção.
- [x] Criar comandos de verificação rápida por arquivos alterados e permitir executar vários testes backend relacionados com uma única subida da API.
- [x] Criar um registro único de páginas do frontend, reunindo rota, título, grupo, ícone, permissão, recurso do plano, componente e aliases temporários.
- [x] Manter o catálogo de permissões e perfis como fonte oficial no backend, entregando ao frontend grupos, rótulos, descrições e impacto.
- [x] Criar registros configuráveis para relatórios e seus filtros/colunas/exportadores, evitando novas telas e implementações paralelas.
- [ ] Usar codemod AST somente para alterações mecânicas repetitivas, como imports, nomes de componentes, props e IDs de página; nunca para regras financeiras, clínicas, fiscais, de estoque ou permissão.
- [ ] Remover no mesmo lote as telas, rotas, serviços, aliases e estruturas substituídas de Serviços/Procedimentos, Materiais/Produtos, atendimento em Vendas, relatórios e auditoria.
- [x] Remover candidatos já comprovados sem consumidor: `react-router-dom`, `@aws-sdk/s3-request-presigner`, `legacyLocalDateValue`, o `DataTable` antigo e `admin_audit_logs`; confirmar novamente com busca estática imediatamente antes da remoção.
- [x] Implementar a busca global do cabeçalho ou retirá-la temporariamente; não lançar um controle que apenas aparenta pesquisar.
- [ ] Durante o desenvolvimento, criar migrations novas por fatia; no candidato a release, gerar uma baseline completa com `pg_dump --schema-only`, remover o bootstrap SQL duplicado, zerar a base e comprovar a criação de plataforma e clínica somente pelas migrations.
- [x] Executar Biome e testes direcionados durante cada tarefa; reservar build e suítes completas para a integração de cada lote e para o candidato final.

## Semana 1 — 1 a 6 de setembro

### Conta nova e configuração inicial

- [ ] Criar uma clínica nova pelo fluxo público.
- [ ] Validar login, sessão e recuperação de acesso.
- [ ] Configurar identidade, endereço e dados de cobrança.
- [ ] Cadastrar usuários e validar permissões de cada perfil.
- [ ] Confirmar limites e recursos de cada plano.
- [ ] Revisar clareza do onboarding e mensagens de erro.

### Cadastros essenciais

- [ ] Cadastrar clientes.
- [ ] Cadastrar profissionais e disponibilidade.
- [ ] Cadastrar serviços, procedimentos e valores.
- [ ] Cadastrar produtos, variações e materiais de consumo.
- [ ] Registrar fornecedores, categorias e centros de custo.

**Saída da semana:** uma clínica vazia consegue ficar pronta para operar sem intervenção técnica.

## Semana 2 — 7 a 13 de setembro

### Agenda e atendimento

- [ ] Criar agendamento interno.
- [ ] Criar agendamento pelo site público.
- [ ] Validar conflito de horário, bloqueios e disponibilidade.
- [ ] Confirmar, reagendar e cancelar atendimentos.
- [ ] Validar sinal, crédito do cliente e reembolso manual.
- [ ] Concluir atendimento com serviço, joia e materiais.
- [ ] Validar prontuário, termo digital e pós-atendimento.

### Comunicação operacional

- [ ] Configurar SMTP real e enviar mensagem de teste.
- [ ] Definir quais avisos transacionais serão enviados por e-mail.
- [ ] Validar solicitação, confirmação, reagendamento e cancelamento.
- [ ] Validar lembretes e pós-atendimento.
- [ ] Manter campanhas promocionais desativadas até existir consentimento e descadastro.

**Saída da semana:** o ciclo completo do agendamento funciona sem inconsistência operacional ou financeira.

## Semana 3 — 14 a 20 de setembro

### Estoque, compras e vendas

- [ ] Registrar compra e entrada de estoque.
- [ ] Conferir parcelas e contas a pagar geradas pela compra.
- [ ] Fazer venda interna à vista e parcelada.
- [ ] Fazer pedido pelo catálogo público.
- [ ] Validar baixa de produto e variação.
- [ ] Validar materiais consumidos pelo atendimento.
- [ ] Testar cancelamento, devolução parcial, crédito e reembolso.
- [ ] Revisar estoque crítico, lotes e validade.

### Financeiro

- [ ] Conferir sinal, saldo restante e recebíveis.
- [ ] Conferir contas a pagar e a receber.
- [ ] Validar caixa, taxas, parcelamento e formas de pagamento.
- [ ] Comparar dashboard, relatórios e razão financeiro.
- [ ] Garantir que cancelamentos e estornos não permaneçam como receita.

**Saída da semana:** estoque e financeiro representam exatamente as operações realizadas.

## Semana 4 — 21 a 27 de setembro

### Integrações e produção

- [ ] Homologar Asaas em sandbox com webhook real.
- [ ] Homologar SMTP com uma conta e remetente reais.
- [ ] Homologar Cloudflare R2 com arquivos públicos e privados.
- [ ] Confirmar domínio, HTTPS, CORS e URLs públicas.
- [ ] Configurar secrets de produção.
- [ ] Aplicar e verificar migrations no ambiente de produção.
- [ ] Validar backup e procedimento de restauração.
- [ ] Confirmar logs, saúde da API e alertas operacionais.

### Segurança e privacidade

- [ ] Trocar todas as senhas temporárias.
- [ ] Ativar MFA do superadmin.
- [ ] Revisar acessos de usuários e permissões.
- [ ] Validar isolamento entre clínicas.
- [ ] Confirmar proteção de arquivos clínicos e comprovantes.
- [ ] Revisar termos, privacidade e retenção de dados.

**Saída da semana:** ambiente de produção pronto para receber dados reais.

## Lançamento — 28 a 30 de setembro

- [ ] Criar a primeira clínica de produção.
- [ ] Fazer onboarding acompanhado do responsável.
- [ ] Executar um agendamento, atendimento e venda controlados.
- [ ] Confirmar cobrança, estoque, financeiro e comunicação.
- [ ] Monitorar erros e suporte durante o primeiro dia.
- [ ] Corrigir somente bloqueios e riscos; melhorias entram no próximo ciclo.
- [ ] Registrar a decisão final de lançamento.

## Critérios de Go/No-Go

O lançamento pode avançar quando todos os itens abaixo forem verdadeiros:

- [ ] Cadastro e login funcionam sem intervenção no banco.
- [ ] Nenhuma falha aberta pode misturar dados entre clínicas.
- [ ] Agenda impede conflito e preserva histórico em cancelamentos.
- [ ] Estoque não fica negativo nem diverge após venda, atendimento ou devolução.
- [ ] Financeiro não duplica cobrança, receita, parcela ou estorno.
- [ ] Asaas recebe webhooks e concilia pagamentos.
- [ ] Arquivos privados não ficam públicos.
- [ ] Backup e restauração foram exercitados.
- [ ] Há um canal claro de suporte para as primeiras clínicas.

Se qualquer item acima falhar, o lançamento fica **No-Go** até a correção.

## Fora do escopo do lançamento

- Campanhas de marketing por e-mail ou WhatsApp sem consentimento.
- Novas integrações que não bloqueiam a operação principal.
- Mudanças grandes de identidade visual.
- Funcionalidades solicitadas por um único teste sem validação do problema.
- Expansão comercial antes de estabilizar as primeiras clínicas.

## Registro rápido de decisões

| Data | Área | Decisão ou problema | Prioridade | Responsável | Estado |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Pontos levantados durante os testes

- [x] Criar termos e políticas de uso profissionais.
- [x] Criar uma área de notícias e novidades, em formato de blog, na landing page.
- [x] Criar, dentro do sistema, um menu com o manual do usuário.
- [x] Criar uma lógica de rascunho automático para formulários: preservar temporariamente os dados digitados antes do salvamento definitivo, evitando perda quando o usuário sair da tela ou esquecer de salvar. Avaliar armazenamento em JSON, sem criar antecipadamente o registro definitivo nem consumir seu ID.
- [x] Reorganizar Clientes: primeiro cadastrar o cliente e, na linha da listagem, disponibilizar um botão para abrir seu perfil. A tela do perfil deve reunir abas de dados do cliente, termos digitais e pós-atendimento, funcionando como histórico centralizado. Avaliar no estudo final se Termos digitais e Pós-atendimento devem permanecer como menus filhos de Clientes, como atalhos para listas operacionais gerais, ou ambos.
- [x] Revisar o formulário de Novo cliente para o padrão brasileiro. Campos básicos propostos: nome completo obrigatório, nome social opcional, data de nascimento obrigatória, WhatsApp obrigatório, e-mail opcional, CPF opcional no cadastro e obrigatório somente quando exigido pelo fluxo, Instagram opcional, canal preferido de contato e um único campo livre chamado **Observações**.
- [x] Manter os campos de WhatsApp e e-mail no cadastro e adicionar **Canal preferido de contato** como combobox apenas indicativo, com opções como WhatsApp e e-mail; a seleção não deve apagar nem substituir os dados dos dois canais.
- [x] Aplicar máscaras e validações brasileiras no cadastro de clientes: telefone e WhatsApp como `(11) 99999-9999`, CPF como `000.000.000-00` com validação dos dígitos, data exibida como `dd/mm/aaaa`, e-mail validado/sem espaços/em minúsculas e Instagram padronizado como `@usuario`.
- [x] Normalizar os dados no backend, além das máscaras visuais: remover espaços duplicados do nome preservando acentos, armazenar datas em formato ISO e definir uma representação consistente para telefones e CPF.
- [x] Não misturar informações de saúde, alergias, medicamentos ou dados do responsável legal no cadastro básico. Manter esses dados sensíveis na anamnese/termo digital, com acesso restrito e vínculo ao perfil do cliente.
- [x] **Aprovado — ampliar o cadastro básico do cliente:** incluir origem do cliente (Instagram, indicação, Google, passagem, evento etc.), quem indicou com vínculo opcional a outro cliente, tags, status ativo/inativo/bloqueado com motivo interno, consentimentos separados para comunicações operacionais e marketing, contato de emergência opcional, vínculo reutilizável com responsável legal para menores e endereço opcional apenas quando necessário para entrega ou documento fiscal.
- [x] **Aprovado — informações automáticas no perfil:** calcular e apresentar primeiro e último atendimento, próximo agendamento, quantidade de atendimentos, cancelamentos e faltas, total gasto, ticket médio, compras de joias, pontos de fidelidade, créditos disponíveis, valores pendentes, termos assinados e pós-atendimentos pendentes. Essas informações não devem ser digitadas manualmente.
- [x] **Aprovado — recursos importantes do cadastro:** detectar possíveis duplicidades por CPF, WhatsApp ou e-mail; permitir mesclar cadastros preservando todo o histórico; criar linha do tempo única com agendamentos, procedimentos, compras, pagamentos, termos e retornos; registrar quando, por quem e por qual origem o cliente foi cadastrado; manter histórico de alterações importantes; permitir busca por nome, CPF, telefone, e-mail e Instagram; e exibir alertas importantes respeitando as permissões de acesso a informações clínicas.
- [x] Manter o formulário inicial de cliente curto e rápido. Informações comerciais, financeiras e históricas devem ser calculadas pelo sistema e exibidas no perfil, evitando preenchimento manual e duplicidade de dados.
- [x] **Aprovado — centralizar Serviços e Agenda:** remover a experiência duplicada entre Serviços, Procedimentos e Configurações da Agenda. Organizar a Agenda com Calendário, Novo agendamento, Histórico de atendimentos e Configurações; dentro de Configurações, reunir Procedimentos, Profissionais, Horários, Bloqueios e Solicitações online.
- [ ] **Aprovado — fundir os cadastros de Serviço e Procedimento:** adotar um único cadastro de **Procedimento/Tipo de atendimento**, com categoria, nome, preço, duração, sinal, região do corpo, orientações pré e pós-atendimento, profissionais habilitados, materiais consumidos, joias compatíveis, regras de idade e responsável, prazos de retorno, disponibilidade online e status.
- [x] Preservar no domínio e no banco a diferença entre o procedimento reutilizável e sua execução agendada. Ao criar o agendamento, guardar uma cópia histórica dos dados comerciais e operacionais relevantes, para que alterações futuras no procedimento não modifiquem atendimentos antigos.
- [x] **Aprovado — princípio de adoção opcional:** tratar as novas funções de Agenda e Serviços como recursos configuráveis. A experiência padrão deve ser simples, com apenas os dados essenciais obrigatórios; cada clínica ativa e utiliza checklists, rastreabilidade, regras, recursos físicos, automações e controles adicionais conforme considerar importante. Recursos não configurados não devem bloquear nem poluir o fluxo básico.
- [x] **Aprovado — fluxo completo do atendimento:** suportar solicitação, aguardando sinal, confirmado, cliente chegou, em atendimento e concluído, além de cancelado, reagendado e não compareceu. Permitir que clínicas que não usam check-in continuem operando com um fluxo reduzido.
- [x] **Aprovado — check-in opcional:** registrar horário de chegada, atraso e início real do atendimento quando a clínica ativar esse controle.
- [ ] **Aprovado — checklist configurável de atendimento:** permitir itens como cadastro conferido, termo assinado, responsável legal validado, joia conferida, materiais separados e orientações entregues. A clínica deve escolher os itens e quais deles serão obrigatórios para concluir.
- [ ] **Aprovado — rastreabilidade opcional de biossegurança:** permitir vincular ao atendimento lote de agulha ou material descartável, ciclo/registro de esterilização, joia aplicada, profissional responsável e data. A obrigatoriedade deve ser configurável pela clínica e/ou pelo procedimento.
- [x] **Aprovado — regras configuráveis por procedimento:** idade mínima, exigência de responsável, duração, intervalo, antecedência mínima, sinal, termo obrigatório, retorno e pós-atendimento. Ausência de configuração deve usar padrões seguros sem impedir o agendamento básico.
- [x] **Aprovado — comunicações da Agenda:** confirmação, lembrete, reagendamento e cancelamento para o cliente, com registro de envio, entrega e falha. Cada automação e canal deve poder ser ligado ou desligado pela clínica.
- [ ] **Aprovado — histórico de reagendamentos:** preservar data e horário anteriores, novos valores, usuário responsável, momento e motivo, sem substituir ou perder o histórico.
- [ ] **Aprovado — evoluções posteriores da Agenda:** lista de espera para cancelamentos, encaixe com alerta de conflito, salas/cadeiras/estações, visão diária da recepção, reagendamento por arrastar e soltar, integração com calendários externos, feriados e horários especiais, retorno/downsizing automático e indicadores de atraso, ocupação, cancelamento e ausência. Todos devem respeitar o princípio de ativação opcional.
- [x] **Aprovado — reorganização geral da navegação:** ordenar o menu conforme o uso real da clínica: **Início → Atendimento → Comercial → Estoque e Compras → Financeiro → Gestão → Configurações**.
- [ ] **Início:** reunir uma visão geral com agenda do dia, clientes aguardando retorno, pendências e alertas importantes.
- [ ] **Atendimento:** reunir Agenda, Clientes e Comunicações. Agenda deve conter Calendário, Solicitações online, Lista de espera, Histórico de atendimentos e Configurações; Configurações deve reunir Procedimentos, Profissionais, Horários e Bloqueios. Clientes deve conter Lista de clientes, Termos pendentes e Pós-atendimentos pendentes. Comunicações deve conter Fila de mensagens, Histórico e Modelos.
- [ ] **Comercial:** reunir Vendas e Catálogo online. Vendas deve conter Nova venda, Vendas em aberto e Histórico. Catálogo deve conter Produtos publicados, Personalização, Promoções e Cupons.
- [ ] **Estoque e Compras:** organizar Visão do estoque, Produtos e joias, Materiais de consumo, Compras e Fornecedores.
- [ ] **Financeiro:** organizar Visão financeira, Caixa, Contas a receber, Contas a pagar e Cadastros auxiliares; dentro dos cadastros auxiliares, manter Categorias e Centros de custo.
- [ ] **Gestão:** reunir Relatórios de atendimentos, vendas, financeiro, estoque e profissionais.
- [ ] **Configurações:** reunir Dados da clínica, Usuários e permissões, Integrações, Automações, Meu plano e Preferências do sistema.
- [x] **Ajuda fora do menu principal:** disponibilizar no cabeçalho Manual do usuário, Novidades e Suporte.
- [x] **Ações rápidas:** criar um botão fixo **+ Novo** com Novo agendamento, Novo cliente, Nova venda e Nova compra, respeitando permissões e recursos contratados.
- [ ] **Regras aprovadas da navegação:** adaptar itens ao cargo e às permissões; abrir submenus somente sob demanda; ocultar funcionalidades desativadas pela clínica; retirar o Onboarding do menu após sua conclusão; manter Termos e Pós-atendimento no perfil do cliente e usar os submenus gerais somente como filas operacionais; manter Procedimentos e configurações operacionais dentro da Agenda.
- [x] **Aprovado — manter Compras, Vendas e Atendimentos separados:** Compras representa entrada de produtos e materiais vindos de fornecedores, atualiza estoque/custo/lotes e gera contas a pagar; Vendas representa somente a saída avulsa de produtos para clientes, baixa estoque e registra pagamento ou contas a receber; Atendimentos nascem e são concluídos pela Agenda, registram receita do procedimento, podem incluir joias, consomem materiais e geram pagamento ou contas a receber.
- [x] Despesas sem entrada de estoque, como aluguel, energia e internet, devem ser lançadas diretamente em Contas a pagar, sem passar por Compras.
- [x] Quando uma joia for aplicada durante um procedimento, manter um único fechamento para o cliente, mas separar nos dados e relatórios a receita do serviço e a receita do produto. Troca ou instalação profissional deve ser procedimento da Agenda; entrega avulsa da joia deve ser Venda.
- [ ] Reutilizar componentes visuais comuns de itens, totais, pagamentos e parcelas entre os três fluxos, sem fundir suas regras de negócio ou telas operacionais.
- [x] Evoluir o modelo interno para que atendimento concluído deixe de depender de `sales_orders` do tipo `ordem_servico`: criar uma execução de serviço própria, vinculada ao agendamento, e fazer corte direto para o novo fluxo, evitando escrita dupla e duplicidade de receita, estoque ou recebíveis. Como não há necessidade de preservar dados antigos antes do lançamento, recriar as bases descartáveis em vez de implementar backfill legado.
- [x] **Aprovado — unificar Produtos e Materiais em uma fonte de verdade:** criar a entidade central **Item de estoque**, eliminando identidades, saldos, custos, compras, lotes e movimentações duplicadas entre produtos para venda e materiais de procedimento.
- [x] Cada item de estoque deve possuir nome/SKU, categoria, unidade de estoque, quantidade, estoque mínimo, custo médio, fornecedor e configurações explícitas como **pode ser vendido**, **pode ser utilizado em procedimento**, **controla estoque**, **controla lote/validade** e **pode aparecer no catálogo**.
- [x] Não usar somente a categoria para controlar o comportamento do item. Categoria deve servir para organização e filtros; permissões de venda, uso em procedimento, publicação e rastreabilidade devem ser campos próprios, evitando que uma simples troca de categoria exponha um material na venda ou no catálogo.
- [x] Permitir combinações: agulhas e luvas são utilizáveis em procedimento e não vendáveis; joias podem ser vendáveis, publicáveis e utilizáveis em atendimento; produtos de cuidado podem ser vendáveis e, conforme configuração, também consumidos em procedimentos.
- [x] **Fluxos da fonte única:** Compras seleciona qualquer item de estoque; Vendas filtra somente itens vendáveis; a ficha técnica do Procedimento filtra itens utilizáveis; o Catálogo filtra itens publicáveis; Estoque mantém um único saldo, custo e histórico para todos.
- [x] Preservar dados específicos de joias, imagens, variações, medidas e atributos de catálogo em estrutura complementar ligada ao item central, sem duplicar sua identidade ou movimentação de estoque.
- [x] Suportar unidades de compra, estoque e consumo com conversão configurável, por exemplo: comprar 1 caixa com 100 agulhas, registrar 100 unidades no estoque e consumir 1 unidade por procedimento.
- [x] Reorganizar o menu **Estoque** com as visões Todos os itens, Produtos para venda, Materiais de procedimento, Lotes e validades e Movimentações, usando filtros sobre a mesma origem de dados.
- [x] Fazer corte direto de produtos, variações, materiais, fichas técnicas, compras, lotes e movimentos para o Item de estoque. Antes do primeiro dado real, recriar as bases descartáveis sem backfill nem camada de compatibilidade; depois da entrada em produção, toda mudança volta a exigir migration incremental e preservação histórica.
- [x] **Aprovado — evoluir o cadastro de fornecedores:** manter como essenciais somente nome e tipo, e oferecer opcionalmente nome fantasia, razão social/nome completo, pessoa jurídica, pessoa física ou fornecedor internacional, CPF/CNPJ/documento estrangeiro, contato comercial, telefone, WhatsApp, e-mail, site/Instagram, categoria, status e Observações.
- [x] Criar categorias organizacionais para fornecedores, como Joias, Materiais descartáveis, Produtos de cuidado, Equipamentos, Embalagens, Manutenção e Outros, sem usar a categoria como única regra de negócio.
- [x] Disponibilizar endereço opcional com CEP, logradouro, número, complemento, bairro, cidade, estado e país.
- [x] Disponibilizar condições comerciais opcionais: prazo médio de entrega, pedido mínimo, condição e forma de pagamento padrão, chave Pix, frete habitual e vendedor/representante.
- [x] Disponibilizar controles opcionais de qualidade para fornecedores de joias e materiais: materiais fornecidos, certificações/laudos, documentos anexados, validade dos documentos e situação aprovado/em análise/bloqueado.
- [x] Aplicar máscaras, normalização e validação no frontend e backend: CPF/CNPJ com dígitos verificadores, telefone/WhatsApp brasileiro, e-mail sem espaços e em minúsculas, CEP `00000-000`, UF em combobox, URL HTTPS e chave Pix conforme o tipo.
- [x] Detectar duplicidade de fornecedor por CPF/CNPJ ou documento equivalente e impedir registros conflitantes.
- [x] **Aprovado — relacionamento Fornecedor ↔ Item de estoque:** permitir vários fornecedores para o mesmo item e vários itens por fornecedor, guardando código do item no fornecedor, último custo, prazo de entrega e pedido mínimo para comparação de compra.
- [x] Exibir automaticamente no perfil do fornecedor última compra, total comprado, contas pendentes e itens fornecidos, sem exigir preenchimento manual.
- [x] Fornecedor com compras, títulos ou outro histórico não pode ser apagado definitivamente; deve ser arquivado, preservando todas as referências.
- [x] Todos os campos e controles avançados do fornecedor devem respeitar o princípio de adoção opcional e não dificultar o cadastro rápido usado por clínicas menores.
- [ ] **Aprovado — padronizar formulários extensos por categoria, importância e frequência de uso:** apresentar primeiro os campos essenciais e mais utilizados, depois os dados operacionais e financeiros, e deixar informações complementares ou raramente usadas no final, em seções opcionais/recolhíveis.
- [ ] Definir o componente conforme a complexidade: formulários pequenos em modal; formulários médios em modal grande com seções; e formulários extensos ou transacionais, como Compra, Venda, Agendamento/Atendimento e cadastros avançados, em página própria ou experiência de tela cheia.
- [ ] Usar **etapas com Anterior/Continuar** quando houver uma sequência de preenchimento e **abas** somente para categorias independentes que possam ser acessadas em qualquer ordem. Evitar esconder etapas obrigatórias, erros ou informações que precisem ser comparadas entre abas.
- [ ] Adotar como ordem de referência: **Informações principais → Itens/operação → Financeiro → Informações complementares → Revisão e confirmação**, ajustando os nomes ao domínio de cada cadastro.
- [ ] Criar um padrão responsivo para listas editáveis de itens e parcelas: no desktop, utilizar tabela/grid com colunas, subtotal e ações de editar/remover; no mobile, transformar cada linha em cartão compacto com resumo, valores e botões de ação, sem exigir rolagem horizontal da página.
- [ ] Permitir edição de itens diretamente na linha quando houver poucos campos ou por linha expandida/painel lateral quando houver mais detalhes. No mobile, abrir uma subtela de edição dentro do mesmo fluxo, com ação clara de voltar e preservação do rascunho.
- [ ] Evoluir o componente de parcelas para grid editável no desktop e cartões no mobile, preservando distribuição automática, edição individual, total da operação, soma das parcelas, divergência e indicação do erro na parcela correspondente.
- [ ] **Aprovado — evitar modal sobre modal:** permitir uma segunda camada somente para confirmação crítica ou cadastro rápido e atômico de até poucos campos, como categoria ou centro de custo. Cadastros completos de fornecedor, produto, item ou outras entidades devem usar subtela, painel lateral ou página própria, preservando o formulário principal.
- [ ] No mobile, tratar formulários extensos como navegação em tela cheia, com uma coluna, cabeçalho e ação principal persistentes, indicação da etapa atual, resumo dos erros e botão Voltar previsível; não empilhar telas cheias em diferentes modais.
- [ ] Criar componentes compartilhados para sustentar o padrão: estrutura de formulário em tela cheia, navegador de etapas, seção de formulário, campos avançados recolhíveis, lista editável responsiva, editor de item, resumo de revisão e resumo de validação por etapa.
- [ ] Integrar o padrão de formulários grandes à lógica de rascunho automático: salvar por seção/etapa, indicar quando o rascunho foi salvo, restaurar o preenchimento e impedir perda de dados ao editar itens, trocar de etapa, fechar a tela ou acessar um cadastro auxiliar.
- [ ] Aplicar inicialmente o padrão em **Compras, Vendas, Agendamento/Atendimento, Procedimentos e Fornecedores**, reutilizando os mesmos componentes visuais sem misturar suas regras de negócio.
- [x] **Aprovado — criar Gestão de equipe, perfis de acesso e auditoria central:** organizar a área em Usuários, Perfis de acesso e Auditoria; permitir criar, duplicar e reutilizar perfis personalizados; agrupar permissões por módulo com nomes, descrições e impactos claros; mostrar permissões efetivas e permitir configurar o perfil e suas exceções antes de concluir o cadastro do usuário.
- [x] Registrar na auditoria central cadastros, alterações, arquivamentos, exclusões, logins e bloqueios, mudanças de perfil/permissão, operações financeiras e de estoque, importações fiscais, exportações de relatórios e acessos a informações clínicas sensíveis. Exibir filtros por período, usuário, módulo, ação e entidade, com comparação antes/depois e motivo quando aplicável.
- [x] Tratar a auditoria como registro imutável e protegido por permissão. Nunca gravar senhas, tokens, segredos SMTP, dados de cartão ou conteúdo clínico desnecessário; registrar metadados de acesso sensível sem expor o conteúdo. Corrigir também o salvamento silencioso de permissões sem motivo e auditar a exclusão de usuários.
- [x] **Aprovado — evoluir a Central de relatórios com uma arquitetura única e econômica:** organizar os relatórios nas categorias Atendimento, Clientes e Clínico, Comercial, Estoque e Compras, Financeiro e Gestão/Auditoria; dentro de cada categoria, apresentar apenas os relatórios permitidos pelo plano e pelas permissões do usuário.
- [x] Cada tipo de relatório deve declarar seus próprios filtros, colunas, ordenação e formatos. Exibir o resultado em grid pesquisável com paginação no servidor e gerar PDF, XLSX, CSV e TXT a partir da mesma consulta filtrada, com títulos e valores em português.
- [x] Corrigir as limitações atuais dos relatórios: não truncar PDF silenciosamente, exportar também a Curva ABC, implementar o vínculo Usuário ↔ Profissional para relatórios próprios, aplicar apenas filtros relevantes a cada relatório, respeitar corretamente os períodos e testar de fato os arquivos exportados. Usar PDF para apresentação/resumo e XLSX, CSV ou TXT para grandes volumes detalhados.
- [x] Incluir relatórios ainda ausentes e relevantes: compras, fornecedores, contas a pagar, contas a receber, movimentações de estoque, lotes e validades, termos digitais, pós-atendimento, biossegurança, usuários, permissões e auditoria.
- [x] **Aprovado — importar XML da NF-e na tela de Compra:** receber o XML em uma etapa de prévia segura, validar estrutura, autorização, chave de acesso, hash e duplicidade, e preencher fornecedor, data, número, série, itens, quantidades, custos, totais, pagamentos e parcelas sem confirmar automaticamente a compra.
- [ ] Criar uma grid de conferência e associação dos itens importados, indicando item localizado automaticamente, seleção necessária, novo item ou item ignorado. Localizar fornecedor por CPF/CNPJ/documento e itens por GTIN/EAN, código do fornecedor ou SKU, permitindo corrigir divergências antes de gerar estoque e contas a pagar.
- [x] Ampliar o modelo fiscal para armazenar, conforme aplicável, chave de acesso, número, série, protocolo, status, hash, XML original privado e dados de rastreabilidade; complementar fornecedor e item de estoque com os identificadores fiscais necessários, considerando inclusive CNPJ alfanumérico. Na confirmação, reutilizar o serviço transacional de Compras para movimentar estoque, atualizar custos/lotes e gerar contas a pagar uma única vez.

## Resultado do lançamento

| Campo | Preenchimento |
| --- | --- |
| Data efetiva | A definir |
| Primeira clínica | A definir |
| Plano inicial | A definir |
| Responsável pelo suporte | A definir |
| Decisão | `Go` / `No-Go` |
| Pendências aceitas | A definir |
