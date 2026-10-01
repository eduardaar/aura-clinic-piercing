# Estado atual do projeto

> Situação em **01/10/2026**: código até o commit `fdde35fd` (22/09/2026) mais a entrega de 01/10 (seção 9 — descontos, ajustes de valor, indicador químico, comissões e revisão da Central de Relatórios).
>
> Nesta revisão nenhum teste foi reexecutado: as linhas novas foram conferidas lendo o código e os arquivos de teste em `fdde35fd`. Os resultados da seção 6 continuam com a data em que foram medidos.
>
> Este documento existe para responder uma pergunta só: **o que já está feito e o que ainda não está.** Ele não propõe roadmap nem assume compromisso de produto — para isso, use [IDEIAS.md](./IDEIAS.md). Quando o código e este documento discordarem, o código vence: registre a correção aqui.

## Como ler

| Marca | Significado |
| --- | --- |
| **Entregue** | Existe no código, tem teste ou evidência de homologação, e pode ser exercitado hoje. |
| **Entregue (sem teste dedicado)** | Existe no código e pode ser exercitado hoje, mas não há teste automatizado do comportamento (no máximo, a conferência do SQL da migration em `migrations.test.mjs`) nem evidência de homologação registrada. |
| **Parcial** | O caminho principal funciona, mas há um recorte declarado que não foi feito. |
| **Pendente** | Não existe. Não há código a exercitar. |
| **Não validado** | Existe no código, mas nunca foi exercitado contra o serviço externo real. |

---

## 1. Plataforma e isolamento

| Item | Situação | Evidência |
| --- | --- | --- |
| Multi-tenancy por schema Postgres | **Entregue** | `middleware/withDb.js`; `scripts/test-isolation.mjs` (9 checagens, incluindo token cruzado, suspensão e 30 requisições alternadas sem vazamento de pool) |
| Provisionamento e desprovisionamento de clínica | **Entregue** | `services/tenants.js`; clínica nova nasce com `schema.sql` + todas as migrations de tenant na mesma transação |
| Migrations versionadas com ledger e checksum | **Entregue** | `src/db/migrations/` (platform `0001`–`0008`; tenant `0001`–`0042`, sem `0026` e `0027`, que nunca existiram); CLI `npm --prefix backend run migrations:apply` |
| Painel de super-admin | **Entregue** | `routes/platform.js`, `features/platform/PlatformAdmin.jsx` |
| Cadastro público de clínica | **Entregue** | `POST /api/signup`, com verificação de disponibilidade de nome e e-mail antes do aceite; exige plano existente (`plano_obrigatorio`) e aceite das versões vigentes dos documentos legais (`legal_acceptance_required`) |

**Cuidado operacional já documentado:** `RUN_DATABASE_MIGRATIONS=false` (ou `SKIP_DATABASE_BOOTSTRAP=true`) desliga o bootstrap inteiro no boot. Num banco vazio isso significa **nenhum schema `platform` e nenhum superadmin** — a API sobe, responde `/api/health`, e nada mais funciona. Ver [ARQUITETURA.md](./ARQUITETURA.md), seção "Boot do servidor".

## 2. Acesso e sessão

