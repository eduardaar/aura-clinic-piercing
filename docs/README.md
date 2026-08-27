# Documentação — Aura Clinic Piercing

Esta pasta guarda a referência técnica atual e propostas que ainda estão em
discussão. Roadmaps, matrizes comerciais, auditorias pontuais e regras de
produto antigas foram removidos para que as próximas decisões comecem sem
backlog herdado.

## Referência técnica

| Documento | Conteúdo |
| --- | --- |
| [ARQUITETURA.md](./ARQUITETURA.md) | Estrutura do monorepo, multi-tenancy, autenticação e componentes compartilhados. |
| [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md) | Schemas `platform` e `tenant_<id>` e relações de dados atuais. |
| [API.md](./API.md) | Endpoints e convenções da API. O código é a fonte de verdade para regras em evolução. |
| [FLUXOS.md](./FLUXOS.md) | Fluxos operacionais existentes e ambiente local. |
| [GUIA-DEV.md](./GUIA-DEV.md) | Configuração, execução, testes e scripts de desenvolvimento. |
| [PADRAO-VISUAL.md](./PADRAO-VISUAL.md) | Primitivas e convenções de UI. |
| [ASAAS.md](./ASAAS.md) | Integração e cuidados operacionais do gateway de pagamentos. |
| [R2.md](./R2.md) | Armazenamento de arquivos no Cloudflare R2. |
| [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) | Contrato técnico do editor de catálogo. |
| [LANDING.md](./LANDING.md) | Landing editável e seus limites de segurança. |
| [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md) | Fila persistente e execução assíncrona. |

## Ideias e propostas

| Documento | Estado |
| --- | --- |
| [IDEIAS.md](./IDEIAS.md) | Ponto de partida vazio para descobrir e priorizar novas ideias. |
| [PLANO-WHATSAPP-CREDITOS-AURA.md](./PLANO-WHATSAPP-CREDITOS-AURA.md) | Proposta em revisão; não é compromisso de produto nem regra ativa. |
| [ESTUDO-SERVICOS-AGENDA-FINANCEIRO.md](./ESTUDO-SERVICOS-AGENDA-FINANCEIRO.md) | Diagnóstico e proposta para separar serviços executados pela agenda de vendas de produtos. |
| [ESTUDO-MATERIAIS-CONSUMO-AURA.md](./ESTUDO-MATERIAIS-CONSUMO-AURA.md) | Leitura da base local e fluxo aplicado para materiais operacionais. |
| [ROADMAP-ESTOQUE-CATALOGO-AURA.md](./ROADMAP-ESTOQUE-CATALOGO-AURA.md) | Diagnóstico seguro e etapas para consolidar estoque, variações e catálogo. |
| [GUIA-HOMOLOGACAO-CLINICA-DO-ZERO.md](./GUIA-HOMOLOGACAO-CLINICA-DO-ZERO.md) | Roteiro ponta a ponta com dados fictícios para validar uma clínica nova. |

## Como usar esta documentação

- Consulte o código antes de tratar uma regra como definitiva.
- Registre uma ideia em `IDEIAS.md` antes de transformá-la em plano.
- Crie um plano de implementação somente depois de definir problema, público,
  hipótese, custo e critério de sucesso.
- Evite reintroduzir preços, matrizes de plano, gates de lançamento ou backlog
  como regras permanentes sem decisão explícita de produto.
