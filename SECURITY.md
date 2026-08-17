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
```

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
