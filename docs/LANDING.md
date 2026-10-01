# Landing editável

A página pública da plataforma (`/`) tem o conteúdo guardado no banco e editável
pelo super-admin em `/plataforma/landing` (aba **Conteúdo da plataforma** →
**Landing**).

---

## 1. O que é editável — e o que não é

| Editável | Fixo no código |
| --- | --- |
| Textos, imagens e links de cada bloco | O **layout** de cada bloco |
| A ordem dos blocos (com o limite descrito abaixo) | Quais tipos de bloco existem |
| Ligar/desligar cada bloco (idem) | Topo (`PublicTopNav`), rodapé (`PublicFooter`) e marca |
| Contatos públicos: WhatsApp, e-mail e Instagram | Os cards de plano (vêm do cadastro de planos) |
| Texto e foto da página `/sobre` | Botões do topo da página e do card de plano |
| | Perguntas frequentes (lista em `Landing.jsx`) |

O tipo de cada bloco é fixo de propósito. O editor controla **conteúdo, ordem e
ligado/desligado** — não a estrutura. É isso que impede a página de ser quebrada
a partir do painel.

Os blocos aceitos pelo backend (`SECTION_KEYS` em `services/landing.js`):

| Bloco | Nome no editor | Onde aparece |
| --- | --- | --- |
| `hero` | Topo da página | Primeira dobra: etiqueta, título, subtítulo e nota. Os botões **Criar minha clínica** (`/cadastro`) e **Ver planos e recursos** (`#planos`) são fixos. |
| `features` | Recursos do sistema | Faixas que alternam imagem e texto (`#recursos`), uma por card. |
| `plans` | Planos | Título e subtítulo da seção `#planos`. Os cards vêm de `GET /api/plans`, ordenados por preço, com até cinco recursos em destaque, o modal **Comparar planos** e o botão **Quero esse**, que leva a `/cadastro?plano=<code>` e já deixa o plano escolhido no cadastro. |
| `closing` | Fechamento e rodapé | Chamada final (título, botão, nota e fotos), texto do rodapé e os contatos `contact_whatsapp`, `contact_email` e `contact_instagram`, usados no rodapé e no botão flutuante de WhatsApp. |
| `about` | Página Sobre nós | Só na página `/sobre`: etiqueta, título, texto (`body`, parágrafos separados por linha em branco), frase de encerramento (`signature`) e foto com legenda. |
| `carousel` | Carrossel de imagens | Continua editável, mas a página não o desenha (não há componente desde `e901cbd8`). |
| `showcase_links` | — | Aposentado: o editor esconde e a página ignora; o backend ainda aceita a chave. |

### Ordem e liga/desliga na prática

`Landing.jsx` monta **Topo → Recursos → Planos → Notícias e novidades** nessa
sequência fixa, independente de `sort_order`. Só depois vêm os demais blocos, na
ordem da API — hoje, na prática, apenas `closing` — e por último as
**Perguntas frequentes**. Consequências:

- Desligar `hero`, `features` ou `closing` tira o bloco da landing.
- `plans` aparece **sempre**: desligado ou ausente, usa o título e o subtítulo
  embutidos.
- Desligar `closing` não esvazia o rodapé nem o botão de WhatsApp: eles voltam
  aos contatos embutidos.
- `/sobre` também cai no conteúdo embutido quando `about` está desligado.

Alguns campos do editor são gravados, mas **não aparecem** na página atual:
rótulos e endereços dos botões, legenda, imagem de abertura e **Telas do sistema
em destaque** (`hero.screens`) do topo; título e subtítulo de `features`; rótulo
e endereço do botão de `plans`; e **Rótulo/Endereço do link do rodapé** de
`closing`.

---

## 2. Modelo de dados

`platform.landing_sections` — no schema `platform`, e não em nenhum tenant: é a
página de marketing da Monitence, uma só para toda a plataforma.

```sql
section_key TEXT PRIMARY KEY   -- hero | features | carousel | ...
enabled     BOOLEAN
sort_order  INTEGER            -- passo de 10, para caber inserção no meio
content     JSONB              -- campos próprios de cada tipo de bloco
updated_at  TIMESTAMPTZ
updated_by  INTEGER            -- platform.platform_users
```

`content` é JSONB porque cada bloco tem campos diferentes (o hero tem título e
dois botões; o de recursos tem uma lista de cards). Uma coluna por campo viraria
uma tabela larga e cheia de `NULL`, e cada campo novo exigiria migration.

### A semente

A semente fica em `backend/src/db/platformSchema.sql`, aplicado no bootstrap do
schema `platform`. Quando a landing ficou editável, ela reproduzia
**exatamente** o conteúdo que estava fixo no `Landing.jsx`. Duas consequências
que importam:

1. No deploy, a página fica **idêntica** ao que já estava no ar.
2. `ON CONFLICT DO NOTHING` faz a semente popular o banco no primeiro boot e
   nunca mais sobrescrever. Sem essa cláusula, **todo deploy desfaria** o que o
   super-admin editou. Um bloco novo (como `about`) entra no boot seguinte sem
   tocar nos que já existem.

O bloco `carousel` nasce **desligado**: ele não existia na página, e ligá-lo
sozinho num deploy mudaria a landing sem ninguém ter pedido. A semente ainda
insere `showcase_links` ligado, mas a página não o desenha.

`landingDefaults.js` diz espelhar a semente campo a campo, mas hoje os dois
divergem: as imagens dos cards de `features` (semente com fotos de
`aura-portfolio/`, embutido com as capturas de `system/` e `feature-agenda.jpg`),
`hero.screens` e os contatos `contact_*` de `closing` só existem no embutido.
Como o campo ausente cai no default (seção 3), os contatos embutidos valem
enquanto o super-admin não preencher os seus.

---

## 3. A landing nunca fica em branco

Esta é a regra que governa o `Landing.jsx`. É a porta de entrada de quem vai
assinar o produto — uma tela branca aqui é venda perdida na hora, e ninguém fica
sabendo.

Duas camadas de proteção:

1. **A página monta já com o conteúdo embutido** (`landingDefaults.js`), não com
   lista vazia. API fora, lenta ou devolvendo `sections: []` nunca vira tela
   branca; a resposta só substitui o embutido quando chega com blocos válidos.
2. **Campo a campo**: valor ausente, `null` ou string em branco cai no default
   daquele campo — nunca em `undefined` na tela. Um campo apagado por engano no
   painel não deixa buraco na página.

Bloco com `section_key` desconhecido é ignorado em silêncio: o backend pode
ganhar um tipo novo antes do deploy do frontend.

`frontend/tests/Landing.test.jsx` trava essas propriedades.

---

## 4. Segurança

O conteúdo vem de um painel e vai **direto para a página pública**, o que muda o
nível de cuidado exigido:

- **`javascript:`, `data:` e `vbscript:` são recusados** em qualquer campo,
  inclusive dentro de listas aninhadas, ignorando espaço e caixa. Um
  `javascript:` no `href` de um `<a>` é XSS armazenado, disparado em todo
  visitante da landing.
- **Nada de `dangerouslySetInnerHTML`** na página. Documentos legais, notícias e
  manual também são texto simples, sem HTML vindo do banco.
- **Teto de 64 KB** por bloco. Sem ele, uma imagem colada em base64 no campo de
  texto entraria no banco e seria servida a cada visita.
- Só **token de plataforma** edita. Um admin de clínica não reescreve a página
  de marketing de todo mundo.
- A rota pública devolve **apenas blocos ligados** — o painel vê todos, senão
  não haveria como religar um bloco desligado.

---

## 5. Endpoints

| Método | Rota | Quem |
| --- | --- | --- |
| `GET` | `/api/landing` | público, sem sessão |
| `GET` | `/api/platform/landing` | super-admin (todos os blocos) |
| `PUT` | `/api/platform/landing/sections/:key` | super-admin |
| `PATCH` | `/api/platform/landing/order` | super-admin |
| `POST` | `/api/platform/landing/uploads` | super-admin |

`PUT` preserva o campo que não veio: a tela salva um bloco por vez, e alternar o
interruptor não pode zerar o conteúdo.

A reordenação recebe **a lista inteira** na ordem final, e não "mova X para a
posição N" — assim o resultado não depende da ordem em que as requisições
chegam. Roda numa transação: uma reordenação aplicada pela metade deixaria a
página fora de ordem para todo visitante.

O upload tem rota própria porque `POST /api/uploads` passa por `withDb` e exige
um tenant resolvido — e o super-admin não pertence a clínica nenhuma.

As imagens anexadas pelo editor são somente imagens (JPEG, PNG ou WebP, até
6 MB; não há campo para colar URL) e vão ao bucket público R2 no prefixo
exclusivo `plataforma/landing/`. Antes de gravar, o upload as converte para
WebP com o perfil `standard` (até 1600 px). Para levar os assets legados que
ainda estão em `/assets/landing/` ao R2 e trocar as referências já gravadas no
banco, execute no servidor com R2 configurado:

```bash
npm --prefix backend run migrate:landing-assets:r2 -- --apply
```

Sem `--apply`, o comando é um dry-run e apenas lista os arquivos e blocos que
serão alterados. Os assets locais continuam como fallback até a migração ser
conferida no CDN. O script cobre só sete das oito fotos da raiz da pasta
(`hero-studio.jpg`, `feature-*.jpg` e `showcase-*.jpg`); `auth-side.jpg`
(fundo da tela de login, em `auth.css`) e as imagens de `aura-portfolio/` e
`system/`, usadas pela semente e pelo conteúdo embutido, continuam servidas
pelo frontend. O script exige o R2 completo mesmo no dry-run (ver
[R2.md](./R2.md)).

