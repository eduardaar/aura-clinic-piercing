# Catalog Builder

O Catalog Builder permite que cada clínica componha a vitrine pública sem
alterar código. Ele trabalha com configurações estruturadas — identidade,
template, banners, seções, categorias, destaques, promoções e conteúdo — e
nunca com código executável salvo pela clínica.

## Fluxo de edição

1. Escolha um template inicial: **Minimal clean**, **Luxe editorial**,
   **Studio booking** ou **Campaign / lançamento**.
2. Ajuste marca, imagens, cores, blocos, contatos, integrações e SEO no editor.
   O editor mantém até 80 alterações locais para **Desfazer/Refazer**; os
   botões funcionam na tela e `Ctrl/Cmd + Z` funciona fora de campos de texto.
   A composição dos blocos pode ser reordenada por arrastar no desktop ou por
   botões acessíveis de subir/descer no teclado e no celular.
3. Envie imagens diretamente para a **Biblioteca de mídia**. Cada asset fica
   isolado na clínica e pode receber texto alternativo reutilizável; blocos de
   conteúdo também aceitam uma descrição específica para a imagem.
4. Use a prévia fiel do rascunho em desktop, tablet e celular. Ela executa o
   mesmo renderer da vitrine dentro de um iframe de mesma origem; o rascunho é
   enviado apenas pela tela autenticada e não é exposto por uma rota pública.
5. Clique em **Salvar rascunho**. A vitrine pública não muda nessa etapa.
6. Use **Revisar publicação** para verificar o rascunho salvo: links, vídeos,
   ordem/tipo dos blocos e contraste visual.
7. Clique em **Publicar** para tornar a versão visível. Problemas de segurança
   impedem a publicação; recomendações de qualidade permanecem como avisos.

O template só altera a paleta, a tipografia e a composição inicial dos blocos;
marca, imagens, produtos e textos já cadastrados são preservados.

## Revisões e concorrência

Cada clínica possui, dentro do próprio schema Postgres:

- `catalog_customization_drafts`: um snapshot editável e sua versão de lock;
- `catalog_customization_revisions`: snapshots publicados imutáveis;
- as tabelas `catalog_*` anteriores, mantidas como fallback para instalações
  ainda não convertidas.

Salvar ou publicar envia a versão do rascunho. Se outra pessoa salvar antes,
a API responde `409 catalog_version_conflict`; o editor deve ser atualizado
antes de continuar. Publicar cria uma revisão imutável. Restaurar uma revisão
cria uma **nova** publicação a partir dela — o histórico nunca é sobrescrito.

O reset administrativo agora substitui somente o rascunho; ele não altera a
vitrine publicada.

## API

Todas as rotas administrativas exigem a feature
`public_catalog_customization` e papel `admin` ou `reception`, exceto reset,
que exige `admin`.

| Método e rota | Comportamento |
| --- | --- |
| `GET /api/catalog` | Público. Retorna apenas o snapshot publicado, inclusive `catalogSections`, `plugins` e `version`; usa dados legados somente enquanto não houver revisão v2. |
| `GET /api/catalog-customization` | Retorna o rascunho editável e metadados de versão. |
| `PATCH /api/catalog-customization` | Salva somente o rascunho. Aceita payload total ou parcial, `plugins` estruturados e `expected_draft_version`; plugin inválido retorna `422 catalog_plugins_invalid`. |
| `GET /api/catalog-media` | Lista os assets de mídia do tenant para reutilização no editor. |
| `POST /api/catalog-media` | Envia uma imagem pública validada para a biblioteca, no prefixo de storage do tenant. |
| `PATCH /api/catalog-media/:id` | Atualiza o texto alternativo de um asset do mesmo tenant. |
| `GET /api/catalog-customization/checklist` | Retorna erros bloqueantes e avisos do rascunho salvo. |
| `POST /api/catalog-customization/publish` | Opcionalmente salva o payload no rascunho e publica uma revisão atômica. |
| `GET /api/catalog-customization/history` | Lista revisões publicadas, em ordem decrescente. |
| `GET /api/catalog-customization/history/:version` | Retorna o snapshot de uma revisão. |
| `POST /api/catalog-customization/rollback/:version` | Restaura uma revisão como uma nova publicação; exige versões esperadas de draft e publicação. |
| `POST /api/catalog-customization/reset` | Restaura somente o rascunho padrão. |

O objeto `version` retornado pelo editor tem `draft`, `published`,
`revision_id`, datas e `lock.expected_draft_version` /
`lock.expected_published_version`.

## Segurança de conteúdo

- Links configuráveis aceitam âncoras, rotas públicas internas e URLs `https`.
  Esquemas como `javascript:` e `data:` são descartados no renderer.
- Vídeos incorporados são limitados a YouTube (em `youtube-nocookie.com`) e
  Vimeo, com iframe sandboxed e `Referrer-Policy: no-referrer`.
- Credenciais de integrações nunca devem ser salvas em `catalog_settings`, pois
  essas configurações compõem a resposta pública do catálogo.
- Não há HTML, CSS ou JavaScript arbitrário por clínica. A evolução segura é
  feita por blocos nativos e integrações aprovadas, renderizados pelo produto.

## Blocos e integrações nativas

O renderer respeita a ordem e múltiplas instâncias dos blocos que o editor
oferece. Blocos institucionais usam somente informações já cadastradas pela
clínica; se faltarem dados, a seção não reserva uma área vazia na vitrine.

As integrações são registradas como manifestos internos e configurações
estruturadas dentro do mesmo snapshot do catálogo. Portanto, também ficam em
rascunho, participam da revisão e são restauradas por rollback. Cada manifesto
declara hosts permitidos, feature necessária e necessidade de consentimento; o
backend valida novamente antes de salvar.

Atualmente há CTA de WhatsApp, perfil do Instagram, FAQ, SEO (título,
descrição e `robots`), localização, Google Analytics e link de avaliações do
Google. Maps incorporado só cria iframe após escolha explícita do visitante;
sem ela, permanece um link seguro. Google Analytics só carrega após
consentimento de medição; retirar a escolha comunica `denied` ao runtime.
O link de avaliações usa Place ID e a URL oficial do Google — ele não raspa nem
exibe avaliações de terceiros. Não há scripts, pacotes, HTML, CSS ou JavaScript
enviados pela clínica.

As integrações respeitam a feature e a cota do plano. Por padrão, Profissional
permite 0 plugins ativos, Profissional 3 e Studio 12; uma clínica que fez downgrade
continua podendo editar/remover o que já tinha, mas não pode aumentar o uso
acima da nova cota. Analytics é um recurso do Studio (`catalog_analytics`).

## Próximas evoluções planejadas

- Se o preview precisar ser compartilhado fora do editor, criar sessão de
  preview curta e autenticada no backend, com expiração e `noindex`.
- Analisar referências para avisar antes de remover uma mídia ainda utilizada.
- Oferecer plugins nativos adicionais — agenda e reviews exibidas por API
  oficial, quando a clínica fornecer credenciais e consentimento aplicável.
- Adicionar IA que gere apenas patches estruturados revisáveis; ela não recebe
  dados clínicos/financeiros e nunca publica por conta própria.