| Item | Situação | Evidência |
| --- | --- | --- |
| Access token curto + refresh em cookie `HttpOnly` | **Entregue** | `services/sessions.js` (15 min e 30 dias); `user_sessions` guarda o hash do refresh |
| Sessão revogável (logout, listar, encerrar todas) | **Entregue** | `routes/auth.js`; `POST /api/account/sessions/revoke-all` |
| MFA por TOTP | **Entregue** | `services/totp.js`; segredo cifrado em repouso |
| Papéis mais permissões granulares por usuário | **Entregue** | `services/permissionService.js`; tabela `user_permissions` (migration `0003`) |
| Perfis de acesso reutilizáveis | **Entregue** | migration `0017` (`access_profiles`, `access_profile_permissions`); `routes/accessProfiles.js`; perfil ativo substitui as permissões do cargo e as exceções por usuário continuam valendo; login e refresh devolvem `permissions` já resolvidas; `accessProfilesAudit.test.mjs` |
| Auditoria central | **Entregue** | `audit_events` (migration `0017`); `services/audit.js` troca chaves sensíveis por `[REDACTED]`; `GET /api/audit-events[/:id]` com `audit.view`; tela Auditoria (`/app/auditoria`); registra usuários e perfis, agenda, clientes, compras, vendas, fornecedores, estoque, financeiro, termos digitais e exportação de relatórios |
| Auditoria de acessos e bloqueios de login | **Entregue (sem teste dedicado)** | `routes/auth.js` grava em `audit_events` as ações `login`, `login_failed`, `login_blocked` (usuário inativo), `mfa_failed` e `password_reset` |
| Recuperação de senha por link de uso único | **Entregue (sem teste dedicado)** | migration `0029` (`password_reset_tokens`, só o hash); `POST /api/auth/forgot-password` (resposta sempre genérica, link válido por 30 minutos) e `POST /api/auth/reset-password` (senha com 12+ caracteres, incrementa `session_version` e revoga as sessões); o envio depende do e-mail transacional, ainda não validado (seção 5) |
| Gates de recurso por plano | **Entregue** | `services/planLimits.js`; `frontend/src/lib/permissions.js` |
| Proteção de login (bloqueio por IP, rate limit) | **Entregue** | `services/loginGuard.js`, `middleware/rateLimit.js` |
| Sessão encerrada quando a clínica deixa de ser válida | **Entregue** | erros de tenant têm códigos estáveis; `apiFetch` limpa a sessão em `tenant_mismatch`, `tenant_not_found` e `tenant_suspended`, sem confundir `403/404` comuns; 6 regressões em `apiSession.test.jsx` |

## 3. Operação da clínica

### Estoque, materiais e compras

| Item | Situação | Evidência |
| --- | --- | --- |
| Produtos com variações, SKU e imagens | **Entregue** | `routes/jewelry.js`; tabelas `jewelry_inventory`, `jewelry_variants`, `product_images` |
| Estoque unificado: produto e material no mesmo cadastro | **Entregue** | migration `0025_unified_inventory_items` (`48e5bfa1`, 30/08) apagou `consumables` e tabelas ligadas e removeu `/api/consumables*`; cada item de `jewelry_inventory` tem `can_sell`, `can_use_in_service`, `track_stock`, `track_lots` e `can_publish`. A tela Vendas só oferece item `can_sell` e o checkout público o exige; catálogo, agendamento e checkout públicos exigem `can_publish`. Tela Estoque com abas Todos os itens, Produtos para venda, Materiais de procedimento, Lotes e validades, Movimentações e Inteligência |
| Lotes com validade e baixa FEFO | **Entregue** | `inventory_item_lots`, `inventory_item_lot_allocations`; `POST /api/jewelry/:id/lots` recusa lote acima do saldo ainda sem lote, com o item travado (trava recolocada em `c49b714c`, 31/08); FEFO no consumo automático e na saída manual |
| Saída acima do saldo recusada com `409` | **Entregue** | corrigido em `575b61a5` (falha F-02); antes usava `Math.max(0, …)` e gravava movimento maior que a baixa real |
| Painel de saúde do estoque | **Entregue** | `GET /api/inventory/health` |
| Compra confirmada gera estoque e contas a pagar, de forma idempotente | **Entregue** | `services/purchases.js`; exige `Idempotency-Key`; reenvio não duplica |
| Fornecedores com cadastro completo e homologação | **Entregue** | migration `0020_supplier_profiles`; `services/suppliers.js`; CPF/CNPJ repetido responde `409` (`routes/finance.js`); compra recusa fornecedor inativo ou bloqueado; tela Fornecedores (`/app/fornecedores`); `suppliers.unit.test.mjs` |
| Importação do XML da NF-e em Compras | **Entregue** | migrations `0022` e `0023`; `POST /api/purchases/nfe/preview` (`services/nfeImport.js`); NF-e já importada responde `409`; na conferência, a linha pode criar um item novo na mesma transação (`25edb281`); `nfeImport.unit.test.mjs` |

### Agenda e atendimento

