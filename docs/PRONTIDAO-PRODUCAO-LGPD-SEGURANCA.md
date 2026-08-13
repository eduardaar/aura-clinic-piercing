# Prontidão para produção, LGPD e segurança

> **Data da avaliação:** 13 de agosto de 2026  
> **Escopo:** aplicação, banco de dados, infraestrutura de produção, privacidade/LGPD, pagamentos, deploy, migrations, backup e continuidade.  
> **Natureza:** avaliação técnica de prontidão e privacidade. Não substitui parecer jurídico, pentest independente ou auditoria PCI DSS.

## 1. Sumário executivo

A Aura Clinic Piercing está funcional e possui fundamentos técnicos positivos, mas **ainda não deve ser considerada pronta para um lançamento comercial amplo com dados reais de saúde e pagamentos**.

Na data desta avaliação, a decisão recomendada é **NO-GO para lançamento público**. Um piloto controlado somente deve ocorrer depois da correção dos bloqueadores P0 descritos neste documento.

| Área | Situação | Motivo principal |
| --- | --- | --- |
| Funcionalidade e testes | Boa | Typecheck, build e 563 testes passaram após a primeira remediação. |
| LGPD e governança | Crítica | Documentos, bases legais, retenção, direitos e contratos incompletos. |
| Segurança da aplicação | Crítica | O RBAC clínico prioritário foi corrigido no repositório, mas sessão longa em `localStorage`, ausência de MFA e auditoria de leitura continuam. |
| Infraestrutura | Crítica | Origem acessível fora do Cloudflare, SSH root por senha e host compartilhado. |
| Pagamentos | Parcial/crítica | Cartão bruto e autopromoção inconsistente foram bloqueados no repositório; reconciliação, estorno/chargeback e homologação continuam pendentes. |
| Deploy e migrations | Parcial | A troca do frontend e o healthcheck de banco foram melhorados no repositório; staging, migrations versionadas, artefato imutável e rollback completo ainda faltam. |
| Backup e recuperação | Crítica | A rotina diária observada não protege o banco `aura_clinic`. |

O sistema está tecnicamente no ar, mas isso não equivale a estar liberado com segurança, conformidade demonstrável e capacidade de recuperação.

### 1.1 Estado da remediação no repositório

Depois da fotografia original desta auditoria, uma primeira etapa de correções
foi implementada **no código local, ainda não considerada ativa em produção**:

- RBAC de termos e pós-atendimento restrito a `admin`/`piercer`, com testes;
- revogação dos tokens anteriores após troca de senha ou papel;
- remoção do recebimento de cartão/CVV em favor do checkout hospedado;
- idempotência persistente e obrigatória no checkout da assinatura;
- token UUID não sequencial nas consultas públicas de cobrança;
- bloqueio de troca self-service quando já existe recorrência;
- evidência separada do responsável em termos de menores;
- minimização do contexto enviado à IA e sanitização da telemetria pública;
- container sem root, healthcheck de banco e ativação atômica do frontend;
- lint novamente bloqueante no CI.

Esses avanços não mudam o **NO-GO**: backup, origem/SSH, headers, MFA/sessão
completa, retenção, contratos/LGPD, reconciliação e validações independentes
continuam pendentes. O acompanhamento por categoria está em
[PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md](./PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md).

## 2. Escopo e metodologia

A análise combinou:

- leitura da arquitetura, documentação e código atual;
- revisão de autenticação, autorização, isolamento multi-tenant, uploads, pagamentos e integrações;
- execução de testes, typecheck, build, lint e auditoria de dependências;
- verificações externas não destrutivas do domínio público;
- inspeção somente leitura da configuração operacional de produção;
- comparação com LGPD, orientações da ANPD, regras de comércio eletrônico, PCI DSS e OWASP ASVS.

As observações de infraestrutura representam uma fotografia da produção em **13/08/2026**. Devem ser revalidadas depois de qualquer mudança operacional.

### 2.1 Resultado das verificações automatizadas

- Backend: **459 testes aprovados**.
- Frontend: **104 testes aprovados**, sendo 18 unitários e 86 de componentes.
- Typecheck: aprovado.
- Build de produção: aprovado.
- Lint: aprovado com **0 erros e 81 avisos**; erros agora bloqueiam o CI.
- Sintaxe do script de deploy: aprovada com `bash -n`.
- Build da imagem Docker: não executado nesta estação porque o daemon Docker não estava disponível.
- Dependências de produção do backend: **2 vulnerabilidades altas e 2 moderadas** na data da análise.
- Dependências de produção do frontend: **2 vulnerabilidades moderadas** na data da análise.

Dependências afetadas incluem `express-rate-limit`, `exceljs`, `archiver`, `uuid`, `react-router` e dependências transitivas. Cada advisory deve ser corrigido ou ter sua não explorabilidade documentada e aprovada formalmente.

