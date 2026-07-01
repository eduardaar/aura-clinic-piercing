# Documentação — Aura Clinic Piercing

Documentação técnica do sistema de gestão (SaaS) para estúdios de piercing: agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e administração da plataforma.

O projeto é um **monorepo** com backend (Node/Express + PostgreSQL, multi-tenant por schema) e frontend (React/Vite). Para uma introdução geral e instruções rápidas de execução, veja também o `README.md` na raiz do repositório.

## Índice

| Documento | Conteúdo |
| --- | --- |
| [ARQUITETURA.md](./ARQUITETURA.md) | Visão geral do monorepo, multi-tenancy por schema Postgres, ciclo de vida de uma requisição, autenticação (tokens HMAC; clínica x plataforma), estrutura de pastas (backend e frontend) e componentes de UI reutilizáveis. |
| [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md) | Schema de controle `platform` e todas as tabelas de uma clínica (`tenant_<id>`): propósito, campos e relacionamentos (FKs), com descrição textual do diagrama ER. |
| [API.md](./API.md) | Referência dos endpoints por domínio: método, caminho, exigência de auth e de `X-Tenant`, campos do corpo e forma da resposta. |
| [FLUXOS.md](./FLUXOS.md) | Fluxos de uso passo a passo (cadastro de clínica, recepção, piercer, financeiro, super-admin da plataforma) e logins de teste locais. |
| [GUIA-DEV.md](./GUIA-DEV.md) | Pré-requisitos, configuração (.env), como rodar, testes, scripts úteis (backup, migração multi-tenant, teste de isolamento), estrutura de pastas e convenções. |

## Por onde começar

- **Novo no projeto?** Comece por [ARQUITETURA.md](./ARQUITETURA.md) e depois [GUIA-DEV.md](./GUIA-DEV.md) para subir o ambiente.
- **Integrando com a API?** Vá direto para [API.md](./API.md).
- **Entendendo o banco?** Veja [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md).
- **Entendendo o produto?** Percorra [FLUXOS.md](./FLUXOS.md).
