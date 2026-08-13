# Plano de correção: código, infraestrutura e operação

> **Atualizado em:** 13 de agosto de 2026  
> **Objetivo:** separar o que já foi corrigido no repositório, o que ainda exige
> desenvolvimento e o que só pode ser concluído com configuração externa,
> processo operacional ou validação jurídica.  
> **Importante:** “implementado” significa presente no código local. O controle
> só protege produção depois de revisão, merge, deploy, aplicação do schema e
> validação pós-deploy.

Este documento é o plano executável da auditoria
[PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md](./PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md).
A auditoria define o risco e os critérios de liberação; aqui está a divisão de
responsabilidade e a ordem prática do trabalho.

## 1. Correções já feitas no código

| Tema | Mudança no repositório | Efeito | Para concluir |
| --- | --- | --- | --- |
| Acesso clínico | Termos digitais e pós-atendimento agora exigem `admin` ou `piercer`, com testes negativos para recepção e financeiro. | Reduz exposição de dado de saúde por papel excessivo. | Deploy e teste de aceitação com os quatro papéis. |
| Revogação de sessão | Tokens carregam `session_version`; troca de senha ou papel invalida tokens anteriores. A troca da própria senha devolve um token novo. | Fecha sessões antigas após eventos críticos. | O deploy causará logout único dos tokens antigos. MFA, sessões por dispositivo e cookie seguro continuam no backlog. |
| Cartão/PCI | Billing da plataforma aceita somente checkout hospedado (`UNDEFINED`) e rejeita número, titular, CVV e `CREDIT_CARD`. | Dados brutos de cartão deixam de atravessar a Aura e o escopo PCI é reduzido. | Homologar o checkout hospedado no sandbox e confirmar o enquadramento PCI com adquirente/especialista. |
| Idempotência financeira | Todo checkout exige `Idempotency-Key`; a chave e o hash do corpo são persistidos com unicidade no PostgreSQL. | Evita assinatura/cobrança duplicada entre processos e em repetição de rede. | Monitorar conflitos e expiração das chaves em produção. |
| Troca de plano | Self-service só altera plano durante trial e sem assinatura recorrente. Uma assinatura existente retorna `409` e segue para suporte. | Evita liberar recurso sem ajustar preço, prorrata e recorrência. | Definir política comercial de upgrade/downgrade e automatizar prorrata em fase posterior. |
| Cobrança pública | Endpoints públicos usam `public_token` UUID, não o ID serial interno, e devolvem resposta mínima. | Reduz enumeração de cobranças. | Avaliar expiração/rotação do token conforme o ciclo de retenção. |
| Menores | Termo de menor exige nome, documento e assinatura separada do responsável; o PDF registra essas evidências. | Melhora prova de consentimento/ciência do responsável. | Revisão jurídica do texto, regras de idade e fluxo de revogação. |
| IA | Contexto e instrução enviados ao provedor são minimizados/redigidos; resumo de cliente exige `admin` ou `piercer`. | Reduz envio incidental de identificadores e limita acesso clínico. | Contrato/DPA, região, retenção do provedor, opt-out e testes de DLP continuam externos/híbridos. |
| Telemetria pública | Ingestão de erros tem rate limit, ignora e-mail informado pelo cliente e redige segredos/identificadores. | Reduz abuso, vazamento em logs e crescimento descontrolado. | Configurar retenção, alerta e destino centralizado. |
| IP/proxy | O backend não confia diretamente em `CF-Connecting-IP`; usa o IP resolvido pelo Express. | Impede spoofing simples do cabeçalho quando a cadeia de proxy é correta. | Bloquear acesso direto à origem e definir `trust proxy` de acordo com a topologia real. |
| Container | API executa como usuário `node`, com arquivos copiados sob essa propriedade. | Reduz impacto de comprometimento do processo. | Rebuild da imagem, scan e validação de permissões de volumes. |
| Deploy | Frontend é preparado em diretório novo, a API precisa passar em `/api/health/db` e a troca do frontend é atômica, com diretório anterior para rollback. | Evita publicar frontend incompatível antes da API/banco e melhora recuperação. | Staging, artefato imutável, rollback de banco e automação blue-green ainda faltam. |
| Qualidade | Erros de lint foram eliminados e o CI voltou a bloquear erro de lint. | Evita acumular novas falhas silenciosas. | Reduzir os avisos remanescentes por módulo, sem bloquear hotfix legítimo. |

