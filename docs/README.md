# Documentação — Aura Clinic Piercing

Esta pasta guarda a referência técnica atual, os estudos aprovados e os roadmaps
ativos. Documentos históricos devem ser identificados como tal para não serem
confundidos com a regra de produto vigente.

## Comece por aqui

| Documento | Conteúdo |
| --- | --- |
| [ESTADO-ATUAL.md](./ESTADO-ATUAL.md) | **O que está entregue, o que é parcial, o que está pendente e o que nunca foi validado contra serviço externo.** Atualize aqui sempre que uma pendência for resolvida ou uma nova aparecer. |

## Referência técnica

| Documento | Conteúdo |
| --- | --- |
| [ARQUITETURA.md](./ARQUITETURA.md) | Estrutura do monorepo, multi-tenancy, sessão/autenticação, autorização em três camadas e componentes compartilhados. |
| [MODELO-DE-DADOS.md](./MODELO-DE-DADOS.md) | Schemas `platform` e `tenant_<slug>` e relações de dados atuais. |
| [API.md](./API.md) | Endpoints e convenções da API. O código é a fonte de verdade para regras em evolução. |
| [FLUXOS.md](./FLUXOS.md) | Fluxos operacionais existentes e ambiente local. |
| [GUIA-DEV.md](./GUIA-DEV.md) | Configuração, execução, testes e scripts de desenvolvimento. |
| [PADRAO-VISUAL.md](./PADRAO-VISUAL.md) | Primitivas e convenções de UI. |
| [ASAAS.md](./ASAAS.md) | Integração e cuidados operacionais do gateway de pagamentos. |
| [R2.md](./R2.md) | Armazenamento de arquivos no Cloudflare R2. |
| [SMTP.md](./SMTP.md) | Configuração, segurança e homologação do envio de e-mail por SMTP. |
| [CATALOGO-BUILDER.md](./CATALOGO-BUILDER.md) | Contrato técnico do editor de catálogo. |
| [LANDING.md](./LANDING.md) | Landing editável e seus limites de segurança. |
| [JOBS-EM-SEGUNDO-PLANO.md](./JOBS-EM-SEGUNDO-PLANO.md) | Fila persistente e execução assíncrona. |
| [EVOLUCAO-OPERACIONAL-ESTOQUE-E-FINANCEIRO.md](./EVOLUCAO-OPERACIONAL-ESTOQUE-E-FINANCEIRO.md) | Ficha técnica, consumo automático, lotes/FEFO, cancelamento e devolução: o que a última rodada entregou e com quais regras. |

## Homologação

| Documento | Conteúdo |
| --- | --- |
| [GUIA-HOMOLOGACAO-CLINICA-DO-ZERO.md](./GUIA-HOMOLOGACAO-CLINICA-DO-ZERO.md) | Roteiro ponta a ponta com dados fictícios para validar uma clínica nova. |
| [RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md](./RELATORIO-HOMOLOGACAO-CRITICA-2026-08-27.md) | Resultado da rodada de 27/08: sete falhas encontradas, corrigidas e retestadas. |

## Ideias e propostas

| Documento | Estado |
| --- | --- |
| [IDEIAS.md](./IDEIAS.md) | Ponto de partida vazio para descobrir e priorizar novas ideias. |
| [PLANO-WHATSAPP-CREDITOS-AURA.md](./PLANO-WHATSAPP-CREDITOS-AURA.md) | Proposta em revisão; não é compromisso de produto nem regra ativa. |
| [ESTUDO-SERVICOS-AGENDA-FINANCEIRO.md](./ESTUDO-SERVICOS-AGENDA-FINANCEIRO.md) | Diagnóstico e proposta para separar serviços executados pela agenda de vendas de produtos. |
| [ESTUDO-MATERIAIS-CONSUMO-AURA.md](./ESTUDO-MATERIAIS-CONSUMO-AURA.md) | Leitura da base local e fluxo aplicado para materiais operacionais. |
| [ROADMAP-ESTOQUE-CATALOGO-AURA.md](./ROADMAP-ESTOQUE-CATALOGO-AURA.md) | Etapas para consolidar estoque, variações e catálogo. Não executado — é a pendência P-02 de [ESTADO-ATUAL.md](./ESTADO-ATUAL.md). |
| [ROADMAP-LANCAMENTO-SETEMBRO-2026.md](./ROADMAP-LANCAMENTO-SETEMBRO-2026.md) | Plano semanal de homologação, preparação de produção e decisão Go/No-Go para setembro de 2026. |
| [ESTUDO-TECNICO-EXECUCAO-ROADMAP-LANCAMENTO-SETEMBRO-2026.md](./ESTUDO-TECNICO-EXECUCAO-ROADMAP-LANCAMENTO-SETEMBRO-2026.md) | Arquitetura-alvo, dependências, agentes, automações, ondas e validações para executar o lançamento com velocidade. |
| [ROADMAP-LIMPEZA-LEGADO-POS-LANCAMENTO.md](./ROADMAP-LIMPEZA-LEGADO-POS-LANCAMENTO.md) | Limpeza ampla que permanecerá para depois do lançamento e registro do que foi antecipado ao roadmap de setembro. |

## Como usar esta documentação

- Consulte o código antes de tratar uma regra como definitiva. Quando encontrar divergência, corrija o documento na hora — documentação errada custa mais que documentação ausente.
- Ao concluir ou abrir uma pendência, atualize [ESTADO-ATUAL.md](./ESTADO-ATUAL.md) no mesmo commit.
- Registre uma ideia em `IDEIAS.md` antes de transformá-la em plano.
- Crie um plano de implementação somente depois de definir problema, público,
  hipótese, custo e critério de sucesso.
- Evite reintroduzir preços, matrizes de plano, gates de lançamento ou backlog
  como regras permanentes sem decisão explícita de produto.