| Item | Situação | Evidência |
| --- | --- | --- |
| Agenda, disponibilidade e bloqueios | **Entregue** | `routes/appointments.js`, `availability.js`, `scheduleBlocks.js` |
| Cadastro único de tipos de atendimento | **Entregue** | migration `0035`; `/api/services` recebe a ficha técnica (`inventory_items`) e as joias compatíveis; `/api/procedures` virou alias só de leitura (`Deprecation: true`; escritas respondem `410`); `crud.test.mjs` |
| Ficha técnica de materiais por serviço | **Entregue** | `GET/PUT /api/services/:id/inventory-items` (alias antigo `/consumables` mantido); tabela `service_inventory_recipes`; só aceita item com `can_use_in_service` |
| Consumo automático e reversível ao concluir | **Entregue** | `appointment_consumptions` (recriada na `0025`, por `inventory_item_id`) congela o que foi baixado; reabrir ou cancelar devolve exatamente aquilo |
| Execução do atendimento separada das vendas | **Entregue** | migration `0019` (`service_executions`, `service_execution_items`) e `0024` (campos clínicos); concluir chama `ensureServiceExecution` e gera recebíveis `source_type='service_execution'`; reabrir ou cancelar chama `cancelServiceExecution`; `GET /api/service-executions[/:id]`; a ordem de serviço legada em `sales_orders` saiu em `8584be9d`; `transactions.test.mjs` |
| Check-in e etapas operacionais | **Entregue (sem teste dedicado)** | migration `0030` (`arrived_at`, `started_at`, `no_show_at`); status `chegou`, `em_atendimento` e `nao_compareceu`; `POST /api/appointments/:id/cancel` aceita `outcome: 'no_show'` |
| Histórico de reagendamento | **Entregue (sem teste dedicado)** | migration `0034` (`appointment_reschedule_history`); `PATCH /api/appointments/:id` exige `reason` quando data ou horário mudam e grava o histórico na mesma transação |
| Regras por procedimento, checklist e biossegurança opcionais | **Entregue** | migrations `0032` e `0033`; `services/serviceRules.js`, `services/operationalRequirements.js`; `GET/PUT /api/service-operational-settings`; sem configuração nada bloqueia o atendimento; `serviceRules.test.mjs`, `operationalRequirements.test.mjs` |
| Lista de espera e salas e recursos | **Entregue (sem teste dedicado)** | migration `0036`; `routes/agendaOperations.js` (`/api/agenda/waitlist`, `/api/agenda/resources`); salas e recursos são só cadastro: nenhum agendamento é ligado a um recurso |
| Prontuário, termo digital e pós-atendimento | **Entregue** | `routes/clients.js`, `terms.js`, `postcare.js` |
| Termos digitais assinados pelo cliente (no estúdio ou por link) | **Entregue** | migration `0037`; `services/termRequests.js`; `routes/terms.js` (modelos, solicitações, `GET/POST /api/public/terms/:token`); página `/termo/<token>`; termo concluído é imutável por gatilho; 7 testes em `termRequests.test.mjs` |

### Clientes e gestão

| Item | Situação | Evidência |
| --- | --- | --- |
| Cadastro de cliente no padrão brasileiro e perfil 360 | **Entregue** | migrations `0021` e `0028`; `services/clientData.js` valida WhatsApp, CPF, CEP, UF e Instagram e devolve `field_errors`; perfil com abas Dados, Histórico e atendimentos, Termos digitais e Pós-atendimento; `clientsProfile.test.mjs` |
| Bloqueio de cadastro duplicado | **Entregue** | `POST /api/clients` e `PUT/PATCH /api/clients/:id` respondem `409` (`code: duplicate_client`) quando outro cliente não excluído tem o mesmo CPF, WhatsApp ou e-mail (e-mail sem diferenciar maiúsculas) |
| Mesclagem de clientes | **Entregue** | migration `0031`; `POST /api/clients/:id/merge` (`clients.delete`, motivo e confirmação `MESCLAR CLIENTES`); `services/clientMerge.js` move o histórico e anonimiza a origem; `clientMerge.test.mjs` |
| Central de relatórios e exportação | **Entregue** | `REPORT_CATALOG` em `services/reports.js`; `GET /api/reports` lista só o que cargo e plano liberam; `GET /api/reports/:type` exporta PDF, XLSX, CSV e TXT, com auditoria; `reports.unit.test.mjs`, `reports.test.mjs` |

