# Estado atual do projeto

> Situação em **30/08/2026**, após a primeira rodada de testes e melhorias sobre a base `3d34c9b0`.
>
> Este documento existe para responder uma pergunta só: **o que já está feito e o que ainda não está.** Ele não propõe roadmap nem assume compromisso de produto — para isso, use [IDEIAS.md](./IDEIAS.md). Quando o código e este documento discordarem, o código vence: registre a correção aqui.

## Como ler

| Marca | Significado |
| --- | --- |
| **Entregue** | Existe no código, tem teste ou evidência de homologação, e pode ser exercitado hoje. |
| **Parcial** | O caminho principal funciona, mas há um recorte declarado que não foi feito. |
| **Pendente** | Não existe. Não há código a exercitar. |
| **Não validado** | Existe no código, mas nunca foi exercitado contra o serviço externo real. |

---

## 1. Plataforma e isolamento

| Item | Situação | Evidência |
| --- | --- | --- |
| Multi-tenancy por schema Postgres | **Entregue** | `middleware/withDb.js`; `scripts/test-isolation.mjs` (9 checagens, incluindo token cruzado, suspensão e 30 requisições alternadas sem vazamento de pool) |
| Provisionamento e desprovisionamento de clínica | **Entregue** | `services/tenants.js`; clínica nova nasce com `schema.sql` + todas as migrations de tenant na mesma transação |
| Migrations versionadas com ledger e checksum | **Entregue** | `src/db/migrations/` (platform `0001`–`0006`, tenant `0001`–`0016`); CLI `npm --prefix backend run migrations:apply` |
| Painel de super-admin | **Entregue** | `routes/platform.js`, `features/platform/PlatformAdmin.jsx` |
| Cadastro público de clínica | **Entregue** | `POST /api/signup`, com verificação de disponibilidade de nome e e-mail antes do aceite |

**Cuidado operacional já documentado:** `RUN_DATABASE_MIGRATIONS=false` (ou `SKIP_DATABASE_BOOTSTRAP=true`) desliga o bootstrap inteiro no boot. Num banco vazio isso significa **nenhum schema `platform` e nenhum superadmin** — a API sobe, responde `/api/health`, e nada mais funciona. Ver [ARQUITETURA.md](./ARQUITETURA.md), seção "Boot do servidor".

## 2. Acesso e sessão

| Item | Situação | Evidência |
| --- | --- | --- |
| Access token curto + refresh em cookie `HttpOnly` | **Entregue** | `services/sessions.js` (15 min e 30 dias); `user_sessions` guarda o hash do refresh |
| Sessão revogável (logout, listar, encerrar todas) | **Entregue** | `routes/auth.js`; `POST /api/account/sessions/revoke-all` |
| MFA por TOTP | **Entregue** | `services/totp.js`; segredo cifrado em repouso |
| Papéis mais permissões granulares por usuário | **Entregue** | `services/permissionService.js`; tabela `user_permissions` (migration `0003`) |
| Gates de recurso por plano | **Entregue** | `services/planLimits.js`; `frontend/src/lib/permissions.js` |
| Proteção de login (bloqueio por IP, rate limit) | **Entregue** | `services/loginGuard.js`, `middleware/rateLimit.js` |
| Sessão encerrada quando a clínica deixa de ser válida | **Entregue** | erros de tenant têm códigos estáveis; `apiFetch` limpa a sessão em `tenant_mismatch`, `tenant_not_found` e `tenant_suspended`, sem confundir `403/404` comuns; 6 regressões em `apiSession.test.jsx` |

## 3. Operação da clínica

### Estoque, materiais e compras

| Item | Situação | Evidência |
| --- | --- | --- |
| Produtos com variações, SKU e imagens | **Entregue** | `routes/jewelry.js`; tabelas `jewelry_inventory`, `jewelry_variants`, `product_images` |
| Materiais de consumo separados dos produtos de venda | **Entregue** | `routes/consumables.js` (migration `0012`); material não aparece em Vendas nem no catálogo |
| Lotes com validade e baixa FEFO | **Entregue** | `consumable_lots`, `consumable_lot_allocations`; a soma dos lotes nunca excede o saldo (invariante com lock) |
| Saída acima do saldo recusada com `409` | **Entregue** | corrigido em `575b61a5` (falha F-02); antes usava `Math.max(0, …)` e gravava movimento maior que a baixa real |
| Painel de saúde do estoque | **Entregue** | `GET /api/inventory/health` |
| Compra confirmada gera estoque e contas a pagar, de forma idempotente | **Entregue** | `services/purchases.js`; exige `Idempotency-Key`; reenvio não duplica |

### Agenda e atendimento

| Item | Situação | Evidência |
| --- | --- | --- |
| Agenda, disponibilidade e bloqueios | **Entregue** | `routes/appointments.js`, `availability.js`, `scheduleBlocks.js` |
| Ficha técnica de materiais por serviço | **Entregue** | `GET/PUT /api/services/:id/consumables` |
| Consumo automático e reversível ao concluir | **Entregue** | `appointment_consumptions` congela o que foi baixado; reabrir ou cancelar devolve exatamente aquilo |
| Prontuário, termo digital e pós-atendimento | **Entregue** | `routes/clients.js`, `terms.js`, `postcare.js` |

### Reversões financeiras