---

## 6. Páginas e conteúdo públicos em volta da landing

Topo e rodapé são componentes fixos, compartilhados pelas telas públicas:

- **`PublicTopNav`** (sempre escuro): marca **Aura Clinic**, links **Recursos**
  (`/#recursos`), **Planos** (`/#planos`), **Novidades** (`/novidades`) e
  **Sobre nós** (`/sobre`), além de **Entrar** e **Começar grátis**. `/planos`
  apenas redireciona para `/#planos`.
- **`PublicFooter`** (landing, `/sobre`, login, cadastro, novidades e documentos
  legais): texto do rodapé e contatos vindos do bloco `closing`; grupo
  **Institucional** com **Notícias e novidades**, **Termos de uso** e
  **Privacidade**. Os dois últimos abrem o texto num modal
  (`LegalDocumentModal`), mantendo `/termos-de-uso` e
  `/politica-de-privacidade` como endereço alternativo.
- **Botão flutuante de WhatsApp**: só na landing, quando `contact_whatsapp` tem
  dígitos (abre `wa.me`).

Fora de `landing_sections`, o restante do conteúdo institucional também é
editado em **Conteúdo da plataforma**:

| Conteúdo | Tabela | Rotas públicas | Painel |
| --- | --- | --- | --- |
| Termos de Uso e Política de Privacidade | `platform.legal_documents` + `platform.legal_document_versions` | `GET /api/legal-documents` | **Termos e privacidade** (`/plataforma/legal`) |
| Notícias e manual do usuário | `platform.content_articles` (`news` \| `manual`; `draft` \| `published` \| `archived`) | `GET /api/news`, `GET /api/news/:slug`, `GET /api/manual` | **Notícias e manual** (`/plataforma/conteudo`) |

- **Documentos legais**: `PUT /api/platform/legal-documents/:key` (botão
  **Publicar nova versão**) sobe `version` e grava a cópia imutável em
  `legal_document_versions` na mesma transação; o histórico sai em
  `GET /api/platform/legal-documents/:key/versions`. O cadastro
  (`POST /api/signup`) exige o aceite das versões vigentes — senão responde
  `400 legal_acceptance_required` — e grava cada aceite em
  `platform.legal_acceptances`.
- **Notícias e manual**: o super-admin usa `GET`/`POST /api/platform/content` e
  `PUT`/`DELETE /api/platform/content/:id`; o `DELETE` só arquiva. A landing
  mostra as três notícias publicadas mais recentes na seção **Notícias e
  novidades** (some quando não há nenhuma), e `/novidades` lista as publicadas.
- A migration `platform/0008_public_content_and_legal_versions.sql` criou essas
  duas tabelas, publicou a versão 2 dos dois documentos legais (onde ainda
  estavam na versão 1) e semeou uma notícia e cinco capítulos do manual.

---

## 7. Cache

`GET /api/landing` é cacheado por 60s em memória. A landing é a página mais
acessada e o conteúdo muda raramente. Toda escrita invalida o cache, então o
super-admin vê o efeito da edição na hora.

---

## 8. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/src/db/platformSchema.sql` | Tabelas + sementes da landing e dos documentos legais |
| `backend/src/db/migrations/platform/0008_public_content_and_legal_versions.sql` | Versões legais, notícias e manual |
| `backend/src/services/landing.js` | Leitura, escrita, validação e cache |
| `backend/src/routes/landing.js` | Rotas pública e de plataforma + upload + documentos legais |
| `backend/src/routes/contentHub.js` / `services/contentHub.js` | Notícias e manual |
| `backend/scripts/migrate-landing-assets-to-r2.mjs` | Migração das fotos legadas para o R2 |
| `frontend/src/pages/Landing.jsx` | A landing, a página `/sobre` (`AboutPage`) e o FAQ |
| `frontend/src/pages/landingDefaults.js` | O conteúdo embutido (fallback) |
| `frontend/src/components/layout/PublicTopNav.jsx` / `PublicFooter.jsx` | Topo e rodapé públicos |
| `frontend/src/components/common/LegalDocumentModal.jsx` | Modal de termos e privacidade (rodapé e cadastro) |
| `frontend/src/features/platform/LandingEditor.jsx` | O editor do painel |
| `frontend/src/features/platform/LegalEditor.jsx` / `ContentAdmin.jsx` | Editores de documentos legais e de notícias/manual |
| `backend/tests/landing.test.mjs` | Autorização, XSS e reordenação |
| `backend/tests/contentHub.test.mjs` | Validação de notícias e manual (texto simples, tipo e status) |
| `frontend/tests/Landing.test.jsx` | A garantia de que a página nunca some e a ordem fixa das seções |