### Reversões financeiras

| Item | Situação | Evidência |
| --- | --- | --- |
| Cancelamento de agenda com resolução explícita | **Entregue** | `POST /api/appointments/:id/cancel` com `no_payment`, `retain_deposit`, `client_credit` e `manual_refund`; `PATCH` direto para `cancelado` retorna `409` |
| Devolução de venda por item, com condição | **Entregue** | `POST /api/sales-orders/:id/returns`; só item `sellable` volta ao estoque; não deixa devolver mais do que foi vendido |
| Devolução **parcial** respeita a quantidade pedida | **Entregue** | corrigido em `575b61a5` (falha F-01); antes o espalhamento do item vendido sobrescrevia a quantidade e transformava devolução parcial em total |
| Crédito de cliente rastreável e consumível | **Entregue** | `client_credits` e `client_credit_usages`; aplicável em agenda e em venda |
| Reembolso manual gera despesa rastreável | **Entregue** | exige `refund_method`; conciliado na homologação |
| **Estorno pelo gateway** | **Pendente** | no cancelamento e na devolução o reembolso é manual. Existe `POST /api/payment-intents/:id/refund`, que pede ao Asaas o estorno total de uma cobrança e só marca `refunded` por webhook, mas nenhuma tela o chama e ele não está ligado a esses fluxos. O desenho aceito é: o estorno fica `solicitado` até o webhook confirmar, nunca marcado como devolvido por clique |
| **Histórico consolidado de devoluções na ficha da venda** | **Pendente** | os dados existem; falta a visualização |

## 4. Público e comercial

| Item | Situação | Evidência |
| --- | --- | --- |
| Catálogo público por clínica | **Entregue** | `routes/catalog.js`; expõe apenas nome, foto, categoria, material, tamanho, cor, preço e disponibilidade |
| Builder de catálogo versionado (rascunho, publicação, rollback) | **Entregue** | `catalog_customization_drafts` e `_revisions`; ver [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) |
| Agendamento e checkout públicos | **Entregue** | `routes/booking.js`; `POST /api/sales-orders/public` |
| Landing editável | **Entregue** | `routes/landing.js`; ver [LANDING.md](./LANDING.md) |
| Planos e assinatura da clínica | **Entregue** | o banco é a fonte da verdade (`platform.subscription_plans`); o código guarda só os planos-semente |
| Documentos legais versionados, notícias e manual do usuário | **Entregue** | migration platform `0008` (`legal_document_versions`, `content_articles`); `GET /api/news`, `/api/news/:slug` e `/api/manual` (`routes/contentHub.js`), edição pelo super-admin; `GET /api/platform/legal-documents/:key/versions`; páginas `/novidades`, `/termos-de-uso` e `/politica-de-privacidade` e menu Ajuda no app; `contentHub.test.mjs` |

## 5. Infraestrutura

| Item | Situação | Evidência |
| --- | --- | --- |
| Fila persistente de jobs | **Entregue** | `background_jobs`, `services/jobWorker.js`; ver [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md) |
| Upload otimizado, com conversão para WebP | **Entregue** | `middleware/upload.js`, commit `42d47784` |
| Armazenamento em Cloudflare R2 | **Não validado** | código pronto e testado com stub, **nunca exercitado contra um bucket real**. Fora de produção, com o R2 desligado, todas as clínicas gravam no mesmo diretório local; em produção o boot recusa subir sem o R2 completo (`config/index.js`) e o guard do deploy exige as seis `R2_*` (`b6045672`). O migrador de anexos (`scripts/migrate-uploads-to-r2.mjs`) ainda procura o schema como `tenant_<id>` e, desde a migration platform `0005`, pula as clínicas renomeadas: precisa ser corrigido antes de executar o runbook. Ver [R2.md](./R2.md) |
| Gateway de pagamento Asaas | **Não validado** | integração implementada, com cofre por clínica e webhook autenticado, **nunca exercitada contra o sandbox real**. Ver [ASAAS.md](./ASAAS.md) |
| E-mail transacional (SMTP com fallback Resend) | **Não validado** | SMTP genérico configurável no painel, senha cifrada e teste de conexão/envio; ainda não exercitado contra um servidor SMTP real. Resend permanece como fallback opcional. Sem SMTP ativo nem Resend, o link de recuperação de senha e os avisos de cobrança não são enviados (a resposta da recuperação continua genérica). Ver [SMTP.md](./SMTP.md) |
| WhatsApp Cloud API | **Parcial** | a configuração por clínica funciona e o token não é exposto (fica no mesmo cofre do Asaas e não é regravado sozinho quando `ASAAS_VAULT_KEY` é introduzida; ver [ASAAS.md](./ASAAS.md) §2); falta o produto (ver P-03) |
| Assistente de IA (OpenAI ou Gemini) | **Não validado** | `services/aiAssistant.js`, `routes/aiAssistant.js`; só as tarefas `draft_message`, `summarize_client` e `suggest_reply`, com reserva de 1 crédito do canal `ai` por chamada; não há no repositório registro de execução contra os provedores reais |

