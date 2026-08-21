# Roadmap — Escalabilidade do catálogo e agendamento públicos

## Objetivo

Preparar as páginas públicas de catálogo (`/catalogo?t=<clinica>`) e agenda
(`/agendar?t=<clinica>`) para crescer em acessos sem aumentar
proporcionalmente a carga da API e do PostgreSQL.

O foco é o visitante externo. O uso autenticado pela clínica tem um perfil de
carga menor e não é o gargalo esperado.

## Diagnóstico atual

O servidor tem folga no momento: a API Aura usa aproximadamente 58 MB de RAM,
CPU praticamente ociosa e há cerca de 13 GB de memória livre no host. Portanto,
não há necessidade de reduzir limites de memória agora.

As imagens públicas já usam R2 com CDN e cache imutável de um ano. Esse é o
desenho correto para arquivos estáticos. Os pontos a evoluir são as respostas
da API, as consultas ao banco e o volume de dados entregue a cada visitante.

| Área | Comportamento atual | Consequência em tráfego público |
| --- | --- | --- |
| Catálogo | `GET /api/catalog` retorna todos os produtos ativos, variações e URLs de todas as imagens | Payload e consultas crescem com o catálogo a cada visita |
| Cache da API | As respostas de `/api` usam `Cache-Control: no-store` | Cada abertura consulta a API e o banco novamente |
| Agenda pública | A tela solicita `/booking/config` e também o catálogo completo | Abertura da agenda transfere e processa dados além do necessário |
| Horários | Cada data escolhida consulta disponibilidade, compromissos e bloqueios | Correto para consistência, mas deve escalar com índices e cache curto |
| Logs | Configuração e busca de horários registram logs detalhados | Muitos acessos públicos podem gerar escrita de disco sem valor operacional |
| Métricas de catálogo | Visitas e ações inserem eventos diretamente no banco | É necessário controlar volume e retenção conforme o tráfego crescer |

## Princípios obrigatórios

1. **Isolamento por clínica é inegociável.** Nunca colocar em CDN uma resposta
   de `/api/catalog` cuja chave dependa apenas do header `X-Tenant`. Qualquer
   cache público precisa incluir o slug validado da clínica na URL ou na chave
   de cache controlada pelo servidor/edge.

2. **O servidor confirma o horário no momento da reserva.** Cache de slots pode
   melhorar a visualização, mas o `POST /booking/requests` deve recalcular a
   disponibilidade e continuar devolvendo conflito quando o horário foi ocupado.

3. **Publicação invalida cache.** Alterar produto, estoque, preço, promoção,
   horário ou catálogo precisa invalidar somente a clínica afetada.

4. **Medir antes e depois.** Nenhuma fase deve depender apenas de percepção;
   payload, latência, cache-hit e erro devem ser observados.

## Fase 0 — Linha de base e proteção operacional

**Objetivo:** conhecer o custo atual e evitar ruído antes de alterar fluxo.

- Medir tamanho e tempo de resposta de catálogo, configuração da agenda e slots
  para catálogos pequeno, médio e grande.
- Registrar quantidade de produtos, variações e imagens por clínica de teste.
- Adicionar métricas de duração de consulta, tamanho da resposta, uso do pool do
  PostgreSQL, taxa de `429`, `409` de horário ocupado e `5xx`.
- Trocar `console.info` detalhado das rotas públicas por log estruturado com
  nível configurável; em produção, manter somente erros e métricas agregadas.
- Restringir o cAdvisor público na porta 8080 a rede administrativa/VPN.

**Critérios de aceite:** painel ou consulta operacional consegue mostrar p50,
p95 e p99 dos três endpoints públicos e o tamanho médio das respostas.

## Fase 1 — Catálogo público enxuto

**Objetivo:** não enviar o catálogo inteiro e todos os detalhes para cada
visitante.

- Criar um endpoint de listagem, por exemplo
  `/api/public/:slug/catalogo`, que responda apenas dados dos cards:
  identificador, nome, preço inicial, disponibilidade, categoria, selo e URL da
  miniatura.
- Paginar ou carregar progressivamente os produtos; filtros e busca devem atuar
  no servidor quando o volume justificar.
- Criar um endpoint de detalhe, por exemplo
  `/api/public/:slug/catalogo/produtos/:id`, para descrição completa, galeria,
  variações e atributos técnicos.
- Usar miniaturas otimizadas no card. Galerias e imagens grandes são carregadas
  apenas na página/modal do produto.
- Definir limite funcional de imagens por produto e dimensões para imagens novas.

**Critérios de aceite:** a primeira abertura do catálogo não transporta galeria
nem todas as variações; catálogo com muitos produtos mantém payload inicial
previsível.

## Fase 2 — Cache público seguro por clínica

**Objetivo:** transformar leituras repetidas de vitrine em cache, sem risco de
vazamento entre tenants.

- Usar URL pública com slug, ou uma chave de edge explicitamente composta pelo
  slug validado. Não cachear uma resposta multi-tenant somente pelo caminho
  `/api/catalog` atual.
- Publicar `Cache-Control` apropriado para endpoints imutáveis/semimutáveis,
  com `stale-while-revalidate` quando aplicável.
