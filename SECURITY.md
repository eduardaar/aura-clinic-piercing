# Política de segurança

## Comunicação responsável

Não publique vulnerabilidades em issues. Envie o relato de forma privada aos
mantenedores, incluindo impacto, rota afetada, passos mínimos de reprodução e
uma forma segura de contato. Não inclua dados reais de pacientes ou clientes.

## Controles obrigatórios para produção

- HTTPS na borda e entre a aplicação e o PostgreSQL, com certificado validado.
- `AUTH_SECRET` aleatório com no mínimo 32 bytes e rotação planejada.
- `CORS_ORIGIN` com allowlist exata e `TRUST_PROXY_HOPS` igual à topologia real.
- Redis persistente para os contadores distribuídos de autenticação.
- Buckets público e privado distintos no R2; o privado não pode ser público.
- Usuário de banco e usuário SSH dedicados, sem login remoto de `root`.
- MFA obrigatório nas contas administrativas e nos provedores de infraestrutura.
- Backups criptografados, restauração testada e monitoramento de eventos de segurança.

O deploy deve permanecer bloqueado se algum desses controles não estiver
configurado ou validado no ambiente alvo.

> **Situação em 30/09/2026:** em 21/08/2026 o deploy automático na `main` foi
> reativado (commit `8b00e0fe`) com parte deste checklist ainda pendente,
> aceita como não bloqueante. A verificação automática cobre só o que está em
> "Guardas aplicadas pelo código", abaixo; os demais itens dependem de revisão
> manual do ambiente.

### Guardas aplicadas pelo código

Com `NODE_ENV=production`, o boot da API (`backend/src/config/index.js`,
`backend/src/database/connection.js`, `backend/src/index.js`) falha quando:

- `AUTH_SECRET` falta, é o valor padrão de desenvolvimento ou tem menos de 32 bytes;
- `CORS_ORIGIN` falta ou contém `*`;
- `PUBLIC_API_URL` falta ou não usa `https://`;
- `DATABASE_SSL` não é `true` ou a validação do certificado está desligada;
- o Cloudflare R2 não está completo (as seis variáveis `R2_*`);
- `ASAAS_API_KEY` vem sem `ASAAS_WEBHOOK_TOKEN`;
- `DISABLE_RATE_LIMIT`, `ALLOW_LOCAL_AUTH_BYPASS` ou `RUN_MIGRATIONS_ON_BOOT` estão ligados;
- `TRUST_PROXY_HOPS` não é um inteiro de 0 a 5.

`ALLOW_INSECURE_TEST_ENV=true` afrouxa parte dessas guardas e existe só para a
suíte automatizada; nunca configure no servidor. No GitHub Actions, o job
"Pré-requisitos do deploy" de `.github/workflows/deploy.yml` também recusa
publicar sem as seis `R2_*` ou com a chave do Asaas sem o token do webhook.

## Verificações antes de cada release

Execute:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run audit:security
npm run typecheck
npm --prefix backend test
npm --prefix frontend test
npm run build
npm run lint
```

São os mesmos passos do job "Testes, tipos e build" da CI
(`.github/workflows/deploy.yml`), que roda em todo pull request para a `main`
e em todo push na `main`. A suíte do backend carrega o `backend/.env` local: rode-a sem
credenciais reais nesse arquivo.

Depois, faça teste dinâmico em um ambiente de homologação isolado, revisão das
regras de autorização por papel/tenant e teste de restauração de backup. Uma
auditoria sem CVEs conhecidos não substitui pentest nem revisão de arquitetura.

## Regras de desenvolvimento

- Toda rota privada deve autenticar, selecionar o tenant pelo token e exigir a
  permissão específica; parâmetros do cliente nunca concedem tenant ou papel.
- Respostas não devem revelar custo, finanças, credenciais, stack trace ou SQL
  sem autorização explícita.
- Uploads devem usar allowlist de tipo, validação do conteúdo, limite de tamanho
  e armazenamento fora da árvore executável.
- Dependências só entram com lockfile revisado e auditoria automatizada verde.
- Segredos não entram no Git, em logs, imagens Docker ou bundles do frontend.