## 6. Qualidade

| Camada | Resultado | Quando |
| --- | --- | --- |
| Suíte backend | 546/546 em 104 s, 60 arquivos de teste | reexecutada em 30/08; inclui cofre e rotas SMTP; runner isolado de `RUN_MIGRATIONS_ON_BOOT` local |
| Homologação crítica ponta a ponta | 123/123 (`scripts/qa-homologation-critical.mjs`) | 27/08, tenant novo, após as correções. O script ainda chama `/api/consumables` (removida em `48e5bfa1`) e precisa ser atualizado antes de rodar de novo |
| Frontend unitário e de componentes | 33/33 e 111/111 em 16 arquivos | reexecutados em 30/08 |
| Build do frontend | aprovado, 1.794 módulos | reexecutado em 30/08 |

Nenhuma dessas camadas foi reexecutada desde então. Contagem estática em `fdde35fd`, sem reexecução: 73 arquivos `*.test.mjs` em `backend/tests` e 38 arquivos de teste em `frontend/tests`. O resultado dos arquivos criados depois de 30/08 não foi medido nesta revisão.

Relatório completo, com as sete falhas encontradas e corrigidas: [RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md](./RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md).

---

## 7. Ajustes de 12/09/2026 (relatório de resolução de problemas)

| Item | Situação | Evidência |
| --- | --- | --- |
| Usuário perdia acesso ("Credenciais inválidas") após alteração de permissões | **Corrigido** | o login comparava o e-mail com a grafia exata e a edição administrativa gravava em minúsculas; `POST /api/login` passou a comparar sem diferenciar maiúsculas. `loginEmailCase.test.mjs` cobre conta legada com maiúsculas editada pelo admin |
| Modais fechando com clique fora e perdendo dados | **Corrigido** | `Modal` não fecha mais no clique fora; com formulário alterado, X, Esc e Cancelar pedem confirmação (Salvar, Sair sem salvar, Continuar editando). `ModalGuard.test.jsx` |
| Seleção de joias no atendimento | **Corrigido** | a lista usava variáveis CSS inexistentes (ficava transparente) e, dentro do modal, não recebia clique (Radix); agora monta dentro do diálogo, com fundo, e no celular vira folha inferior com campo de busca próprio. `SmartCombobox.test.jsx` |
| Cargo Financeiro exigia permissões manuais | **Corrigido** | o backend devolve `permissions` resolvidas no login/refresh (cargo ou perfil + exceções) e o frontend usa essa lista; Financeiro ganhou relatórios completos e cupons no padrão. `rbac.test.mjs`, `sessionPermissions.test.mjs` |
| Experiência no celular | **Corrigido (rodada 1)** | busca das listas ocupava meia tela (`flex-basis` em coluna), indicadores em coluna única, seletor de visão da agenda cortado, etapas dos formulários cortadas, abas do perfil sem quebra; viewport com `interactive-widget=resizes-content`. Validado por capturas em 360/390/430 px |
| Termos digitais presenciais e por link | **Entregue** | ver seção 3 |