- Usar a versão publicada do catálogo como ETag ou parte da chave de cache.
- Armazenar a representação pública em Redis como primeiro passo, com TTL e
  invalidação por tenant; opcionalmente promover o mesmo conteúdo ao cache da
  Cloudflare depois de validar a chave por clínica.
- Invalidar o cache ao publicar catálogo e nas alterações que afetam a vitrine:
  produto, variação, imagem, estoque público, preço, promoção e tema.

**Critérios de aceite:** a segunda abertura da mesma vitrine não executa as
consultas completas de catálogo; alterações de uma clínica não aparecem para
outra e ficam visíveis para a própria clínica após a invalidação.

## Fase 3 — Agendamento público focado

**Objetivo:** abrir a agenda sem baixar o catálogo completo.

- Criar resposta leve de identidade e configuração da agenda: nome, logo,
  slogan, serviços, profissionais elegíveis e regra de sinal.
- Carregar dados de joia somente quando o link já trouxer uma joia selecionada
  ou quando a pessoa escolher adicionar uma joia ao atendimento.
- Reaproveitar cache de curta duração para a configuração da agenda, invalidado
  quando serviços, profissionais, vínculos ou configuração mudarem.
- Cancelar requisições de slots obsoletas quando a pessoa muda de profissional
  ou data rapidamente.
- Manter idempotência e recálculo no envio da reserva como autoridade final.

**Critérios de aceite:** abrir `/agendar` faz somente as chamadas necessárias
para a agenda; a confirmação de uma reserva concorrente continua segura.

## Fase 4 — Consulta de horários e banco de dados

**Objetivo:** garantir que o custo de buscar horários fique proporcional ao dia
e profissional selecionados, não ao histórico inteiro da clínica.

- Criar índice composto para a consulta de compromissos por profissional e data,
  como `appointments(professional_id, appointment_date)`.
- Revisar a consulta de `schedule_blocks`: evitar aplicar `DATE()` sobre as
  colunas quando isso impedir o uso eficiente de índices; comparar intervalos
  com valores normalizados e criar índice compatível.
- Analisar `EXPLAIN (ANALYZE, BUFFERS)` em uma base representativa antes e depois
  da migração.
- Considerar cache de slots de 15 a 30 segundos por
  `tenant + profissional + serviço + data`. Cache vencido ou invalidado ao criar
  reserva/bloco; a tentativa final continua consultando o banco.
- Aplicar limite específico para endpoints públicos de slots e reserva, além do
  limite global da API, preferencialmente também na borda Cloudflare.

**Critérios de aceite:** a busca de slots usa índices nas tabelas de agenda e
mantém latência estável conforme o histórico de agendamentos cresce.

## Fase 5 — Eventos, retenção e resiliência

**Objetivo:** impedir que analítica pública se torne a fonte de escrita mais
cara do sistema.

- Aplicar rate limit específico ao endpoint de eventos do catálogo.
- Avaliar buffer/fila Redis e inserção em lote quando o volume justificar; não
  adicionar fila antes de medir a necessidade.
- Definir política de retenção ou agregação para `catalog_events` (por exemplo,
  manter eventos brutos por período e indicadores diários por mais tempo).
- Configurar alertas para taxa anormal de eventos, pool esgotado, latência p95,
  erros de reserva e crescimento de logs.

**Critérios de aceite:** aumento de visitas não provoca crescimento ilimitado
de eventos, logs ou conexões ao banco.

## Ordem recomendada de execução

1. Fase 0: medição e redução de logs de depuração.
2. Fase 1: resposta inicial enxuta do catálogo.
3. Fase 3: agenda sem dependência do catálogo completo.
4. Fase 2: cache seguro por slug e invalidação.
5. Fase 4: índices e cache curto de slots após medir consultas reais.
6. Fase 5: fila/retenção de eventos somente quando os números justificarem.

## O que não fazer agora

- Não reduzir o limite de memória da API Aura apenas porque ela está ociosa.
  Uploads, PDF e processamento pontual podem precisar de margem.
- Não alterar parâmetros do PostgreSQL sem evidência de gargalo.
- Não colocar cache público no endpoint atual baseado somente em `X-Tenant`.
- Não fazer teste de carga agressivo no ambiente de produção.

## Indicadores de sucesso

| Indicador | Meta inicial |
| --- | --- |
| Payload inicial do catálogo | Redução relevante e independente de galerias/variações completas |
| Cache hit da vitrine | Maioria das visitas repetidas sem reconstruir catálogo no banco |
| Latência p95 do catálogo e configuração da agenda | Acompanhar e manter estável conforme aumentam as clínicas |
| Latência p95 dos slots | Estável mesmo com histórico maior por profissional |
| Conflitos `409` de reserva | Baixos; conflitos continuam tratados sem dupla reserva |
| Erros `5xx` públicos | Próximos de zero e alertados rapidamente |

## Decisão de arquitetura resumida

R2/Cloudflare continua responsável por imagens. A API deve entregar dados
menores, cacheáveis por clínica e versão. O PostgreSQL permanece como fonte de
verdade para disponibilidade e reserva; cache melhora leitura, nunca substitui
a validação final do horário.