| Item | Situação | Evidência |
| --- | --- | --- |
| Cancelamento de agenda com resolução explícita | **Entregue** | `POST /api/appointments/:id/cancel` com `no_payment`, `retain_deposit`, `client_credit` e `manual_refund`; `PATCH` direto para `cancelado` retorna `409` |
| Devolução de venda por item, com condição | **Entregue** | `POST /api/sales-orders/:id/returns`; só item `sellable` volta ao estoque; não deixa devolver mais do que foi vendido |
| Devolução **parcial** respeita a quantidade pedida | **Entregue** | corrigido em `575b61a5` (falha F-01); antes o espalhamento do item vendido sobrescrevia a quantidade e transformava devolução parcial em total |
| Crédito de cliente rastreável e consumível | **Entregue** | `client_credits` e `client_credit_usages`; aplicável em agenda e em venda |
| Reembolso manual gera despesa rastreável | **Entregue** | exige `refund_method`; conciliado na homologação |
| **Estorno pelo gateway** | **Pendente** | hoje o reembolso é manual. O desenho aceito é: o estorno fica `solicitado` até o webhook confirmar, nunca marcado como devolvido por clique |
| **Histórico consolidado de devoluções na ficha da venda** | **Pendente** | os dados existem; falta a visualização |

## 4. Público e comercial

| Item | Situação | Evidência |
| --- | --- | --- |
| Catálogo público por clínica | **Entregue** | `routes/catalog.js`; expõe apenas nome, foto, categoria, material, tamanho, cor, preço e disponibilidade |
| Builder de catálogo versionado (rascunho, publicação, rollback) | **Entregue** | `catalog_customization_drafts` e `_revisions`; ver [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) |
| Agendamento e checkout públicos | **Entregue** | `routes/booking.js`; `POST /api/sales-orders/public` |
| Landing editável | **Entregue** | `routes/landing.js`; ver [LANDING.md](./LANDING.md) |
| Planos e assinatura da clínica | **Entregue** | o banco é a fonte da verdade (`platform.subscription_plans`); o código guarda só os planos-semente |

## 5. Infraestrutura

| Item | Situação | Evidência |
| --- | --- | --- |
| Fila persistente de jobs | **Entregue** | `background_jobs`, `services/jobWorker.js`; ver [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md) |
| Upload otimizado, com conversão para WebP | **Entregue** | `middleware/upload.js`, commit `42d47784` |
| Armazenamento em Cloudflare R2 | **Não validado** | código pronto e testado com stub, **nunca exercitado contra um bucket real**. Com o R2 desligado, todas as clínicas gravam no mesmo diretório local — impróprio para produção. Ver [R2.md](./R2.md) |
| Gateway de pagamento Asaas | **Não validado** | integração implementada, com cofre por clínica e webhook autenticado, **nunca exercitada contra o sandbox real**. Ver [ASAAS.md](./ASAAS.md) |
| E-mail transacional (Resend) | **Não validado** | sem `RESEND_API_KEY` e `EMAIL_FROM` a fila fica em modo assistido, sem envio nem débito de crédito |
| WhatsApp Cloud API | **Parcial** | a configuração por clínica funciona e o token não é exposto; falta o produto (ver P-03) |

## 6. Qualidade

| Camada | Resultado | Quando |
| --- | --- | --- |
| Suíte backend | 539/539 em 104 s, 58 arquivos de teste | reexecutada em 30/08; runner isolado de `RUN_MIGRATIONS_ON_BOOT` local |
| Homologação crítica ponta a ponta | 123/123 (`scripts/qa-homologation-critical.mjs`) | tenant novo, após as correções |
| Frontend unitário e de componentes | 33/33 e 109/109 em 15 arquivos | reexecutados em 30/08 |
| Build do frontend | aprovado, 1.793 módulos | reexecutado em 30/08 |

Relatório completo, com as sete falhas encontradas e corrigidas: [RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md](./RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md).

---

## Pendências abertas

### P-02 — taxonomia e duplicidades do estoque (M-05)

**Severidade: média, e cresce com o volume de dados.**

Três colunas ainda controlam a publicação do mesmo produto: `is_catalog_active`, `is_published` e `virtual_store_active`. A migration `0013` fez as três nascerem em zero, mas **não** as consolidou — continuam sendo três fontes de verdade para uma pergunta só ("este produto aparece na vitrine?").

Na mesma linha, `photo_url`, `image_url` e `gallery_urls` convivem com a tabela `product_images`.

Plano e ordem de execução em [ROADMAP-ESTOQUE-CATALOGO-AURA.md](./ROADMAP-ESTOQUE-CATALOGO-AURA.md). Nada disso foi executado.

### P-03 — WhatsApp como produto Aura (M-04)

**Severidade: é uma decisão de produto, não um defeito.**

Hoje cada clínica configura a própria Cloud API. Falta o produto: cofre central da Aura, vínculo do número, saldo de créditos, reserva e baixa por envio, e conciliação com o provedor.

Proposta em [PLANO-WHATSAPP-CREDITOS-AURA.md](./PLANO-WHATSAPP-CREDITOS-AURA.md) — **em revisão, sem decisão de fornecedor, preço ou lançamento.**

### P-04 — gates externos nunca exercitados

R2, Asaas e Resend estão implementados e testados contra stubs, mas **nunca rodaram contra o serviço real**. É o próximo gate antes de produção, e cada um precisa do seu próprio sandbox:

- R2: seguir o runbook de [R2.md](./R2.md) e migrar os anexos antigos;
- Asaas: sandbox próprio, com o webhook apontado e o mesmo token cadastrado nos dois lados;
- Resend: domínio verificado e `EMAIL_FROM` real.

Enquanto isso não acontecer, trate qualquer afirmação sobre os três como "deve funcionar", não como "funciona".

---

## O que este documento não cobre

- Preço, matriz comercial de planos e política de lançamento: são decisão de produto, e a documentação foi deliberadamente limpa deles. Não reintroduza como regra permanente sem decisão explícita.
- Roadmap. Ideias entram em [IDEIAS.md](./IDEIAS.md) no formato de descoberta, e só viram plano depois de problema, público, hipótese, custo e critério de sucesso definidos.