Pendência operacional: as migrations de produção não são aplicadas pelo deploy. Depois de publicar, rode o workflow "Aplicar migrations em produção" (inclui a `0037` e, desde 01/10, as `0038`–`0042`).

## 8. Ajustes de 22/09/2026 (commit `fdde35fd`)

| Item | Situação | Evidência |
| --- | --- | --- |
| Editar item de estoque sem fornecedor respondia `500` | **Corrigido** | o editor reenvia `supplier_id: null`, que virava `0` e violava a chave estrangeira; `foreignKeyValue()` em `routes/jewelry.js` grava vazio, zero ou valor não numérico como `NULL` na criação e na edição. Regressão em `crud.test.mjs` |
| Ruído na central de erros | **Corrigido** | `lib/errorReporter.js` descarta "ResizeObserver loop…"; falha de import dinâmico (chunk defasado por deploy) vai como aviso e recarrega o app uma vez (`reloadOnceForStaleChunk`, 60 s de espera contra laço), também pelo `AppErrorBoundary`; falha de rede do visitante vai como aviso. `errorReporter.test.js` |

## 9. Entrega de 01/10/2026 — agendamento, descontos, ajustes, biossegurança e comissões

| Item | Situação | Evidência |
| --- | --- | --- |
| Janela "Novo Agendamento" e "Detalhes do Agendamento" maiores | **Entregue** | `Modal size="workspace"` (`components/common/Crud.jsx`), única exceção à largura padrão; `styles/appointment-workspace.css` ocupa quase toda a altura no desktop e mantém tela cheia no celular |
| Desconto manual em agendamentos e vendas | **Entregue** | migrations `0038`/`0039`; `discount_value` segue como desconto total (cupom + manual); permissões `appointments.apply_discount` e `sales.apply_discount`; prévia oficial `POST /api/appointments/financial-preview` e cotação `POST /api/sales-orders/quote` com o mesmo cálculo da gravação; desconto rateado por item na venda e devolução pelo líquido |
| Ajuste de valor (acréscimo/abatimento) na finalização | **Entregue** | tabela `appointment_value_adjustments` (motivo, autor, data, líquido antes/depois, anulação com motivo, idempotência); `routes/appointmentValueAdjustments.js`; permissão `appointments.edit_final_value` (+ `finance.edit` após atendido) |
| Indicador químico por procedimento, com foto da etiqueta | **Entregue** | migration `0040`; `routes/chemicalIndicators.js`; foto em arquivo privado (`chemical_indicator`, exige `clinical_files.view`); histórico no atendimento e no perfil do cliente; relatório `chemical_indicators` |
| Comissões por profissional | **Entregue** | migration `0041`: regras por profissional (padrão de serviço, por serviço, produtos/joias; percentual ou valor fixo) e lançamentos imutáveis `commission_entries` gravados na finalização com bruto, desconto, ajuste e base rateados; `routes/commissions.js`; seção "Comissão" no cadastro do profissional e extrato em Financeiro → Comissões; plano Studio (`commissions`) |
| Central de Relatórios revisada | **Entregue** | comissões, profissionais, atendimentos, vendas, financeiro, serviços, pagamentos, cancelamentos e biossegurança reescritos sobre as fontes corretas; novos `chemical_indicators` e `value_adjustments`; exportação assíncrona com as mesmas permissões da tela; períodos em America/Sao_Paulo |
| Correções de integridade encontradas na revisão | **Entregue** | itens do agendamento com identidade estável (antes eram fundidos em um só); sinal não é mais apagado/recriado a cada salvamento; crédito aplicado entra no teto da finalização; ledger com mapeamento explícito de status; CSV financeiro sem dupla contagem; finalizar exige `appointments.finalize` |
| Segurança | **Entregue** | `/api/booking/config` e `/api/options` não expõem mais comissão, e-mail e telefone de profissionais; pedido/agendamento público não sobrescreve nem devolve dados de cliente existente; cupom público com contexto fechado |

Validação em 01/10/2026: 377/377 testes de backend nos 38 arquivos afetados, 304/304 testes de componentes e 65/65 unitários do frontend, typecheck e build aprovados. Não houve validação em navegador real.

