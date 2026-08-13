# Auditoria visual e estrutural do estoque conciliado

Data do snapshot: 13/08/2026  
Escopo: **aura-clinic** · tenant **2** · schema **tenant_2** · Aura clinic piercing  
Modo: **somente leitura** · gravações: **0** · outros tenants afetados: **0**

## Resumo executivo

- Produtos analisados: **123**
- Variações analisadas: **177**
- Produtos sem problema acionável identificado: **49**
- Padronizações simples: **5 grupos**
- Possíveis duplicidades: **4 grupos**
- Estruturas incorretas: **8 grupos**
- Imagens suspeitas/ausentes: **57 produtos** (18 com imagem genérica em variações + 39 novos sem imagem)
- Revisões humanas prioritárias: **5 grupos**
- Estoques negativos revelados: **2 variações**
- Ambientes de texto: PostgreSQL server/client **UTF8/UTF8**

Os contadores de problemas são grupos de achados e podem se sobrepor. O total de produtos OK é calculado de forma conservadora: qualquer produto envolvido em achado estrutural, visual, nomenclatura relevante ou duplicidade foi retirado de OK.

## Achados priorizados

| Prioridade | Produto/IDs | Problema | Evidência | Correção sugerida |
|---|---|---|---|---|
| ALTA | P1 / V283 | **ESTRUTURA INCORRETA:** Variação de mamilo lateral com zircônia foi vinculada ao produto Barbel Reto Coração. | V283 veio da linha física 61, está como 1,6 mm e sem lado/encaixe; P1 descreve coração, 1,2 mm e rosca externa. | Revisar visualmente a joia física e mover a variação para produto próprio/correto sem somar estoque. |
| ALTA | P15 / V296, V299, V300, V301, V312 | **ESTRUTURA INCORRETA:** Cinco modelos diferentes foram colocados dentro de Ponto de Luz. | V296 é topo básico bolinha dourado; V299–V301 são topos chapados; V312 é topo pérola. V300 e V312 ainda colidem tecnicamente em 4 mm/1,6 mm apesar de serem modelos distintos. | Separar por modelo (Ponto de Luz, Topo Chapado, Topo Pérola, Bolinha), preservando IDs históricos e quantidades. |
| ALTA | P15 / V28–V31 | **ESTRUTURA INCORRETA:** Tamanho do topo foi armazenado como comprimento da haste e top_size_mm ficou vazio. | Ex.: V28 chama-se Topo 2.0 mm, tem thickness 1.2 mm, length 2 mm e top_size_mm nulo; V29/V30 apresentam deslocamentos semelhantes. | Depois de confirmação, registrar topo em top_size_mm e manter 1,2 mm como compatibilidade/espessura. |
| ALTA | P45/V67 × P167/V272 | **POSSÍVEL DUPLICIDADE:** Barbell de coração Push Pin provavelmente foi recriado como produto separado. | Ambos são Barbell Reto Heart/Topo Coração, 14 mm, titânio; P45 explicita Push Pin e P167 veio da contagem como Push Pin, diferindo principalmente na espessura 1,2 × 1,6 mm. | Confirmar a imagem/modelo; se iguais, manter P45 e tratar 1,6 mm como variação, sem DELETE. |
| ALTA | P37/V53; P47/V63 | **ESTRUTURA INCORRETA:** Existem estoques negativos fora do conjunto conciliado. | V53 = -2 unidades; V63 = -1 unidade. As linhas seguras não alteraram essas variações. | Auditar vendas/reservas/movimentações antes de qualquer ajuste manual. |
| ALTA | P4/V4 | **NECESSITA REVISÃO HUMANA:** A contagem genérica Argola de aço foi conciliada no produto Par de Brincos. | P4 representa um par e a imagem mostra duas argolas; a linha física não comprovava par, embora medida/material coincidam. | Confirmar se as 4 unidades significam quatro pares ou quatro argolas individuais. |
| MÉDIA | P40/V56; P46/V62; P51/V68 | **ESTRUTURA INCORRETA:** Categorias contradizem nome, descrição ou modelo. | P40 é Clicker mas está em Barbell Reto; P46 chama Barbell Curvo mas está em Barbell Reto; P51 descreve Barbell Reto mas está em Barbell Curvo. | Padronizar categorias após confirmar que as imagens correspondem aos nomes. |
| MÉDIA | P2/V2 × P13/V18–V21 | **POSSÍVEL DUPLICIDADE:** Dois produtos genéricos Barbel Curvo podem ser um só produto com variações. | Mesmo modelo/material; P2 cobre 10 mm/1,6 mm e P13 cobre 6–12 mm/1,2 mm. As imagens mostram barbells curvos genéricos. | Confirmar acabamento/encaixe e, se equivalentes, consolidar estruturalmente preservando variantes e histórico. |
| MÉDIA | P48/V64 × P56/V72 × P61/V79 | **POSSÍVEL DUPLICIDADE:** Três produtos Navel Ponto de Luz têm diferenças pouco claras. | Nomes, construção, medida e imagens são muito semelhantes; Color/Clássico podem ser apenas pedra/acabamento, mas não há prova suficiente. | Comparar peças e fornecedores; manter separados até confirmação humana. |
| MÉDIA | P63/V81 × P71/V91 | **NECESSITA REVISÃO HUMANA:** Labret Flor Imperial aparece em dois produtos muito semelhantes. | Nomes quase idênticos; fotos parecem variações florais, mas não comprovam que o desenho seja o mesmo. | Conferir desenho e lapidação física antes de decidir duplicidade. |
| MÉDIA | P171/V280 × P2/P13 | **NECESSITA REVISÃO HUMANA:** Barbell curvo de umbigo básico foi criado separadamente de barbells curvos genéricos. | P171 não informa comprimento nem encaixe; espessura 1,6 mm coincide com P2, mas a aplicação em umbigo pode implicar construção distinta. | Confirmar comprimento, diâmetro das esferas e encaixe antes de estruturar. |
| MÉDIA | P168/V277; P176/V291 | **ESTRUTURA INCORRETA:** Produtos com Push Pin no nome não registram thread_type/encaixe. | As duas variações têm thread_type vazio; isso impede distinguir Push Pin de rosca interna. | Preencher o encaixe somente após confirmação técnica. |
| MÉDIA | P198/V320 | **ESTRUTURA INCORRETA:** Topo 2 mm do anzol foi gravado em size/length e não em top_size_mm. | V320 tem size e length = 'Topo 2 mm', top_size_mm nulo e thickness 1,2 mm. | Registrar top_size_mm=2,0 e manter 1,2 mm como compatibilidade, após validação. |
| MÉDIA | P200/V322; P201/V323 | **ESTRUTURA INCORRETA:** Material Titânio foi aplicado a itens que não são joias de titânio. | Disco de silicone e pedra dental constam como material Titânio; a cor/espessura indicam Não aplicável. | Usar Silicone e Cristal/Pedra dental conforme confirmação, sem alterar estoque. |
| MÉDIA | 18 produtos / 21 variações | **IMAGEM SUSPEITA:** Imagem genérica idêntica está marcada como principal em variações de modelos incompatíveis. | Afeta P13, P18, P21, P24, P28, P30, P33, P40, P41, P48, P51, P52, P57, P58, P59, P64, P65, P77; a foto mostra uma embalagem genérica e é reutilizada por labrets, clickers, navels e barbells distintos. | Manter URLs por enquanto; depois substituir a imagem principal da variação pela foto específica já existente no produto. |
| MÉDIA | P163–P201 (39 produtos novos) | **IMAGEM SUSPEITA:** Todos os produtos criados na conciliação ficaram sem imagem. | Nenhum possui product_images, image_url ou photo_url; não é possível validar visualmente nome/modelo. | Cadastrar imagem somente depois da identificação manual; não copiar por semelhança textual. |
| BAIXA | P1, P2, P13, P14 e variações | **PADRONIZAÇÃO SIMPLES:** Grafia Barbel em vez de Barbell. | Quatro nomes de produto e sete nomes de variação usam Barbel. | Padronizar para Barbell. |
| BAIXA | P41 | **PADRONIZAÇÃO SIMPLES:** Caractere de controle U+0013 no nome. | O separador entre Implante e Rosca Interna não é um travessão válido. | Substituir por – após aprovação; não é falha global de UTF-8. |
| BAIXA | P17 | **PADRONIZAÇÃO SIMPLES:** Aço Cirurgico sem acento e material conflitante. | Nome diz Aço Cirúrgico; produto/variação dizem Titânio ASTM F136. | Corrigir o acento; material exige revisão humana antes de qualquer mudança. |
| BAIXA | V255 | **PADRONIZAÇÃO SIMPLES:** Rose Gold anodizado foge do vocabulário Dourado/Rosé. | Nenhum outro registro usa Gold; a variação é titânio anodizado, não ouro. | Confirmar a tonalidade e padronizar para Rosé anodizado ou Dourado anodizado. |
| BAIXA | Catálogo legado | **PADRONIZAÇÃO SIMPLES:** Unidades sem espaço e Natural/Prata usados para titânio natural. | Há 296 ocorrências de medidas como 8mm em campos textuais; 48 menções a Prata em descrições/notas de titânio. | Normalizar apresentação para 8 mm e Titânio Natural sem alterar significado técnico. |