## 3. Controles positivos existentes

Os pontos abaixo reduzem riscos e devem ser preservados:

- isolamento de clínicas por schema PostgreSQL;
- conexão dedicada por requisição, `search_path` controlado e reset antes de devolver a conexão ao pool;
- token vinculado ao tenant e separação entre autenticação da clínica e da plataforma;
- validação do usuário atual no banco em rotas autenticadas;
- CORS de produção restrito ao domínio oficial;
- Helmet aplicado à API;
- arquivos privados entregues por rotas autenticadas e com cache desabilitado;
- validação de tamanho, formato e conteúdo básico dos uploads;
- armazenamento privado no Cloudflare R2;
- credenciais do Asaas cifradas com AES-256-GCM e chave dedicada em produção;
- webhook do Asaas autenticado, com idempotência e registro de eventos;
- lock consultivo do PostgreSQL ao aplicar o schema de cada tenant;
- API somente começa a escutar depois da aplicação do schema;
- backup antes de deploy, verificação básica do dump e retenção das últimas cópias;
- imagem anterior da API mantida para rollback;
- cobertura automatizada de isolamento entre tenants.

Esses controles são uma boa base, mas não eliminam os bloqueadores encontrados.

## 4. Bloqueadores P0

P0 significa que o item precisa ser resolvido antes de colocar novos clientes ou pacientes reais no sistema.

### P0-01 — O backup automático não protege o banco da Aura

**Evidência observada**

- O banco da aplicação é `aura_clinic`.
- A rotina agendada de backup, envio externo e teste de restauração estava configurada com `DB_NAME=monitence`.
- Os arquivos e logs da rotina agendada referem-se a `backup_monitence_*`.
- Os backups identificados da Aura eram os dumps executados durante deploy, limitados aos dez últimos e armazenados no mesmo disco do servidor.
- Não foi evidenciada restauração integral dos objetos privados do R2.

**Impacto**

Falha do disco, corrupção, exclusão acidental, ransomware ou comprometimento do servidor pode causar perda irrecuperável de prontuários, termos, fotos, agenda e dados financeiros.

**Ações obrigatórias**

1. Corrigir o alvo da rotina para `aura_clinic`.
2. Gerar backup diário criptografado em conta e infraestrutura separadas.
3. Adotar WAL/PITR caso o RPO desejado seja inferior a 24 horas.
4. Proteger cópias contra alteração/exclusão, preferencialmente com retenção imutável.
5. Incluir versionamento, replicação ou backup dos arquivos privados do R2.
6. Restaurar banco, arquivos e segredos em ambiente limpo e validar funcionalmente a aplicação.
7. Definir e aprovar RPO e RTO.
8. Executar teste de restauração completo pelo menos trimestralmente.

> A rotina geral de backup existente funciona, mas, conforme a configuração observada, ela valida outro banco e não constitui proteção comprovada da Aura.

### P0-02 — A origem pode ser acessada sem passar pelo Cloudflare

O IP de origem respondeu diretamente por HTTPS quando utilizado o SNI do domínio. Assim, um atacante pode contornar WAF, regras de borda e proteções oferecidas pelo Cloudflare.

Na fotografia original, a aplicação lia `CF-Connecting-IP` diretamente para o
rate limit. O código foi alterado para usar apenas o IP resolvido pelo Express,
mas a proteção só é confiável com a origem fechada e `trust proxy` configurado
exatamente para a topologia real.

**Ações obrigatórias**

- aceitar tráfego 80/443 na origem somente das faixas oficiais do Cloudflare;
- ativar Authenticated Origin Pulls ou mecanismo equivalente;
- confiar em headers `CF-*` apenas quando a conexão vier de proxy conhecido;
- validar o comportamento do Express `trust proxy`;
- fechar a porta pública de métricas `9100`;
- revisar todos os serviços e portas existentes no host compartilhado.

### P0-03 — SSH e execução privilegiada

Na data da análise, o servidor aceitava login SSH como `root` e autenticação por senha. A API também executava com UID 0 dentro do container. O Dockerfile local agora seleciona o usuário `node`; essa parte precisa de rebuild, deploy e verificação, enquanto o risco de SSH permanece integralmente externo ao código.

Como uma credencial de root foi compartilhada em uma conversa, ela deve ser considerada exposta e rotacionada imediatamente, sem reutilização.

**Ações obrigatórias**

- criar usuário nominal de deploy com privilégios mínimos;
- usar chave SSH individual e protegida;
- desabilitar `PasswordAuthentication`;
- desabilitar login SSH direto de root;
- utilizar `sudo` auditável;
- definir `USER` sem privilégios na imagem da API;
- remover capabilities e usar filesystem somente leitura quando viável;
- separar a Aura dos demais sistemas ou, no mínimo, segmentar redes, credenciais e recursos.