**Pendências desta entrega:** a baixa de recebível feita em Contas a receber ainda não volta para o atendimento nem gera `payments` (decisão de produto: faturamento por caixa ou por ledger); a confirmação de sinal por intent marca como pago qualquer pagamento `sinal` do agendamento; o PDF de termo assinado segue a regra antiga de acesso por papel.

## Pendências abertas

### P-02 — taxonomia e duplicidades do estoque (M-05)

**Severidade: média, e cresce com o volume de dados.**

Três colunas ainda controlam a publicação do mesmo produto: `is_catalog_active`, `is_published` e `virtual_store_active`. A migration `0013` fez as três nascerem em zero, mas **não** as consolidou — continuam sendo três fontes de verdade para uma pergunta só ("este produto aparece na vitrine?"). O estoque unificado (`0025`) somou uma quarta marca, `can_publish`: catálogo e agendamento públicos exigem as quatro, o checkout público confere `can_publish`, `is_catalog_active` e `is_published` (não olha `virtual_store_active`), e o editor mostra dois controles ("Pode aparecer no catálogo" e "Visível no catálogo público").

Na mesma linha, `photo_url`, `image_url` e `gallery_urls` convivem com a tabela `product_images`.

Plano e ordem de execução em [ROADMAP-ESTOQUE-CATALOGO-AURA.md](./ROADMAP-ESTOQUE-CATALOGO-AURA.md). Até `fdde35fd`, nem o campo único de publicação nem a migração das imagens foram executados.

### P-03 — WhatsApp como produto Aura (M-04)

**Severidade: é uma decisão de produto, não um defeito.**

Hoje cada clínica configura a própria Cloud API. A carteira de créditos por clínica já existe (`services/communicationCredits.js`: franquia mensal por plano, reserva de 1 crédito antes de cada envio oficial, baixa no envio e liberação da reserva quando o envio falha), mas `POST /api/communication-credits/purchase` só registra a intenção de compra, sem cobrança. Falta o produto: cofre central da Aura, vínculo do número, compra efetiva de créditos e conciliação com o provedor.

Proposta em [PLANO-WHATSAPP-CREDITOS-AURA.md](./PLANO-WHATSAPP-CREDITOS-AURA.md) — **em revisão, sem decisão de fornecedor, preço ou lançamento.**

### P-04 — gates externos nunca exercitados

R2, Asaas e o envio SMTP estão implementados e testados localmente, mas **nunca rodaram contra o serviço externo real**. É o próximo gate antes de produção, e cada um precisa do seu próprio sandbox:

- R2: seguir o runbook de [R2.md](./R2.md) e migrar os anexos antigos;
- Asaas: sandbox próprio, com o webhook apontado e o mesmo token cadastrado nos dois lados;
- SMTP: conta real, remetente autorizado e roteiro de [SMTP.md](./SMTP.md); se o fallback Resend for mantido, domínio verificado e `EMAIL_FROM` real.

Enquanto isso não acontecer, trate qualquer afirmação sobre os três como "deve funcionar", não como "funciona".

O commit `8b00e0fe` (21/08) registra que os secrets do R2 já estavam configurados no GitHub Actions; não há no repositório registro de uso contra o bucket real.

### Resíduos do cutover de agosto

A clínica nova ainda nasce do `schema.sql` seguido das migrations (`services/tenants.js`; a `tenant/0001_baseline.sql` é só `SELECT 1`): a baseline por `pg_dump` não foi feita. Continuam também o alias de leitura `/api/procedures`, o alias `/api/services/:id/consumables` e o bloco de `consumables` no `schema.sql`. Lista com arquivo e linha na Fase 3 de [ROADMAP-LIMPEZA-LEGADO-POS-LANCAMENTO.md](./ROADMAP-LIMPEZA-LEGADO-POS-LANCAMENTO.md).

---

## O que este documento não cobre

- Preço, matriz comercial de planos e política de lançamento: são decisão de produto, e a documentação foi deliberadamente limpa deles. Não reintroduza como regra permanente sem decisão explícita.
- Roadmap. Ideias entram em [IDEIAS.md](./IDEIAS.md) no formato de descoberta, e só viram plano depois de problema, público, hipótese, custo e critério de sucesso definidos.
