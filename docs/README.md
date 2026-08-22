# Documentação — Aura Clinic Piercing

Documentação técnica do sistema de gestão (SaaS) para estúdios de piercing: agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e administração da plataforma.

O projeto é um **monorepo** com backend (Node/Express + PostgreSQL, multi-tenant por schema) e frontend (React/Vite). Para uma introdução geral e instruções rápidas de execução, veja também o `README.md` na raiz do repositório.

## Índice

| Documento | Conteúdo |
| --- | --- |
| [ARQUITETURA.md](./ARQUITETURA.md) | Visão geral do monorepo, multi-tenancy por schema Postgres, ciclo de vida de uma requisição, autenticação (tokens HMAC; clínica x plataforma), estrutura de pastas (backend e frontend) e componentes de UI reutilizáveis. |
| [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md) | Modelo atual dos schemas `platform` e `tenant_<id>`, agrupado por domínio e com os relacionamentos que sustentam os fluxos principais. |
| [API.md](./API.md) | Catálogo atual de endpoints por domínio, com convenções de autenticação, tenant e rotas públicas. |
| [FLUXOS.md](./FLUXOS.md) | Fluxos de uso passo a passo (cadastro de clínica, recepção, piercer, financeiro, super-admin da plataforma) e logins de teste locais. |
| [GUIA-DEV.md](./GUIA-DEV.md) | Pré-requisitos, configuração (.env), como rodar, testes, scripts úteis (backup, migração multi-tenant, teste de isolamento), estrutura de pastas e convenções. |
| [PAINEL-PLATAFORMA.md](./PAINEL-PLATAFORMA.md) | O que o super-admin controla: planos editáveis (e por que o banco virou a fonte da verdade), cotas por plano, poder sobre contas, financeiro e suporte. |
| [PLANOS-E-FUNCIONALIDADES.md](./PLANOS-E-FUNCIONALIDADES.md) | Matriz final dos planos Start, Profissional e Studio, com preços, limites, contrato de acesso e registro dos recursos retirados ou reservados para evolução futura. |
| [LANDING.md](./LANDING.md) | Conteúdo editável da página pública da plataforma: modelo de dados, a garantia de que a landing nunca fica em branco, as guardas contra XSS armazenado e os endpoints do editor. |
| [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) | Personalização da vitrine: templates, rascunho isolado, publicação atômica, histórico, rollback, contrato da API e limites de segurança para conteúdo configurável. |
| [ASAAS.md](./ASAAS.md) | Integração com o gateway de pagamento: os dois níveis de credencial (plataforma e clínica), cofre cifrado, webhook multi-tenant (autenticidade, idempotência e o contrato de status HTTP), armadilhas do Asaas e configuração em produção. |
| [R2.md](./R2.md) | Armazenamento de arquivos no Cloudflare R2: configuração, migração segura do disco e condições para remover o fallback legado. |
| [PADRAO-VISUAL.md](./PADRAO-VISUAL.md) | Como escrever tela nova sem criar mais um sistema de CSS: a ordem de busca (componente → classe → CSS próprio), o catálogo de primitivas, as camadas da cascata, a armadilha do scroll e os anti-padrões observados no painel da plataforma. |
| [PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md](./PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md) | Auditoria de prontidão para produção: decisão GO/NO-GO, LGPD, segurança, pagamentos, backups, infraestrutura, migrations, plano de correção e critérios objetivos de lançamento. |
| [PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md](./PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md) | Plano executável separado entre correções já feitas no código, backlog de desenvolvimento, itens híbridos e dependências externas de infraestrutura, jurídico e operação. |
| [ROADMAP-LANCAMENTO-CODIGO.md](./ROADMAP-LANCAMENTO-CODIGO.md) | Roadmap de lançamento focado exclusivamente em código: arquitetura, migrations, segurança, pagamentos, mecanismos de LGPD, desempenho, otimização, E2E e testes de carga. |
| [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md) | Fila persistente por clínica, exportações assíncronas, idempotência, worker opt-in e limites operacionais. |

## Por onde começar

- **Novo no projeto?** Comece por [ARQUITETURA.md](./ARQUITETURA.md) e depois [GUIA-DEV.md](./GUIA-DEV.md) para subir o ambiente.
- **Integrando com a API?** Vá direto para [API.md](./API.md).
- **Entendendo o banco?** Veja [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md).
- **Entendendo o produto?** Percorra [FLUXOS.md](./FLUXOS.md).
- **Comparando planos ou criando uma feature paga?** Consulte [PLANOS-E-FUNCIONALIDADES.md](./PLANOS-E-FUNCIONALIDADES.md) antes de alterar a vitrine ou o catálogo de features.
- **Mexendo em pagamento?** Leia [ASAAS.md](./ASAAS.md) **antes** — o contrato de status HTTP do webhook e a idempotência têm armadilhas que custam dinheiro.
- **Escrevendo tela nova?** Leia [PADRAO-VISUAL.md](./PADRAO-VISUAL.md) **antes** de criar um `.css` — o projeto já tem o componente e a classe, e CSS sem `@layer` quebra o layout do sistema inteiro.
- **Preparando lançamento ou auditando riscos?** Use [PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md](./PRONTIDAO-PRODUCAO-LGPD-SEGURANCA.md) como checklist de liberação e registro das evidências.
- **Planejando as correções?** Use [PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md](./PLANO-DE-CORRECAO-CODIGO-E-OPERACAO.md) para saber o que está no repositório e o que depende do ambiente ou da operação.
- **Preparando a versão candidata pelo código?** Siga os gates e critérios de aceite de [ROADMAP-LANCAMENTO-CODIGO.md](./ROADMAP-LANCAMENTO-CODIGO.md).
