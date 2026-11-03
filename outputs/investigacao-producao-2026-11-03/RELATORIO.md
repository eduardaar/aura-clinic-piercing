# Produção restaurada localmente: estoque e agendamento — 03/11/2026

## Deploy e backup

O workflow [CI e Deploy 41631280750](https://github.com/eduardaar/aura-clinic-piercing/actions/runs/41631280750)
terminou com sucesso nas três etapas: validação, pré-requisitos e produção.
O código publicado é `38240ca142a90accb01312b5540e35a43e0b8d90`; a API confirmou
a release `2026-11-03-revisao-estoque-e-catalogo` e os dois healthchecks responderam
200, incluindo conexão com o banco.

O backup foi gerado **depois** desse deploy, às **09:01:09 de 03/11/2026**, no fuso
de São Paulo. É um `pg_dump -Fc` completo do banco `aura_clinic`, com snapshot
consistente, incluindo a plataforma e os quatro schemas de clínicas.

- Servidor: `/root/pg-backups/aura-clinic-investigacao-20261103-pos-deploy-38240ca1.dump`.
- Cópia local: `backend/backups/prod-investigacao-2026-11-03/aura-clinic-investigacao-20261103-pos-deploy-38240ca1.dump`.
- Tamanho: **3.833.582 bytes**.
- SHA-256 conferido no servidor e na cópia local:
  `7d14b7104ae81dbf24dfc1f30f715c8180d1c3887a96a55c2fa39eda17f2e9d0`.
- Restauração completa em `aura_prod_snapshot_20261103_090109`, com
  `default_transaction_read_only=on`.
- Cópia para simulações: `aura_prod_investigation_20261103`. Somente nela foram
  desativados SMTP e integrações e criados os registros fictícios dos testes.
  A API local usa outro segredo de autenticação, workers desligados e nenhum
  bootstrap/migration automático.

O arquivo bruto, manifest, logs e consultas detalhadas ficam em `backend/backups/`,
que é ignorada pelo Git. Este relatório e o resumo agregado não contêm fichas,
nomes, contatos ou documentos de clientes. A configuração habitual do banco local
não foi substituída. Não foram copiados os buckets de anexos: este backup é do banco.

## Avaliação: diagnóstico da reclamação

Na fotografia da produção, o serviço atual **19 — Consulta e avaliação de piercing**
está ativo, disponível online e ligado aos dois profissionais. A consulta local
retornou datas em novembro para ambas. Portanto, a base atual não está sem vínculo
de profissional para esse serviço.

Foram encontrados caminhos distintos que explicam bloqueios ou mensagens confusas:

| Caso | Evidência e consequência | Situação nesta revisão |
| --- | --- | --- |
| Profissional desaparece ao abrir um link completo | Antes de a configuração carregar, a lista de profissionais era vazia; um efeito apagava `professional_id` e o horário predefinidos. | Reproduzido com teste e corrigido localmente: só valida depois de carregar a configuração. |
| Link de avaliação antiga | Os serviços **8** e **17** estão desativados; o **19** foi criado em 29/10 às 14:28. Um link antigo abria a etapa de profissional sem um serviço válido e mostrava “Nenhuma profissional vinculada”. | Volta à lista de serviços atuais e explica que o serviço do link está indisponível. Não escolhe automaticamente outro procedimento. |
| Falha de conexão ao confirmar | A promessa rejeitada deixava `submitting=true`, prendendo o botão em “Enviando...”. | Exibe erro recuperável, mantém o formulário e libera a tentativa seguinte. |
| Outro cliente ocupa o horário durante o preenchimento | A tela permanecia no resumo com a seleção antiga. | A resposta `booking_slot_unavailable` retorna à etapa de horário, reconsulta a disponibilidade e preserva nome/WhatsApp. |
| Duas solicitações simultâneas | Na cópia real, dois POSTs foram aceitos com 201 para a mesma profissional, data e horário. A mesma corrida ocorreu no teste isolado. | Trava transacional por solicitação e profissional, com nova conferência de disponibilidade antes do INSERT. Só uma solicitação é aceita. |
| Reenvio simultâneo da mesma solicitação | A chave única podia gerar 500, embora um dos pedidos já tivesse sido gravado; também podia sobrar uma segunda ficha de cliente. | A solicitação existente é reutilizada com 200. A resolução da cliente fica dentro da transação, sem criar outra ficha no reenvio. |
| Fuso do servidor | O contêiner foi confirmado em **UTC**. A comparação tratava horário de São Paulo como UTC. Na consulta de 03/11, produção ocultou 09:50, que aparecia na cópia local. | Disponibilidade e antecedência usam o horário civil da clínica. Testes em UTC, São Paulo e Tóquio produzem os mesmos resultados. |
| Serviços de profissionais diferentes | Seleções sem profissional em comum recebiam mensagem singular de falta de vínculo. | Explica a incompatibilidade e orienta revisar a seleção ou fazer agendamentos separados. |

As correções acima integram a release
`2026-11-03-recuperacao-do-agendamento-online`, encaminhada para publicação
pelo workflow CI e Deploy no push para `main`. A investigação não alterou
o cadastro, os vínculos nem a agenda de produção.

## Configurações que exigem revisão da clínica

- **Agenda da Eduarda:** modo restrito com liberações somente até **30/11/2026**.
  Em dezembro retorna zero datas por configuração. O Erick continua com datas
  disponíveis. Não foi prorrogada a liberação sem decisão da clínica.
- **Curso Individual de Body Piercing:** duração de **840 minutos (14 horas)**,
  vinculado somente à Eduarda. Não cabe em nenhuma janela de trabalho cadastrada,
  especialmente com intervalo de almoço. Não houve data disponível nos dois
  meses consultados. Precisa de duração/fluxo de atendimento definido pela clínica.
- **Bloqueio de 21 a 28/11:** marcado como dia inteiro; cobre integralmente também
  os dias inicial e final, apesar de os timestamps informarem horários parciais.
  A configuração deve ser conferida se essas extremidades deveriam permitir horários.
- Existem **três pares de atendimentos históricos sobrepostos** na mesma
  profissional/data. A consulta não prova por qual fluxo cada par foi criado;
  não foram alterados ou cancelados automaticamente.

## Estoque: o que a fotografia confirma

| Indicador | Resultado |
| --- | --- |
| Produtos | 143, sendo 130 não arquivados |
| Variações | 215, sendo 214 ativas |
| Quantidade nos produtos | 418 unidades |
| Soma das variações ativas | 418 unidades |
| Divergências de quantidade pai × variações | **0** |
| Produtos ou variações com saldo negativo | **0** |
| Produtos publicados pelas quatro marcas | 96 |
| Produtos não arquivados com publicação parcialmente marcada | **6** |
| Produtos vendáveis não arquivados com alguma variação sem preço | **31** |
| Produtos publicados com variação a preço zero | **2** |
| Produtos arquivados com preço do pai zerado e preço preservado nas variações | **10** |
| Variações inativas ainda com saldo | 1 |

Os seis produtos com marcação parcial ficam fora da vitrine pela regra atual.
Isso pode parecer desaparecimento, embora o cadastro e as unidades continuem no
banco. A análise detalhada preservada localmente identifica os itens para revisão.

Os produtos publicados com preço zero são os IDs **1** e **37**; no **37** há
variação com saldo positivo. Não foi inventado preço, feita republicação em lote,
alterado saldo ou reativada variação. O vínculo entre estoque e preço precisa
ser revisado pela clínica, especialmente nos itens que são material de procedimento.

Os dez preços zerados do registro principal são compatíveis com o defeito de
edição parcial corrigido na entrega anterior. Os valores nas variações continuam
presentes; isso permite conferência, mas não prova a origem de cada alteração.

Também não foram encontradas duplicidades de SKU de variação nem lotes ativos
com soma acima do saldo do produto. A reserva existente no snapshot estava
expirada; ela não explica um bloqueio atual de estoque.

## Bateria de testes e evidências

- Matriz com **50 consultas** de serviço × profissional × mês na cópia real,
  cobrindo os 14 serviços online e os meses de novembro/dezembro, além de IDs
  antigos e inexistentes. Nenhum serviço online atual está sem profissional ativo.
- Regressões de disputa de horário e reenvio idempotente em banco descartável.
- Regressões de fuso em três configurações de servidor.
- Sete regressões de interface: carregamento tardio, falha de conexão, link de
  serviço antigo, profissional inválida, horário indisponível, seleção sem
  profissional em comum e recuperação de conflito com dados preservados.
- Chromium e WebKit em **390 e 1366 px**, usando a API e a cópia real: envio de
  avaliação após falha de rede, recuperação dos links 8/17, profissional inválida,
  troca de profissional após mês vazio e caminho completo das seis etapas até
  o resumo. Quatro combinações aprovadas, sem exceções de JavaScript nem
  rolagem horizontal. Nenhuma mensagem de WhatsApp foi enviada.

Verificação automática: **815/815 testes backend**, **77/77 unitários e 424/424
componentes frontend**, tipos/build e lint aprovados. Depois do ajuste final que
move a resolução da cliente para a transação, **25 regressões de concorrência e
transações** foram executadas novamente e passaram, incluindo a contagem da ficha.
Uma prova adicional na cópia real com a API em UTC confirmou respostas 201/200
para o mesmo pedido, uma única ficha de cliente e o horário 09:50 preservado:
[local-proof.json](./local-proof.json).

Evidências agregadas: [audit-summary.json](./audit-summary.json) e
[browser-results.json](./browser-results.json). Os PNGs são somente locais.

## Como repetir

Com a fotografia já restaurada e `backend/.env` apontando para o PostgreSQL local:

```powershell
node outputs/investigacao-producao-2026-11-03/audit-snapshot.mjs
node backend/backups/prod-investigacao-2026-11-03/run-local-api.cjs
```

O primeiro comando abre transação somente leitura. O segundo usa exclusivamente
o banco de investigação e desativa integrações antes de subir a API em 4499.
Para o navegador, inicie o Vite em 5187, informe `AURA_PLAYWRIGHT_MODULE` com o
módulo instalado e rode `node --test outputs/investigacao-producao-2026-11-03/browser.test.mjs`.

A fotografia é um recorte de 03/11 às 09:01. Contagens locais não devem ser
tratadas como saldo de produção atualizado depois desse instante.

## Próximos ajustes de fluxo

Depois de publicar as correções, a simplificação com maior relação com os dados
observados é permitir “qualquer profissional disponível” na avaliação, evitando
que a escolha de uma profissional com agenda fechada faça parecer que o estúdio
inteiro está sem horários. Também vale reunir data e horário em uma etapa.
Essas mudanças de experiência não foram implementadas nesta investigação.