## Conclusões por tema

### Produtos principais e variações

Os Labrets básicos P10, Argolas básicas P12, Barbells retos P14, D-rings P8/P83, Transversal P37 e Ferradura P84 estão majoritariamente organizados como produto principal com variações. O maior desvio é P15, que recebeu cinco variações de modelos fisicamente distintos.

### Cores e materiais

Não foi encontrado produto de titânio cadastrado como material Ouro por causa da cor dourada. V255 usa Rose Gold apenas como cor anodizada. P200 e P201 possuem material claramente incompatível. O catálogo legado usa Natural/Prata em textos de titânio; a padronização recomendada é Titânio Natural.

### Encaixes e medidas

Os D-rings estéreis V267/V268 estão corretamente em 8 mm × 1,0 mm. Haste Microdermal V317 está em 1,6 mm. Os problemas concentram-se em top_size_mm vazio e em Push Pin sem thread_type.

### Imagens

Foram baixadas e abertas **87 URLs únicas**, sem erro HTTP. A imagem genérica compartilhada é visualmente incompatível com os diversos modelos e está marcada como principal em 21 variações. Os 39 produtos novos não têm imagem; por isso, nenhuma duplicação ornamental envolvendo esses itens foi tratada como conclusiva apenas pelo nome.

### Integridade e preservação

