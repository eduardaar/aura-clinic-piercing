# Landing editável

A página pública da plataforma (`/`) tem o conteúdo guardado no banco e editável
pelo super-admin em `/plataforma` → **Landing pública**.

---

## 1. O que é editável — e o que não é

| Editável | Fixo no código |
| --- | --- |
| Textos, imagens e links de cada bloco | O **layout** de cada bloco |
| A ordem dos blocos | Quais tipos de bloco existem |
| Ligar/desligar cada bloco | Topo (`PublicTopNav`) e marca |
| Imagens do carrossel | Os cards de plano (vêm do cadastro de planos) |

O tipo de cada bloco é fixo de propósito. O editor controla **conteúdo, ordem e
ligado/desligado** — não a estrutura. É isso que impede a página de ser quebrada
a partir do painel.

Os seis blocos: `hero`, `features`, `carousel`, `plans`, `showcase_links`,
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
```

`content` é JSONB porque cada bloco tem campos diferentes (o hero tem título e
dois botões; o de recursos tem uma lista de cards). Uma coluna por campo viraria
uma tabela larga e cheia de `NULL`, e cada campo novo exigiria migration.

### A semente

A migration semeia **exatamente** o conteúdo que estava fixo no `Landing.jsx`.
Duas consequências que importam:

1. No deploy, a página fica **idêntica** ao que já estava no ar.
2. `ON CONFLICT DO NOTHING` faz a semente popular o banco no primeiro boot e
   nunca mais sobrescrever. Sem essa cláusula, **todo deploy desfaria** o que o
   super-admin editou.

O bloco `carousel` nasce **desligado**: ele não existia na página, e ligá-lo
sozinho num deploy mudaria a landing sem ninguém ter pedido.

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
- **Nada de `dangerouslySetInnerHTML`** na página.
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

As imagens anexadas pelo editor são somente imagens e vão ao bucket público R2
no prefixo exclusivo `plataforma/landing/`. Para levar os assets legados que
ainda estão em `/assets/landing/` ao R2 e trocar as referências já gravadas no
banco, execute no servidor com R2 configurado:

```bash
npm --prefix backend run migrate:landing-assets:r2 -- --apply
```

Sem `--apply`, o comando é um dry-run e apenas lista os arquivos e blocos que
serão alterados. Os assets locais continuam como fallback até a migração ser
conferida no CDN.

---

## 6. Cache

`GET /api/landing` é cacheado por 60s em memória. A landing é a página mais
acessada e o conteúdo muda raramente. Toda escrita invalida o cache, então o
super-admin vê o efeito da edição na hora.

---

## 7. Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/src/db/platformSchema.sql` | Tabela + semente com o conteúdo atual |
| `backend/src/services/landing.js` | Leitura, escrita, validação e cache |
| `backend/src/routes/landing.js` | Rotas pública e de plataforma + upload |
| `frontend/src/pages/Landing.jsx` | A página, um componente por tipo de bloco |
| `frontend/src/pages/landingDefaults.js` | O conteúdo embutido (fallback) |
| `frontend/src/features/platform/LandingEditor.jsx` | O editor do painel |
| `backend/tests/landing.test.mjs` | Autorização, XSS e reordenação |
| `frontend/tests/Landing.test.jsx` | A garantia de que a página nunca some |