### P0-04 — Autorização insuficiente para dados clínicos — primeira correção no repositório

Na fotografia original, as rotas de termos digitais e pós-atendimento passavam
por autenticação sem restrição de papel suficiente. Elas agora exigem `admin` ou
`piercer`, com testes que negam recepção e financeiro. Ainda falta fechar a
matriz completa de todos os recursos, vincular acesso ao profissional quando
aplicável e auditar leituras/exportações.

Referências técnicas:

- `backend/src/routes/terms.js`
- `backend/src/routes/postcare.js`
- `backend/src/middleware/auth.js`

**Impacto**

Exposição interna de alergias, histórico, ocorrências, cicatrização, questionário de saúde e outras informações sensíveis a usuários de recepção ou financeiro.

**Ações obrigatórias**

- criar matriz explícita `recurso × ação × papel`;
- aplicar autorização no backend em todas as rotas clínicas;
- restringir dados de saúde a profissional responsável e administração, pelo princípio do menor privilégio;
- registrar leitura, exportação e download de prontuários, termos e fotos;
- adicionar testes negativos de autorização para cada papel.

### P0-05 — Sessões administrativas sem proteção suficiente

O token de clínica possui validade de 12 horas e é armazenado no `localStorage`.
O repositório agora invalida tokens anteriores após troca de senha ou papel por
meio de `session_version`, mas ainda não há MFA obrigatório, refresh token
rotativo, sessão por dispositivo ou revogação individual.

Referência técnica: `frontend/src/lib/api.js`.

**Risco**

Uma vulnerabilidade XSS ou acesso ao navegador pode entregar uma sessão administrativa completa ao atacante.

**Ações obrigatórias**

- preferir sessão em cookie `HttpOnly`, `Secure` e `SameSite`, ou access token curto com refresh rotativo;
- registrar e revogar sessões no servidor;
- invalidar sessões após troca de senha, mudança de papel, suspensão ou incidente;
- exigir MFA para super-admins e administradores de clínica;
- proteger login por conta, dispositivo e risco, além do limite por IP;
- criar tela de sessões ativas e ação para encerrá-las.

### P0-06 — Frontend sem headers de proteção adequados

Os headers do Helmet foram observados na API, mas não no documento HTML da SPA. O navegador aplica CSP e proteção contra embedding a partir da resposta do frontend, não das chamadas posteriores à API.

**Ações obrigatórias**

- configurar CSP no Nginx/Cloudflare para o HTML;
- aplicar `frame-ancestors 'none'` ou política de embedding definida;
- habilitar HSTS no domínio completo;
- aplicar `X-Content-Type-Options: nosniff`, `Referrer-Policy` e `Permissions-Policy`;
- remover scripts inline ou adotar nonce/hash;
- testar a aplicação depois da CSP em modo report-only antes de bloquear.

### P0-07 — Endpoint capaz de receber cartão e CVV — corrigido no repositório

Na fotografia original, a rota de billing podia receber dados brutos de cartão.
Ela agora aceita somente o checkout hospedado `UNDEFINED` e rejeita cartão,
titular e CVV antes de chamar o gateway. A conclusão do item depende de deploy,
teste no sandbox/produção controlada e confirmação do enquadramento PCI.

Referência técnica: `backend/src/routes/billing.js`.

**Ação recomendada**

Desabilitar ou remover o fluxo server-side de cartão e utilizar página de pagamento/checkout hospedado pelo Asaas. Se o fluxo for mantido, será necessário assumir o escopo PCI correspondente, incluindo SAQ-D, segmentação, controles, auditoria e testes específicos.