## 2. Backlog que depende principalmente de código

Estes itens podem ser desenvolvidos no repositório, mas não foram tratados como
uma mudança pequena porque alteram autenticação, modelo de retenção ou fluxos de
produto. Devem entrar em entregas próprias, com migration e plano de rollback.

### Prioridade alta

- substituir o token de 12 horas em `localStorage` por sessão curta, cookie
  `HttpOnly`, `Secure` e `SameSite`, refresh rotativo e proteção CSRF;
- implementar MFA obrigatório para super-admin e administradores de clínica;
- persistir sessões por dispositivo, listar atividade e permitir revogação
  individual ou global;
- criar trilha de auditoria de leitura, download e exportação de prontuários,
  termos, fotos e arquivos privados;
- criar retenção e eliminação orquestrada no PostgreSQL, R2, logs, backups e
  fornecedores, com fila, comprovante e exceção por obrigação legal;
- implementar expiração/rotação dos tokens públicos de cobrança;
- completar cancelamento, estorno, chargeback e conciliação do cliente final;
- versionar migrations com ledger, checksum, estado `pending/applied/failed`,
  compatibilidade progressiva e comando de verificação;
- adicionar testes de integração para upload malicioso, IDOR, concorrência,
  isolamento multi-tenant e todas as negações da matriz de papéis;
- aplicar limites de paginação, tamanho de payload e tempo de execução em todas
  as listagens e exportações pesadas.

### Otimização de aplicação

- medir consultas lentas com `pg_stat_statements` e `EXPLAIN (ANALYZE, BUFFERS)`
  antes de criar índices; priorizar dashboard, agenda, catálogo e financeiro;
- tirar geração pesada de PDF/XLSX, importações e reconciliação do ciclo HTTP,
  usando jobs idempotentes com tentativas e dead-letter queue;
- introduzir cache somente para dados públicos/versionados, com chave contendo
  tenant e versão publicada; nunca compartilhar cache de prontuário;
- paginar e transmitir exportações grandes em vez de montar tudo em memória;
- adicionar orçamento de bundle e lazy loading por módulo no frontend;
- instrumentar latência p50/p95/p99, taxa de erro, saturação do pool, fila e
  consultas lentas antes de decidir escala ou cache.

## 3. Itens híbridos: código mais configuração/deploy

Uma metade pode ser preparada no repositório, mas a evidência de conclusão vem
do ambiente implantado.

| Controle | Parte no código | Parte externa necessária |
| --- | --- | --- |
| Headers do frontend | Definir política e remover incompatibilidades com CSP. | Ativar CSP inicialmente em report-only, depois enforcement, HSTS, `frame-ancestors`, `nosniff`, Referrer e Permissions Policy no Cloudflare/Nginx. |
| Cadeia de proxy | Express usa o IP resolvido nos rate limits, sem confiar diretamente em `CF-Connecting-IP`. | Origem acessível só pelo Cloudflare e `trust proxy` exato para os saltos/rede reais. |
| Reconciliação Asaas | Worker e rotas de sincronização existem. | Habilitar agenda/worker, credenciais, alertas e runbook; validar no sandbox e em produção controlada. |
| Uploads privados | Validação, metadados privados e abstração R2 existem. | Bucket privado, IAM mínimo, CORS, lifecycle, criptografia, varredura antimalware e restauração testada. |
| Observabilidade | Logs estruturados e healthcheck existem parcialmente. | Coletor externo, retenção, mascaramento, métricas, tracing, alertas e plantão. |
| Dependências/container | CI pode executar lint, testes, build e scans. | Renovabot/Dependabot, registry privado, assinatura de imagem, SBOM, política de SLA e bloqueio por severidade. |
| Deploy seguro | Script valida banco e troca frontend atomicamente. | Staging equivalente, approval, segredo no cofre, artefato imutável, canário/blue-green e rollback exercitado. |
| Backup | Scripts podem gerar e verificar dump. | Corrigir banco-alvo, destino off-site imutável, backup do R2, criptografia e restauração completa cronometrada. |

