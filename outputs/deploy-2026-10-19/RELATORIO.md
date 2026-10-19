# Publicação — 19/10/2026

Versão local sobre `d7f6da31` publicada diretamente por SSH às 13:19 BRT em https://auraclinic.monitence.com. Alterações ainda não commitadas; não houve push nem disparo de GitHub Actions. A massa fictícia permanece exclusivamente no ambiente local.

## Backup anterior à alteração

Diretório no servidor: `/root/pg-backups/aura-pre-update-20261019-131623/`.

- `aura_clinic.dump`: dump completo PostgreSQL em formato custom, aproximadamente 3,3 MB.
- `application.tar.gz`: aplicação anterior, frontend e Compose, aproximadamente 9,7 MB.
- `restore-list.txt` e `SHA256SUMS`: catálogo de restauração e checksums.
- Restauração integral executada com `--exit-on-error` em base temporária; quatro clínicas conferidas. Base temporária removida após o teste.

## Aplicação e banco

Migrations planejadas com dry-run, depois aplicadas: plataforma `0009` e tenant `0045` nas clínicas aura-clinic, asda, izaque e victoria-studio. `migrations.mjs verify` no container novo: zero pendências, sem divergências de checksum.

Comparados antes/depois: usuários, clientes, profissionais, agendamentos, produtos, variações, vendas, compras, lançamentos financeiros, soma de quantidades, custo do estoque e valores financeiros. Totais idênticos nas quatro clínicas. Snapshots agregados no servidor em `/root/aura-before-20261019.txt` e `/root/aura-after-20261019.txt`.

Pacote enviado: SHA-256 `66864e8d8424185f066d76cb31dd841741b1606c028a0d5280a6c507f602a383`.
Imagem ativa: `sha256:e65d1476b773237ca219c940b8af3fdec9ff24f7b3b34799905bc7c7ead08ae7`.
Checksums dos serviços de compras e financeiro e da migration 0045 conferidos entre local e container.

## Validação

- Typecheck de backend/frontend e build de produção aprovados antes do envio. Testes funcionais e simulações locais documentados nos relatórios anteriores.
- Health da API com banco conectado, Redis conectado e container sem reinicializações.
- Bootstrap automático de banco continua desativado.
- Navegador contra o domínio público em 390 e 1366 px: HTTP 200, quatro imagens novas carregadas e sem cortes, ausência de rolagem horizontal e erros JavaScript; formulário de login renderizado.
- Evidências: `public-validation.json`, `production-390.png`, `production-1366.png`.
- Não foram criadas compras, despesas ou contas fictícias na produção. Fluxos autenticados de escrita foram simulados nas bases locais isoladas.

## Reversão disponível

Imagem anterior: `aura-api:rollback`. Frontend anterior: `/home/nginx/front/auraclinic.previous-20261019-131933`. Backup completo preservado no diretório acima. Migrations acrescentam colunas/categorias e mantêm compatibilidade com a versão anterior; restaurar banco exigiria considerar gravações posteriores ao backup.

Logs de inicialização sem erros da aplicação. Avisos preexistentes sobre chave SMTP derivada e suporte futuro do SDK AWS ao Node 20 permanecem registrados no servidor.