Ver [orientação PCI DSS do Asaas](https://docs.asaas.com/docs/pci-dss-1) e [PCI Security Standards Council](https://www.pcisecuritystandards.org/standards/pci-dss/).

## 5. LGPD e governança de privacidade

### 5.1 Dados tratados

O produto trata, entre outros:

- nome, e-mail, WhatsApp, CPF, nascimento e endereço;
- assinatura e documentos de termos;
- histórico de piercings, alergias, ocorrências e cicatrização;
- fotografias antes/depois e fotos de pós-atendimento;
- informações de menores e responsáveis;
- dados de agendamento, compra, cobrança e relacionamento;
- logs técnicos, IP, dispositivo e histórico de uso.

Dados referentes à saúde são dados pessoais sensíveis nos termos da [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

### 5.2 Papéis de tratamento

A definição deve constar dos contratos e do registro de operações. Como hipótese operacional:

- a clínica tende a atuar como **controladora** dos dados de seus pacientes e clientes;
- a Aura/Monitence tende a atuar como **operadora** ao prestar o SaaS sob instruções da clínica;
- a Aura/Monitence pode atuar como controladora em finalidades próprias, como cadastro do tenant, faturamento, segurança da plataforma, suporte e prevenção a fraude.

É necessário formalizar um DPA/aditivo de tratamento com:

- objeto, duração, natureza e finalidade;
- categorias de dados e titulares;
- instruções documentadas da clínica;
- confidencialidade e treinamento;
- controles de segurança;
- subprocessadores e transferências internacionais;
- prazo de notificação de incidentes;
- apoio aos direitos dos titulares;
- retorno, portabilidade e eliminação no encerramento;
- auditoria, responsabilidade e evidências.

### 5.3 Bases legais

Deve existir um mapa por operação:

```text
dado → finalidade → base legal → retenção → compartilhamento → responsável
```

O consentimento para realizar o procedimento de piercing não substitui automaticamente uma base legal válida para cada tratamento previsto na LGPD.

A utilização da base de tutela da saúde precisa de análise jurídica específica, pois depende da natureza do serviço, da finalidade e de quem executa o tratamento. Fotos promocionais, comunicação comercial, analytics e uso de IA normalmente exigirão análises próprias e opções separadas.

### 5.4 Política de privacidade e termos

Os documentos legais atuais, semeados em `backend/src/db/platformSchema.sql`, são excessivamente genéricos para o tratamento observado.

Devem explicar, em linguagem clara:

- identidade e contatos dos controladores;
- categorias de dados;
- finalidades e bases legais;
- tratamento de dados sensíveis e de menores;
- compartilhamentos e subprocessadores;
- países e mecanismos de transferência internacional;
- retenção e critérios de eliminação;
- direitos e canal de atendimento;
- uso de cookies, analytics e IA;
- segurança e comunicação de incidentes;
- consequências da recusa quando o dado for necessário;
- histórico e vigência de versões.

O sistema registra o aceite do criador da clínica, incluindo versão, IP e user-agent, mas ainda precisa:

- exigir novo aceite para alterações materiais;
- separar aceite contratual de consentimentos opcionais;
- guardar versão/hash do documento aceito pelo paciente ou comprador;
- disponibilizar cópia durável do conteúdo aceito;
- impedir que simples uso continuado substitua manifestação válida quando ela for exigida.

### 5.5 Direitos dos titulares

Não foi identificado um fluxo completo para confirmação, acesso, correção, portabilidade, oposição, revogação e eliminação.

Deve ser criado:

- canal público de privacidade;
- validação proporcional da identidade;
- protocolo e SLA interno;
- busca em banco, arquivos, auditoria, integrações e backups;
- exportação em formato compreensível;
- registro de decisão, fundamento e resposta;
- encaminhamento entre Aura e clínica conforme o papel de cada uma.

A ANPD informa que confirmação e acesso simplificado devem ser providenciados imediatamente e que a declaração completa pode ser fornecida em até 15 dias. Ver [Direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares).

### 5.6 Retenção, anonimização e exclusão

Não foi evidenciada uma política de retenção implementada para dados clínicos, termos, fotos, pedidos, webhooks, auditoria, erros, suporte e backups.

A exclusão atual do cliente pode anonimizar o registro principal, mas dados identificáveis continuam em:

- termos digitais;
- questionários de saúde;
- prontuários e pós-atendimento;
- fotografias e PDFs;
- snapshots de auditoria;
- objetos armazenados no R2.

A exclusão de um tenant remove o schema do banco, mas não foi evidenciada a eliminação correspondente do prefixo de arquivos no R2.

É necessário:

1. definir matriz de retenção por finalidade e obrigação;
2. implementar jobs de expiração, anonimização e purge;
3. propagar exclusão ao R2 e fornecedores;
4. tratar cópias de backup com prazo e bloqueio de restauração indevida;
5. registrar exceções legais e legal hold;
6. provar a execução por logs auditáveis.

### 5.7 Menores e força probatória dos termos

Os campos do responsável em termos de menores são opcionais, não existe assinatura separada do responsável e a evidência atual da assinatura é limitada.

Devem ser considerados:

- idade e autorização do responsável obrigatoriamente validadas;
- assinatura separada e identificação do responsável;
- versão e hash do documento;
- data/hora, IP, dispositivo e trilha de eventos;
- link individual, expirável e de uso controlado;
- PDF final imutável e verificável;
- aplicação do melhor interesse do menor.

A incidência da Lei nº 15.211/2025 e do [ECA Digital](https://www.gov.br/anpd/pt-br/assuntos/eca-digital) deve ser avaliada por especialista considerando o público, o agendamento e a probabilidade de acesso por menores.

### 5.8 Transferências internacionais, fornecedores e IA

Fornecedores como Cloudflare, Resend, Google, OpenAI/Gemini e o gateway de pagamento devem constar do inventário com:

- função e dados recebidos;
- finalidade;
- país de armazenamento/tratamento;
- retenção;
- mecanismo contratual;
- medidas de segurança;
- procedimento de eliminação e incidente.

O assistente de IA aceita contexto textual amplo, e a interface pode resumir informações do cliente. Um operador pode, assim, enviar PII e dados de saúde a terceiros.

Antes de liberar IA com dados reais:

- aplicar minimização e mascaramento automático;
- bloquear dados clínicos por padrão;
- exigir habilitação administrativa consciente;
- controlar quem pode usar e auditar prompts;
- contratar o fornecedor de forma compatível com a LGPD;
- documentar retenção, treinamento de modelo e transferências;
- permitir que a clínica desabilite integralmente o recurso.

As transferências devem ser revisadas conforme a [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).

### 5.9 RIPD, registro e encarregado

Não foram evidenciados:

- registro das operações de tratamento;
- matriz formal de bases legais;
- Relatório de Impacto à Proteção de Dados Pessoais;
- avaliação de legítimo interesse, quando aplicável;
- política de retenção aprovada;
- canal e responsável público por privacidade.

Pelo uso de dados sensíveis, fotos e possível tratamento de menores, recomenda-se elaborar RIPD antes do lançamento. Ver [orientação da ANPD sobre RIPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd).

Mesmo quando houver hipótese de dispensa formal de encarregado para agente de pequeno porte, continua sendo necessário oferecer canal efetivo aos titulares. Para este produto, é prudente designar responsável de privacidade e obter assessoria especializada.

### 5.10 Incidentes de segurança

Não foi evidenciado plano formal, playbook, equipe de crise ou exercício de mesa.

O plano deve cobrir:

- invasão e roubo de sessão;
- vazamento entre tenants;
- ransomware;
- perda ou corrupção de banco/R2;
- credencial ou segredo exposto;
- fornecedor comprometido;
- abuso de conta administrativa;
- indisponibilidade do Asaas;
- comunicação à clínica, titulares, ANPD e demais partes.

Incidentes capazes de causar risco ou dano relevante devem ser comunicados pelo controlador à ANPD e aos titulares em três dias úteis, conforme o [Regulamento de Comunicação de Incidente de Segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis). O contrato deve obrigar a plataforma, como operadora, a avisar a clínica em prazo muito menor, por exemplo 12 ou 24 horas.

## 6. Segurança da aplicação e infraestrutura

### 6.1 Superfície pública e abuso

Endpoints públicos de catálogo, agendamento, compra, upload e ingestão de erros dependem principalmente de rate limit por IP.

Riscos:

- criação automatizada de registros;
- spam e esgotamento de banco/armazenamento;
- upload abusivo;
- preenchimento da tabela de erros com stack/contexto arbitrários;
- bypass de rate limit por botnet ou header falsificado.

Controles necessários:

- Cloudflare Turnstile ou mecanismo anti-bot nos fluxos de criação;
- limites por tenant, rota, conta, pedido e fingerprint de risco;
- quotas de armazenamento;
- schemas estritos e redução de campos no endpoint de erros;
- expiração dos logs públicos;
- alertas de crescimento e comportamento anormal.

### 6.2 Uploads

A aplicação valida assinatura básica e decodifica imagens, o que é positivo. Porém PDFs e GIFs não passam por antimalware ou Content Disarm and Reconstruction.

Recomendações:

- antimalware assíncrono antes de disponibilizar o arquivo;
- quarentena para arquivos pendentes;
- nomes e tipos definidos pelo servidor;
- PDF servido como anexo ou visualizado em sandbox;
- limites por tenant e retenção;
- impedir SVG/HTML e conteúdo ativo;
- registrar upload, acesso e exclusão.

### 6.3 Segredos e host

- manter segredos fora de arquivos versionados;
- rotacionar credenciais periodicamente e após qualquer exposição;
- separar segredos por serviço e ambiente;
- usar secret manager quando possível;
- impedir que logs, dumps e comandos exibam tokens;
- habilitar `auditd` ou telemetria equivalente;
- corrigir atualizações pendentes e a reinicialização requerida;
- revisar o risco de outros containers comprometidos alcançarem o Postgres compartilhado.

### 6.4 Observabilidade de segurança

Não foi evidenciado SIEM ou agregação imutável de eventos de segurança.

Devem gerar alerta:

- tentativas repetidas de login;
- login administrativo anômalo;
- mudança de papel, senha ou configuração;
- download/exportação em volume;
- falhas e atrasos de webhook;
- divergência de reconciliação;
- erro 5xx elevado;
- falha ou envelhecimento de backup;
- disco, CPU, memória e conexões do banco;
- alteração inesperada de arquivos/configuração;
- acesso direto à origem.

## 7. Pagamentos e comércio eletrônico

### 7.1 Situação positiva

- endpoint de produção do Asaas configurado;
- token de webhook presente;
- cofre criptográfico configurado;
- idempotência implementada;
- eventos persistidos;
- pagamentos de cliente usam, em grande parte, fatura hospedada pelo Asaas;
- vendas que reservam estoque priorizam PIX, reduzindo retenção prolongada por boleto.

### 7.2 Reconciliação automática desativada

O worker de reconciliação não estava habilitado. Webhook perdido pode deixar cobrança e pedido divergentes até uma sincronização manual.

Deve-se habilitar a reconciliação depois de homologar:

- paginação e volume;
- limites do Asaas;
- duplicidade;
- reprocessamento;
- atraso e indisponibilidade;
- alertas de divergência.

### 7.3 Mudança de plano antes do pagamento

O painel altera o plano localmente e tenta sincronizar o gateway em seguida. Em caso de falha, os recursos podem continuar liberados sem confirmação financeira.

Referências técnicas:

- `frontend/src/features/platform/MyPlan.jsx`
- `backend/src/routes/payments.js`
- `backend/src/routes/billing.js`

Fluxo recomendado:

```text
solicitação → cobrança pendente → confirmação do gateway → ativação do plano
```

Também devem existir regras para prorrata, downgrade, cancelamento, inadimplência, período de tolerância, retry e compensação.

### 7.4 Checkout público inconsistente

O catálogo apresenta PIX, dinheiro, crédito e débito, mas o backend pode gerar apenas cobrança PIX quando há reserva de estoque. A tela de sucesso também não apresenta de forma confiável o caminho de pagamento.

Deve-se alinhar interface, pedido e gateway:

- apresentar somente métodos realmente disponíveis;
- não confirmar venda paga antes da confirmação do gateway;
- exibir QR Code/link/linha digitável conforme o método;
- expirar e liberar estoque automaticamente;
- substituir ID sequencial público por token aleatório, limitado e expirável;
- garantir idempotência também no início da criação da cobrança.

### 7.5 Matriz de homologação

Antes do lançamento, testar no mínimo:

| Método/situação | Casos obrigatórios |
| --- | --- |
| PIX | criação, pagamento, expiração, estorno e webhook perdido. |
| Boleto | emissão, vencimento, atraso, cancelamento e pagamento posterior. |
| Cartão | aprovado, recusado, timeout, duplicidade, estorno e chargeback. |
| Assinatura SaaS | upgrade, downgrade, prorrata, inadimplência, retry e cancelamento. |
| Integração | webhook duplicado/fora de ordem, falha depois do POST e reconciliação. |

### 7.6 Direito do consumidor

O checkout e os termos devem ser revisados conforme o [Decreto nº 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), incluindo:

- razão social/nome, CNPJ, endereço e contato do fornecedor;
- características essenciais, disponibilidade e restrições;
- preço total, frete e despesas adicionais;
- método de pagamento e prazo de entrega;
- resumo e correção antes da confirmação;
- confirmação imediata e cópia durável;
- atendimento eletrônico;
- cancelamento, arrependimento e estorno;
- segurança do pagamento.

Os termos do SaaS também precisam disciplinar preço, renovação, cancelamento, inadimplência, suporte, SLA, disponibilidade, devolução dos dados e encerramento da conta.

## 8. Deploy, migrations e atualização de versão

### 8.1 Situação atual

O fluxo existente possui backup prévio, serialização, aplicação do schema antes do listen, healthcheck posterior e imagem anterior da API. A primeira remediação também prepara o frontend fora do diretório ativo, exige `/api/health/db` e faz a troca de diretório somente depois da API saudável. Ainda assim:

- push em `main` pode iniciar deploy de produção;
- não há staging/canário comprovado;
- build ocorre no host de produção;
- migrations são representadas por grandes arquivos idempotentes de schema;
- não há ledger geral com versão e checksum;
- tenants são migrados em sequência, permitindo estado parcial;
- rollback pode voltar API e frontend anterior, mas não é disparado automaticamente;
- banco e configuração não retornam automaticamente;
- o healthcheck comprova API e banco, mas não R2, gateway ou versão de migration.

Referências técnicas:

- `scripts/deploy.sh`
- `backend/src/services/tenants.js`
- `backend/src/db/schema.sql`
- `backend/src/db/platformSchema.sql`

### 8.2 Modelo recomendado de migration

Adotar arquivos incrementais e imutáveis:

```text
migrations/
  202608130001_create_example.sql
  202608130002_backfill_example.sql
```

Cada execução deve registrar:

- identificador/versão;
- checksum;
- horário inicial e final;
- tenant ou plataforma;
- release responsável;
- resultado e erro;
- operador/job.

Regras:

- migrations forward-only;
- `lock_timeout` e `statement_timeout` explícitos;
- alterações expand/contract compatíveis com versão anterior e seguinte;
- backfills grandes fora de transação bloqueante e em lotes;
- nunca remover coluna no mesmo release em que o código deixa de usá-la;
- testar em cópia anonimizada e com volume semelhante ao real;
- interromper o tráfego ou usar estratégia compatível quando a mudança não puder ser online.

### 8.3 Pipeline de release recomendado

```text
commit/PR
  → testes, lint e auditorias
  → imagem e frontend imutáveis
  → staging
  → teste de migration e smoke test
  → aprovação de produção
  → backup validado
  → migration dedicada
  → troca atômica/blue-green
  → healthcheck profundo
  → monitoramento e rollback automático
```

O frontend deve ser publicado em diretório versionado e ativado por symlink/troca atômica. A API deve usar imagem gerada no CI, identificada por digest e preferencialmente assinada.

### 8.4 Rollback

Para cada release, documentar:

- quais versões de API funcionam com cada versão do banco;
- como reverter frontend;
- quando rollback da aplicação é seguro;
- quando é necessário forward-fix;
- como restaurar banco sem perder operações posteriores;
- responsáveis, comandos validados e critérios de decisão.

Rollback de banco não deve depender simplesmente de restaurar um dump, pois isso pode apagar agendamentos e pagamentos realizados depois do backup.

### 8.5 Healthchecks

Separar:

- **liveness:** processo está vivo;
- **readiness:** API consegue operar com banco e versão de schema esperada;
- **dependency health:** R2, fila, Asaas e serviços externos, sem bloquear todo o sistema desnecessariamente.

O deploy deve verificar ao menos login técnico seguro, consulta de banco, versão de migration e uma rota crítica sem efeitos colaterais.

## 9. Continuidade e disponibilidade

O ambiente atual concentra Aura, outros sistemas e PostgreSQL em um único servidor. Isso cria ponto único de falha e amplia o impacto de comprometimento de outro serviço.

### Requisitos mínimos

- separar ambientes e credenciais;
- banco e arquivos com cópia externa;
- monitoramento externo de disponibilidade;
- alerta de backup por falha e por idade da última cópia;
- alerta de disco, memória, CPU, conexões, locks e latência;
- runbook para queda de host, banco e R2;
- inventário de dependências e contatos;
- restauração completa periódica;
- pessoa de plantão e escalonamento definido.

### Metas que precisam ser decididas

- **RPO:** quanto dado pode ser perdido;
- **RTO:** quanto tempo o serviço pode ficar indisponível;
- retenção de backups;
- tempo de resposta a incidentes;
- disponibilidade prometida ao cliente;
- janela e comunicação de manutenção.

## 10. Segurança do ciclo de desenvolvimento

O pipeline deve tornar obrigatórios:

- lint sem erros;
- testes de backend e frontend;
- typecheck e build;
- SAST;
- detecção de secrets;
- auditoria de dependências;
- scan de imagem/container e Dockerfile;
- SBOM por release;
- DAST no staging;
- proteção de branch e revisão obrigatória;
- ambiente GitHub de produção com aprovação;
- actions fixadas por SHA, não somente tag mutável;
- host SSH conhecido fixado, evitando `accept-new` em produção;
- artefatos imutáveis e rastreáveis.

Critérios de exceção devem exigir responsável, justificativa, prazo e ticket de correção. Recomenda-se usar o [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) nível 2 como baseline de verificação.

## 11. Plano de ação priorizado

### Fase 0 — Contenção imediata

- [ ] Rotacionar a credencial SSH exposta.
- [ ] Desabilitar login root e autenticação SSH por senha.
- [ ] Corrigir o backup de `aura_clinic` e executar restauração comprovada.
- [ ] Bloquear acesso direto à origem e fechar a porta pública de métricas.
- [ ] Aplicar atualizações do host e reiniciar em janela controlada.
- [ ] Publicar e comprovar a versão que desabilita cartão/CVV (código pronto).
- [ ] Publicar e comprovar o RBAC de termos/pós-atendimento (código e testes prontos).

### Fase 1 — Proteção de dados e acesso

- [ ] Implementar sessões revogáveis e MFA.
- [ ] Adicionar CSP e demais headers no frontend.
- [ ] Implementar trilha de leitura/download/exportação.
- [ ] Criar matriz de RBAC e testes negativos.
- [ ] Proteger endpoints públicos contra bot e abuso.
- [ ] Implementar retenção e exclusão completa no banco, R2 e fornecedores.
- [ ] Corrigir o fluxo e evidência de termos, inclusive para menores.

### Fase 2 — LGPD e contratos

- [ ] Criar inventário e registro de operações.
- [ ] Definir bases legais por finalidade.
- [ ] Elaborar RIPD.
- [ ] Publicar política de privacidade completa e versionada.
- [ ] Formalizar DPA com clínicas e contratos de subprocessadores.
- [ ] Criar canal e procedimento de direitos dos titulares.
- [ ] Criar plano e playbooks de incidentes.
- [ ] Revisar transferências internacionais e uso de IA.
- [ ] Revisar tudo com especialista em LGPD e direito do consumidor.

### Fase 3 — Pagamentos

- [ ] Corrigir a máquina de estados de assinatura.
- [ ] Ativar e monitorar reconciliação.
- [ ] Corrigir métodos e conclusão do checkout público.
- [ ] Trocar IDs públicos por tokens aleatórios e expirados.
- [ ] Implementar cancelamento, reembolso e chargeback.
- [ ] Homologar a matriz completa no sandbox e em produção controlada.
- [ ] Completar informações obrigatórias do comércio eletrônico.

### Fase 4 — Release e operação

- [ ] Criar staging representativo.
- [ ] Implementar migrations versionadas com ledger/checksum.
- [ ] Tornar frontend e backend artefatos imutáveis.
- [ ] Implantar troca atômica ou blue-green.
- [ ] Exigir aprovação de produção.
- [ ] Implementar healthchecks profundos e rollback automático.
- [ ] Centralizar logs e alertas.
- [ ] Criar SBOM, scans e política de dependências.

### Fase 5 — Validação independente

- [ ] Pentest externo autenticado e não autenticado.
- [ ] Teste de isolamento multi-tenant específico.
- [ ] Exercício de incidente.
- [ ] Exercício de disaster recovery.
- [ ] Revisão jurídica final.
- [ ] Aprovação formal de segurança, privacidade, produto e operação.

## 12. Critérios objetivos de GO-LIVE

O lançamento somente deve ser aprovado quando todos os critérios abaixo estiverem atendidos:

- [ ] backup off-site de `aura_clinic` funcionando e restauração completa comprovada;
- [ ] recuperação dos objetos privados do R2 comprovada;
- [ ] origem inacessível fora do Cloudflare;
- [ ] SSH sem root/senha e containers sem root;
- [ ] MFA obrigatório para acessos privilegiados;
- [ ] sessões revogáveis e de curta duração;
- [ ] RBAC clínico testado no backend;
- [ ] nenhuma vulnerabilidade crítica ou alta pendente sem aceite formal e prazo curto;
- [ ] pentest sem achados críticos/altos abertos;
- [ ] política, termos, DPA, RIPD, bases legais e retenção aprovados;
- [ ] direitos dos titulares operacionais e testados;
- [ ] pagamentos homologados em sucesso e falha;
- [ ] endpoint de cartão bruto removido ou conformidade PCI comprovada;
- [ ] reconciliação financeira monitorada;
- [ ] migrations e rollback ensaiados em cenário representativo;
- [ ] deploy atômico e staging operacional;
- [ ] alertas, on-call e plano de incidentes testados;
- [ ] simulação de recuperação de desastre concluída dentro do RPO/RTO.

## 13. Decisão e governança de risco

Até o encerramento dos P0, a recomendação é:

- não divulgar o produto como plenamente pronto para produção;
- não ampliar onboarding de clínicas com pacientes reais;
- não processar cartão diretamente no backend;
- não habilitar IA com dados clínicos identificáveis;
- limitar eventual piloto a participantes informados e volume controlado;
- registrar formalmente qualquer risco temporariamente aceito, com responsável e prazo.

Depois das correções, a decisão de lançamento deve ser registrada em ata/checklist com aprovação de produto, engenharia, segurança, operação e jurídico/privacidade.

## 14. Referências oficiais

- [Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [Direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares)
- [Relatório de Impacto à Proteção de Dados Pessoais — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)
- [Comunicação de Incidente de Segurança — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [Resolução CD/ANPD nº 19/2024 — Transferência internacional](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024)
- [ECA Digital — ANPD](https://www.gov.br/anpd/pt-br/assuntos/eca-digital)
- [Decreto nº 7.962/2013 — Comércio eletrônico](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm)
- [PCI DSS no Asaas](https://docs.asaas.com/docs/pci-dss-1)
- [PCI Security Standards Council](https://www.pcisecuritystandards.org/standards/pci-dss/)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)

## 15. Manutenção deste documento

Este relatório é um artefato vivo. Para cada item concluído:

1. vincular o PR ou commit;
2. anexar evidência de teste;
3. registrar data e responsável;
4. atualizar a caixa de seleção;
5. reavaliar risco residual;
6. repetir verificações de produção afetadas.

Uma mudança no código não encerra automaticamente um risco. O item somente deve ser marcado como concluído depois de implantado e verificado no ambiente de produção.
