# Roadmap seguro — Estoque e catálogo da Aura Clinic

> **Situação em 30/09/2026:** os ajustes desta etapa continuam no código.
> Nenhuma das pendências das seções 2 e 3 foi executada, nem os passos 3 a 5 da
> "Ordem de execução recomendada". É a pendência P-02 de
> [ESTADO-ATUAL.md](./ESTADO-ATUAL.md).
>
> - **Publicação.** As três marcas continuam no schema e no código
>   (routes/jewelry.js:443, 465 e 476; Inventory.jsx:1089-1091). O estoque
>   unificado (48e5bfa1, migration tenant `0025_unified_inventory_items`) criou
>   uma quarta, `can_publish` ("Pode aparecer no catálogo"). Ela é exigida pelo
>   catálogo e pelos eventos (routes/catalog.js:65 e 111). A reserva por
>   agendamento também a exige, junto com `can_use_in_service`
>   (routes/booking.js:222 e 247).
> - **Pedido público.** Confere `can_sell`, `can_publish`, `is_catalog_active`
>   e `is_published`, mas não `virtual_store_active`
>   (services/sales.js:31-32).
> - **Imagens.** `photo_url`, `image_url` e `gallery_urls` continuam em
>   `jewelry_inventory` (schema.sql:212-214), ao lado da tabela `product_images`
>   (schema.sql:306).
> - **Categorias.** `jewelry_inventory.category_id` aponta para
>   `inventory_options` (migration tenant `0005`, de 14/08/2026), sem relação
>   pai/filha. As categorias em destaque do catálogo ainda guardam texto em
>   `catalog_featured_categories.category_id` (schema.sql:863).
> - **Valores.** Reais e centavos convivem: `cost_value`/`sale_value` e os
>   campos `*_cents` (routes/jewelry.js:500).
> - **Entrada e saída de estoque.**
>   - A entrada por compra com variação já existe (services/purchases.js:254-259).
>   - Movimentação com saída acima do saldo responde 409 (575b61a5).
>   - Criar, editar, arquivar e excluir item e movimentar estoque gravam a
>     auditoria central (1822d52a; routes/jewelry.js:617, 681, 738, 830, 867
>     e 881). O cadastro de lote (`POST /api/jewelry/:id/lots`) não grava.
>   - `GET /api/inventory/health` só aponta item sem SKU ou categoria, estoque
>     baixo, lotes vencidos ou a vencer em 30 dias e serviços com ficha técnica
>     (routes/jewelry.js:138-164). Não cobre negativos, preço nem imagem.
> - **Base local.** Os números da "Leitura confirmada da base local" são de
>   26/08/2026 e não foram reconferidos.

## Objetivo

Manter o estoque como fonte operacional confiável e fazer o catálogo mostrar
somente produtos e variações realmente disponíveis para publicação. Este
documento usa a base local restaurada da Aura como diagnóstico; não autoriza
alterações automáticas de classificação, quantidade física ou preço histórico.

## Leitura confirmada da base local

- 126 produtos, 180 variações ativas e 361 unidades em estoque.
- A quantidade do produto pai confere com a soma de suas variações em todos os
  cadastros atuais.
- Não há pedidos de compra históricos. Das 114 movimentações existentes, a
  maior parte veio de conferência de inventário; 67 produtos não possuem
  movimentação registrada.
- Há duas variações com saldo negativo. Elas exigem conferência física antes de
  qualquer correção.
- Existem categorias com nomes sobrepostos e configurações de catálogo que usam
  texto, em vez de uma referência estável à categoria do estoque.

## Fluxo alvo

```text
Compra confirmada
  -> entrada por variação (SKU, custo e fornecedor)
  -> saldo da variação
  -> resumo calculado no produto pai

Conferência física
  -> ajuste justificado por variação
  -> movimento de estoque e auditoria

Produto visível no catálogo
  -> produto marcado como visível
  -> variação ativa, com saldo e preço válidos
  -> catálogo, reserva e venda pública usam a mesma regra
```

O produto pai representa a família comercial (nome, descrição, categoria e
imagens compartilhadas). A variação é a fonte de verdade para SKU, medida,
material, cor, custo, preço e saldo.

## Ajustes aplicados nesta etapa

1. A vitrine pública, o registro de eventos e a reserva por agendamento passam
   a exigir os três marcadores legados de publicação ativos durante a transição:
   `is_catalog_active`, `is_published` e `virtual_store_active`.
2. O formulário passa a expor uma única ação, **Visível no catálogo público**,
   que sincroniza esses três marcadores. Produtos novos começam fora da vitrine.
3. A tela interna de estoque passa a respeitar o estado calculado pelo backend a
   partir das variações, evitando marcar como ativo um produto que tem uma
   variação crítica.
4. Uma variação com quantidade zero não herda mais a quantidade do produto pai
   na resposta pública do catálogo.

Esses ajustes são de regra e interface: não mudam quantidade, preço, categorias
ou histórico da Aura.

## Pendências que exigem decisão de negócio

### 1. Saneamento assistido de dados

- Conferir fisicamente as duas variações negativas e registrar ajuste com
  motivo.
- Preencher ou desativar as variações sem preço antes de colocá-las à venda.
- Adicionar imagem ao item ativo sem imagem e revisar os itens sem mídia.
- Não corrigir valores por inferência; toda decisão deve deixar movimento ou
  trilha de auditoria.

### 2. Taxonomia única de categorias

Criar uma tabela de categorias com identificador estável, nome público e
relação pai/filha. O catálogo deve apontar para esse identificador, não para
texto livre. Proposta inicial para validação comercial:

- Argolas: Clicker, Segmento, D-Ring, Captive e Hinged Ring.
- Hastes: Labret, Barbell reto, Barbell curvo e Transversal.
- Topos e acessórios: Topos, bolinhas, conectores e tapers.
- Especiais: Nostril, Microdermal/Surface e Umbigo.

Antes da migração, deve existir uma tabela de correspondência aprovada para
`Argola/Argolas`, `Topo/Topos/Topos / Bolinhas`,
`Microdermal/Surface/Microdermal / Surface` e `Conector/Taper / Conector`.

### 3. Retirada técnica das duplicidades

Após a normalização, remover gradualmente campos legados redundantes:

- Três controles de publicação devem virar um único campo de visibilidade.
- `photo_url`, `image_url` e `gallery_urls` devem migrar para
  `product_images`, preservando a imagem principal.
- Os campos espelhados no produto pai devem ser apenas resumo calculado; a
  variação continua sendo a fonte de verdade comercial e de estoque.
- Valores monetários em reais e em centavos devem ter uma única origem de
  escrita, mantendo o outro formato apenas quando houver compatibilidade
  necessária.

## Ordem de execução recomendada

1. Validar este roadmap e a taxonomia proposta.
2. Conferir negativos, preços e imagens em tela de pendências, sem atualização
   automática.
3. Migrar categorias com relatório de antes/depois e possibilidade de reversão.
4. Criar um único campo de publicação e migrar os três campos legados.
5. Migrar imagens e descontinuar os campos antigos.
6. Tornar compras por variação o caminho normal de entrada e manter inventário
   físico somente para ajustes.

## Critérios de conclusão

- Nenhum saldo negativo ou variação vendável sem preço.
- Cada produto e cada variação pertencem a uma categoria canônica.
- Um único controle determina se um produto aparece no catálogo.
- Catálogo, reserva, pedido público e tela interna apresentam a mesma
  disponibilidade da variação.
- Toda alteração de saldo tem origem em compra, venda, atendimento ou ajuste
  auditável.