Nenhum INSERT, UPDATE, UPSERT, DELETE, merge ou alteração de imagem/categoria/estoque foi executado. As nove joias reservadas para ajuste manual não foram modificadas. A auditoria consultou somente tenant_2 em transação READ ONLY.

## Classificação dos 123 produtos

| Produto | Nome | Categoria | Variações | Medidas cadastradas | Classificação |
|---|---|---|---|---|---|
| P1 | Barbel Reto Coração com Zircônia Cravejadas | Barbell Reto | V1, V283 | 1.2mm; Não informado / 1,6 mm / Não informado | ESTRUTURA INCORRETA |
| P2 | Barbel Curvo | Barbell Curvo | V2 | 1.6mm / 10mm | POSSÍVEL DUPLICIDADE |
| P3 | Barbell com Cristal - Titânio | Barbell Reto | V3 | 1.2mm / 16mm | OK |
| P4 | Par de Brincos | Argolas | V4 | 1.2mm / 10mm | NECESSITA REVISÃO HUMANA |
| P5 | Labret Trinity | Labret | V5 | 1.2mm / 8mm | OK |
| P6 | Topo Baguete Safira Em Titânio Grau Implante | Labret | V6 | 1.2mm / 8mm | REVISAR |
| P7 | Labret Celestial Lunar Em Titânio Grau Implante | Labret | V7 | 1.2mm / 8mm | OK |
| P8 | D-ring Titânio Grau Implante | Argolas | V8, V267, V268 | 1.2mm / 8mm; 8 mm / 1,0 mm / 8 mm | OK |
| P9 | Topo Safira Imperial Em Titânio Grau Implante | Labret | V9 | 1.2mm / 8mm | REVISAR |
| P10 | Piercing Labret Básico - Titânio | Labret | V10, V11, V12, V13, V17, V251, V252, V253, V254, V255, V256 | 1.2mm / 8mm; 1.2mm / 10mm; 1.2mm / 12mm; 1.2mm / 7mm; 1.2mm / 6mm; 4 mm / 1,2 mm / 4 mm; 5 mm / 1,2 mm / 5 mm; 6 mm / 1,6 mm / 6 mm; 8 mm / 1,2 mm / 8 mm; 14 mm / 1,2 mm / 14 mm | PADRONIZAÇÃO SIMPLES |
| P11 | Topo Coração Liso Em Titânio Grau Implante | Labret | V14 | 1.2mm / 8mm | OK |
| P12 | Argola Básica Em Titânio Grau Implante | Argolas | V15, V16, V257, V260, V261, V262, V263 | 1.2mm / 8mm; 1.2mm / 10mm; 6 mm / 1,2 mm / 6 mm; 12 mm / 1,2 mm / 12 mm; 10 mm / 2,0 mm / 10 mm; 12 mm / 2,0 mm / 12 mm | OK |
| P13 | Barbel Curvo | Barbell Curvo | V18, V19, V20, V21 | 1.2mm / 6mm; 1.2mm / 8mm; 1.2mm / 10mm; 1.2mm / 12mm | IMAGEM SUSPEITA |
| P14 | Barbel Reto Básico Em Titânio | Barbell Reto | V22, V23, V24, V25, V26, V27, V270, V271, V273, V274, V275, V276 | 1.2mm / 10mm; 1.2mm / 12mm; 1.2mm / 14mm; 1.2mm / 16mm; 1.2mm / 18mm; 1.2mm / 20mm; 10 mm / 1,6 mm / 10 mm; 12 mm / 1,6 mm / 12 mm; 16 mm / 1,6 mm / 16 mm; 18 mm / 1,6 mm / 18 mm; 20 mm / 1,6 mm / 20 mm; 22 mm / 1,6 mm / 22 mm | PADRONIZAÇÃO SIMPLES |
| P15 | Ponto de Luz | Labret | V28, V29, V30, V31, V296, V299, V300, V301, V312 | 1.2mm / 2mm; 1.2mm / 3mm; 1.2mm / 4mm; 1.2mm / 8mm; Não informado / 1,2 mm / Não informado; 3 mm / 1,6 mm / 3 mm; 4 mm / 1,6 mm / 4 mm; 5 mm / 1,6 mm / 5 mm | ESTRUTURA INCORRETA |
| P16 | Labret Aranha com Zircônia Vermelha – Titânio Grau Implante | Labret | V32 | 1.2mm / 8mm | OK |
| P17 | Piercing para Umbigo Cereja Vermelha - Aço Cirurgico | Barbell Curvo | V33 | 1.2mm / 10mm | PADRONIZAÇÃO SIMPLES |
| P18 | Labret Serpente - Titânio Grau Implante | Labret | V34 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P19 | Argola Clicker com Zircônia Oval Cristal – Titânio Grau Implante | Argolas | V35 | 1.2mm / 10mm | OK |
| P20 | Labret Bengala Natalina - Titânio Grau Implante | Labret | V36 | 1.2mm / 8mm | OK |
| P21 | Piercing para Umbigo Corações com Pingente – Titânio Grau Implante | Barbell Curvo | V37 | 1.6mm / 10mm | IMAGEM SUSPEITA |
| P22 | Labret Árvore de Natal – Titânio Grau Implante | Labret | V38 | 1.2mm / 8mm | OK |
| P23 | Argola Clicker Ondulada com Zircônias – Titânio Grau Implante | Argolas | V39 | 1.2mm / 10mm | OK |
| P24 | Labret Flor Navete com Zircônias – Titânio Grau Implante | Labret | V40 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P25 | Argola Clicker Halo Cravejada - Titânio Grau Implante | Argolas | V41 | 1.2mm / 10 | OK |
| P26 | Labret Cone Liso - Titânio Grau Implante | Labret | V42 | 1.2mm / 8mm | OK |
| P27 | Argola Clicker Cravejada com Zircônias Em Titânio Grau Implante | Argolas | V43 | 1.2mm / 10 | OK |
| P28 | Argola Clicker Wire Em Titânio Grau Implante | Argolas | V44 | 1.2mm / 10 | IMAGEM SUSPEITA |
| P29 | Labret Curvo Cravejado com Zircônias Em Titânio Grau Implante | Labret | V45 | 1.2mm / 8mm | OK |
| P30 | Argola Clicker Slim Cravejada Em Titânio Grau Implante | Argolas | V46, V67 | 1.2mm / 10mm; 1.2mm / 8mm | IMAGEM SUSPEITA |
| P31 | Labret Duo Shine Em Titânio Grau Implante | Labret | V47 | 1.2mm / 8mm | OK |
| P32 | Argola Clicker Baguete Cravejada Em Titânio Grau Implante | Argolas | V48 | 1.2mm | OK |
| P33 | Labret Trio de Pérolas Em Titânio Grau Implante | Labret | V49 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P34 | Pino de Inserção Em Titânio Grau Implante | Conector | V50 | 1.6mm | OK |
| P35 | Labret Cacto Em Titânio Grau Implante - Rosca Interna | Labret | V51 | 1.2mm / 8mm | OK |
| P36 | Clicker Premium Cravejado Em Titânio Grau Implante – Zircônias Frontais | Argolas | V52 | 1.2mm / 8mm | OK |
| P37 | Industrial Barbell (scaffold) Em Titânio Grau Implante – Rosca Interna | Transversal | V53, V284, V285, V286 | 1.6mm; 30 mm / 1,2 mm / 30 mm; 32 mm / 1,2 mm / 32 mm; 34 mm / 1,2 mm / 34 mm | ESTRUTURA INCORRETA |
| P38 | Barbell Reto com Esferas Peroladas Em Titânio Grau Implante – Rosca Interna | Barbell Reto | V54 | 1.6mm / 16mm | OK |
| P39 | Barbell Reto Cravejado com Zircônias Em Titânio Grau Implante – Rosca Interna | Barbell Reto | V55 | 1.2mm / 14mm | OK |
| P40 | Clicker Segmentado Cravejado 360° Em Titânio Grau Implante – Zircônias | Barbell Reto | V56 | 1.2mm / 14mm | ESTRUTURA INCORRETA |
| P41 | Labret Curvo Marquise Cravejado Em Titânio Grau Implante  Rosca Interna | Labret | V57 | 1.2mm / 8mm | PADRONIZAÇÃO SIMPLES |
| P42 | Banana para Umbigo com Pingente Triplo Em Zircônia – Titânio Grau Implante | Barbell Curvo | V58 | 1.6mm / 10mm | OK |
| P43 | Piercing Crown Marquise com Zircônias Em Titânio Grau Implante – Rosca Interna | Barbell Curvo | V59 | 1.6mm / 10mm | OK |
| P44 | Barbell Reto com Corrente Dupla Em Titânio Grau Implante – Rosca Interna | Barbell Reto | V60 | 1.6mm / 14mm | OK |
| P45 | Barbell Reto Heart com Zircônias Em Titânio Grau Implante – Push Pin (threadless) | Barbell Reto | V61 | 1.6mm / 14mm | OK |
| P46 | Barbell Curvo Solar com Pedra Ônix Em Titânio Grau Implante – Rosca Interna | Barbell Reto | V62 | 1.2mm / 10mm | ESTRUTURA INCORRETA |
| P47 | Navel Crown Cravejado com Zircônias Em Titânio Grau Implante – Rosca Interna | Barbell Curvo | V63 | 1.6mm / 10mm | ESTRUTURA INCORRETA |
| P48 | Navel Ponto de Luz Em Titânio Grau Implante – Zircônia Embutida | Barbell Curvo | V64 | 1.6mm / 10mm | POSSÍVEL DUPLICIDADE |
| P49 | Navel Cascata Dupla Em Titânio Grau Implante – Zircônias Embutidas | Barbell Curvo | V65 | 1.6mm / 10mm | OK |
| P50 | Navel Gota Tripla Em Titânio Grau Implante – Zircônias Penduradas | Barbell Curvo | V66 | 1.6mm / 10mm | OK |
| P51 | Barbell Reto com Corrente Dupla e Zircônias Em Titânio Grau Implante – Rosca Interna | Barbell Curvo | V68 | 1.6mm / 14mm | ESTRUTURA INCORRETA |
| P52 | Labret Peixe Koi Em Titânio Grau Implante - Rosca Interna | Labret | V69 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P53 | Clicker Liso com Corrente Dupla Em Titânio Grau Implante | Argolas | V70 | 1.2mm / 8mm | OK |
| P54 | Navel Corações Em Cascata Em Titânio Grau Implante – Zircônias | Barbell Curvo | V71 | 1.6mm / 10mm | OK |
| P55 | Barbell Reto Asas Angelicais Em Titânio Grau Implante – Rosca Interna | Barbell Reto | V72 | 1.6mm / 14mm | OK |
| P56 | Navel Ponto de Luz Clássico Em Titânio Grau Implante – Zircônias Embutidas | Barbell Curvo | V73 | 1.6mm / 10mm | POSSÍVEL DUPLICIDADE |
| P57 | Joia Íntima Floral para Vch Em Titânio Grau Implante – Rosca Interna | Barbell Curvo | V74 | 1.6mm / 12mm | IMAGEM SUSPEITA |
| P58 | Labret Flor Pendente Em Titânio Grau Implante - Rosca Interna | Labret | V75 | 1.2mm | IMAGEM SUSPEITA |
| P59 | Clicker Martelado Em Titânio Grau Implante | Argolas | V76 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P60 | Navel Halo Cravejado Em Titânio Grau Implante – Zircônia/opala | Barbell Curvo | V77, V78 | 1.6mm / 10mm | REVISAR |
| P61 | Navel Ponto de Luz Color Em Titânio Grau Implante – Zircônias Embutidas | Barbell Curvo | V79 | 1.6mm / 10mm | POSSÍVEL DUPLICIDADE |
| P62 | Argola Clicker Zircônia Frontal Em Titânio Grau Implante | Argolas | V80 | 1.2mm / 8mm | OK |
| P63 | Labret Flor Imperial de Zircônias Em Titânio Grau Implante | Labret | V81 | 1.2mm / 8mm | POSSÍVEL DUPLICIDADE |
| P64 | Labret Estrela-do-mar Em Titânio Grau Implante | Labret | V82 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P65 | Argola Clicker Lateral Zircônia Em Titânio Grau Implante | Argolas | V83, V266 | 1.2mm / 8mm; 12 mm / 1,2 mm / 12 mm | IMAGEM SUSPEITA |
| P66 | Labret Trevo de Zircônias Em Titânio Grau Implante | Labret | V84 | 1.2mm / 8mm | OK |
| P67 | Labret Ramo de Oliveira Em Titânio Grau Implante | Labret | V85 | 1.2mm / 8mm | OK |
| P68 | Labret Borboleta Zircônia Em Titânio Grau Implante | Labret | V86 | 1.2mm / 8mm | OK |
| P69 | Labret Trio Navete Em Titânio Grau Implante | Labret | V87 | 1.2mm / 8mm | OK |
| P70 | Labret Ponto de Luz Clássico Em Titânio Grau Implante | Labret | V88 | 1.2mm / 8mm | OK |
| P71 | Labret Flor Imperial Em Titânio Grau Implante | Labret | V89 | 1.2mm / 8mm | POSSÍVEL DUPLICIDADE |
| P72 | Labret Flor de Lótus Navete Em Titânio Grau Implante | Labret | V90, V91, V92 | 1.2mm / 8mm | OK |
| P73 | Labret Duo Gotas Em Titânio Grau Implante | Labret | V93 | 1.2mm / 8mm | OK |
| P74 | Labret Lotus Navete Em Titânio Grau Implante | Labret | V94 | 1.2mm / 8mm | OK |
| P75 | Labret Tríade Pérola Em Titânio Grau Implante | Labret | V95 | 1.2mm / 8mm | OK |
| P76 | Clicker Zircônia Lateral Dobrado Em Titânio Grau Implante | Argolas | V96 | 1.2mm / 10mm | OK |
| P77 | Clicker Correntes Cascata Em Titânio Grau Implante | Argolas | V97 | 1.2mm / 8mm | IMAGEM SUSPEITA |
| P78 | Labret Cluster Coroa Graduada Em Titânio Grau Implante | Labret | V98 | 1.2mm / 8mm | OK |
| P79 | Clicker Corrente Elegance Cravejado Em Titânio Grau Implante | Argolas | V99 | 1.2mm / 10mm | OK |
| P80 | Barbell Reto Gota Dupla Em Titânio Grau Implante | Barbell Reto | V100 | 6 mm / 1.2mm / 14mm | OK |
| P81 | Labret Estrela Polar com Zircônia Em Titânio Grau Implante | Labret | V101 | 0 mm / 1.2mm / 8mm | OK |
| P82 | Labret Baguete Imperial Em Titânio Grau Implante | Labret | V102 | 1.2mm / 8mm | OK |
| P83 | D-ring Cravejado Premium Em Titânio Grau Implante | Argolas | V103, V269 | 1.2mm / 8mm; 8 mm / 1,2 mm / 8 mm | OK |
| P84 | Ferradura Clássica Em Titânio Grau Implante | Argolas | V104 | 1.2mm / 8mm | OK |
| P163 | Segmento cravejado frontal pérolas | Argolas / Segmentos | V258 | 8 mm / 1,2 mm / 8 mm | NECESSITA REVISÃO HUMANA |
| P164 | Segmento coração meio cravejado | Argolas / Segmentos | V259 | 8 mm / 1,2 mm / 8 mm | NECESSITA REVISÃO HUMANA |
| P165 | Segmento coração cravejado | Argolas / Segmentos | V264 | 10 mm / 1,2 mm / 10 mm | NECESSITA REVISÃO HUMANA |
| P166 | Segmento cravejado especial | Argolas / Segmentos | V265 | 8 mm / 1,2 mm / 8 mm | NECESSITA REVISÃO HUMANA |
| P167 | Barbell reto com topo coração | Barbell Reto | V272 | 14 mm / 1,6 mm / 14 mm | POSSÍVEL DUPLICIDADE |
| P168 | Navel haste Push Pin | Umbigo / Navel | V277 | 10 mm / 1,6 mm / 10 mm | ESTRUTURA INCORRETA |
| P169 | Navel completo topo 5 zircônias | Umbigo / Navel | V278 | 10 mm / 1,6 mm / 10 mm | NECESSITA REVISÃO HUMANA |
| P170 | Navel flor cravejado | Umbigo / Navel | V279 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P171 | Barbell curvo umbigo básico | Umbigo / Navel | V280 | Não informado / 1,6 mm / Não informado | POSSÍVEL DUPLICIDADE |
| P172 | Floating Navel ponto de luz | Umbigo / Navel | V281 | 10 mm / 1,2 mm / 10 mm | NECESSITA REVISÃO HUMANA |
| P173 | Barbell reto mamilo lateral opala branca | Mamilo | V282 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P174 | Taper / Conector reto | Taper / Conector | V287, V289 | Não aplicável / 1,2 mm / Não aplicável; Não aplicável / 1,6 mm / Não aplicável | NECESSITA REVISÃO HUMANA |
| P175 | Taper / Conector curvo | Taper / Conector | V288, V290 | Não aplicável / 1,2 mm / Não aplicável; Não aplicável / 1,6 mm / Não aplicável | NECESSITA REVISÃO HUMANA |
| P176 | Taper / Conector Push Pin | Taper / Conector | V291 | Não aplicável / 1,6 mm / Não aplicável | ESTRUTURA INCORRETA |
| P177 | Bolinha | Topos / Bolinhas | V292, V293, V294 | 3 mm / 1,2 mm / 3 mm; 5 mm / 1,6 mm / 5 mm | NECESSITA REVISÃO HUMANA |
| P178 | Topo básico bolinha | Topos / Bolinhas | V295 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P179 | Topo 3 bolinhas | Topos / Bolinhas | V297 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P180 | Topo 4 esferas | Topos / Bolinhas | V298 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P181 | Topo chapado martelado | Topos / Bolinhas | V302 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P182 | Topo estrela 8 pontas | Topos / Bolinhas | V303 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P183 | Topo ramos 5 folhas | Topos / Bolinhas | V304 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P184 | Topo flor 3 pétalas | Topos / Bolinhas | V305 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P185 | Topo cluster opala negra | Topos / Bolinhas | V306 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P186 | Cluster 10 zircônias | Topos / Bolinhas | V307 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P187 | Topo esfera opala | Topos / Bolinhas | V308 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P188 | Topo esfera Moss | Topos / Bolinhas | V309 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P189 | Topo cluster 3 zircônias e 10 esferas | Topos / Bolinhas | V310 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P190 | Topo esfera azul | Topos / Bolinhas | V311 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P191 | Topo Opala 3 navetes | Topos / Bolinhas | V313 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P192 | Topo cluster retângulo 5 zircônias | Topos / Bolinhas | V314 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P193 | Topo Spike | Topos / Bolinhas | V315 | Não informado / 1,2 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P194 | Surface haste | Microdermal / Surface | V316 | 15 mm / 1,6 mm / 15 mm | NECESSITA REVISÃO HUMANA |
| P195 | Haste Microdermal | Microdermal / Surface | V317 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P196 | Topo Microdermal Ágata Moss | Microdermal / Surface | V318 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P197 | Topo Microdermal cravejado Flat | Microdermal / Surface | V319 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P198 | Anzol ponto de luz | Outros | V320 | Topo 2 mm / 1,2 mm / Topo 2 mm | ESTRUTURA INCORRETA |
| P199 | L-Bar Christina piercing | Outros | V321 | Não informado / 1,6 mm / Não informado | NECESSITA REVISÃO HUMANA |
| P200 | Disco de silicone | Outros | V322 | Não aplicável / Não aplicável / Não aplicável | ESTRUTURA INCORRETA |
| P201 | Pedra para piercing dental | Outros | V323 | Não informado / Não aplicável / Não informado | ESTRUTURA INCORRETA |