## 4. Itens externos ao código

### Infraestrutura e acesso

- remover login SSH de `root` por senha, trocar a credencial já compartilhada,
  exigir chave individual, usuário nominal, `sudo`, MFA/VPN quando disponível e
  registrar acessos;
- bloquear a origem para aceitar HTTP/HTTPS somente do Cloudflare e restringir
  SSH a VPN ou allowlist administrativa;
- separar workloads e bancos quando o host compartilhado ampliar o raio de
  impacto; aplicar firewall, atualizações automáticas de segurança e hardening;
- guardar segredos em cofre, rotacionar os já expostos e eliminar credenciais de
  documentos, chats, shell history, logs e imagens;
- contratar/validar monitoramento, domínio, certificados, DNSSEC e proteção de
  conta do provedor com MFA.

### LGPD, jurídico e operação

- definir controlador, operador, subprocessadores, bases legais e finalidade de
  cada tratamento; manter registro das operações;
- concluir RIPD para dados de saúde, menores, fotos, IA e monitoramento;
- publicar Política de Privacidade e Termos versionados, com aceite comprovável;
- formalizar DPA com clínicas e contratos dos subprocessadores, inclusive
  transferência internacional e prazo de notificação;
- definir retenção legal por categoria com jurídico e responsáveis do negócio;
- estabelecer canal de direitos do titular, autenticação do solicitante, SLA,
  fluxo de exportação/correção/eliminação e evidências;
- manter plano de resposta a incidentes, critérios de comunicação à ANPD e aos
  titulares, contatos, modelos e exercícios;
- revisar textos de consentimento, responsável por menor, uso de imagem,
  política de cancelamento, preço, atendimento e comércio eletrônico;
- executar pentest independente, revisão jurídica e exercício de disaster
  recovery antes do lançamento amplo.

## 5. Processo de release recomendado

1. Abrir mudança com risco, migration, compatibilidade e rollback descritos.
2. CI obrigatório: lint sem erros, typecheck, testes backend/frontend, build,
   scan de segredo, dependência, SAST e imagem.
3. Aplicar a versão em staging com cópia anonimizada ou dados sintéticos.
4. Fazer backup verificado e confirmar capacidade disponível antes de produção.
5. Aplicar migration compatível com versão anterior; só depois trocar a API.
6. Validar `/api/health/db`, login, isolamento, cobrança, arquivos e fluxo
   clínico crítico; então ativar o frontend.
7. Observar métricas, erros e filas por uma janela definida. Reverter o artefato
   se o critério de erro for ultrapassado; migration destrutiva não entra no
   mesmo release que a remoção do código antigo.
8. Registrar quem aprovou, horário, versão, migrations, evidências e resultado.

Para migrations destrutivas, usar **expand/contract**: adicionar a estrutura,
publicar código compatível, migrar/backfill, verificar, parar de escrever no
legado e somente em uma versão posterior remover coluna/tabela.

## 6. Critério de encerramento por tipo

- **Código:** revisão aprovada, testes cobrindo sucesso e negação, migration
  compatível, documentação e rollback definidos.
- **Híbrido:** item de código concluído **e** evidência do controle ativo em
  staging/produção, com alerta e responsável.
- **Externo:** documento/contrato/configuração aprovado, proprietário e data de
  revisão definidos, além de exercício ou evidência quando aplicável.

Nenhum item deve ser marcado como concluído apenas porque existe uma variável de
ambiente ou trecho de código. Para o GO-LIVE valem evidências do ambiente real e
os critérios da auditoria principal.
