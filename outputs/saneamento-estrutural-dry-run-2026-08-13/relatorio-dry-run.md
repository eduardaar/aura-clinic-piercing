# Dry-run de saneamento estrutural do estoque

Data: 13/08/2026  
Escopo: **aura-clinic** · tenant **2** · schema **tenant_2**  
Modo: **BEGIN READ ONLY**  
**Escritas no banco: 0**  
**Outros tenants afetados: 0**

## Resumo

- Problemas analisados: **12 grupos temáticos / 23 achados operacionais**
- Correções seguras: **5 grupos**
- Correções estruturais seguras: **3 grupos**
- Revisões humanas: **11 grupos**
- Produtos que precisam de imagem real: **57**
- Categorias a corrigir: **3 produtos**
- Materiais a corrigir com segurança: **1 produto**
- Materiais pendentes de confirmação: **1 produto**
- Medidas a corrigir: **5 variações**
- Encaixes a corrigir: **2 variações**
- Possíveis duplicidades mantidas sem merge: **5 grupos**
- Estoques negativos investigados: **2 variações**
- Quantidades alteradas: **0**
- Nove joias manuais reprocessadas: **0**

## Plano classificado

| Prioridade | Produto/variação | Problema atual | Correção proposta | Impacto | Classificação |
|---|---|---|---|---|---|
| ALTA | P15/V296 | Topo básico bolinha dourado está dentro de Ponto de Luz | Reassociar **o mesmo V296** ao P178 Topo básico bolinha; quantidade permanece 2 | Preserva ID, estoque e movimento 275; nenhum vínculo comercial encontrado | **CORREÇÃO ESTRUTURAL SEGURA** |
| ALTA | P15/V299–V301 | Topos chapados 3/4/5 mm estão dentro de Ponto de Luz | Criar produto Topo Chapado e reassociar os mesmos IDs; estoques 5/5/5 permanecem independentes | Preserva movimentos 278–280; não há vendas/agendamentos/reservas | **CORREÇÃO ESTRUTURAL SEGURA** |
| ALTA | P15/V312 | Topo pérola 4 mm está dentro de Ponto de Luz e colide textualmente com V300 | Criar produto Topo Pérola e reassociar o mesmo V312; não somar com V300 | Quantidade 2 e movimento 296 preservados | **CORREÇÃO ESTRUTURAL SEGURA** |
| ALTA | P15/V28–V31 | Tamanho do topo está em `length`; `top_size_mm` vazio | Preencher `top_size_mm` com 2,0 / 2,5 / 3,0 / 4,0 conforme os nomes; não limpar `length` ainda | V29 possui venda/agendamento histórico e continua no mesmo produto/ID | **CORREÇÃO SEGURA** |
| ALTA | P1/V283 | Mamilo lateral com zircônia foi ligado a Barbell Coração | Estrutura provável: produto próprio Mamilo lateral com zircônia; não mover sem imagem/peça | Só existe movimento de inventário da linha 61; zero venda/agendamento/reserva | **REVISÃO HUMANA** |
| ALTA | P45/V67 e P167/V272 | Forte semelhança entre Barbell Coração Push Pin 1,2 e 1,6 mm | Se a peça for idêntica, manter P45 e reassociar V272 como variação 1,6 mm, sem apagar P167 | P167 não tem imagem; V272 só possui movimento de inventário; sem histórico comercial | **REVISÃO HUMANA** |
| ALTA | P37/V53 | Estoque -2 | Manter sem correção até contagem física | Nenhum movimento, venda, agendamento, reserva, contagem ou log explica o saldo | **REVISÃO HUMANA / CONTAGEM FÍSICA** |
| ALTA | P47/V63 | Estoque -1 | Manter sem correção até contagem física | Nenhum movimento, venda, agendamento, reserva, contagem ou log explica o saldo | **REVISÃO HUMANA / CONTAGEM FÍSICA** |
| ALTA | P4/V4 | Quatro argolas físicas foram conciliadas em Par de Brincos | Confirmar se o SKU é vendido por par ou unidade; não alterar quantidade | Sem vendas/agendamentos/reservas; movimento de conciliação registrou delta 0 e estoque final 4 | **REVISÃO HUMANA** |
| MÉDIA | P40 | Clicker categorizado como Barbell Reto | `Barbell Reto → Argolas` | Apenas metadado; IDs, variações, imagens e estoque preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P46 | Nome/descrição dizem Barbell Curvo, categoria diz Barbell Reto | `Barbell Reto → Barbell Curvo` | Apenas metadado; V62 e estoque 1 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P51 | Nome/descrição dizem Barbell Reto, categoria diz Barbell Curvo | `Barbell Curvo → Barbell Reto` | Apenas metadado; V68 e estoque 2 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P198/V320 | Topo 2 mm está em `size/length`; `top_size_mm` vazio | Preencher `top_size_mm=2,0`; manter demais campos até revisão | ID, estoque 3 e movimento 304 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P168/V277 | Produto se chama Navel haste Push Pin, mas encaixe está vazio | Definir `thread_type="Push Pin"`, padrão já usado pelo sistema | ID, estoque 3 e movimento 254 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P176/V291 | Taper/Conector Push Pin com encaixe vazio | Definir `thread_type="Push Pin"` | ID, estoque 3 e movimento 270 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P200/V322 | Disco de silicone consta como Titânio | Definir material `Silicone` no produto e variação | Campo é texto livre; ID e estoque 5 preservados | **CORREÇÃO SEGURA** |
| MÉDIA | P201/V323 | Pedra dental consta como Titânio | Confirmar se o material comercial é cristal odontológico, zircônia ou outro | O modelo não possui enum de material; não inventar valor | **REVISÃO HUMANA** |
| MÉDIA | P2/P13 | Dois Barbells Curvos genéricos | Comparar peça, encaixe e acabamento antes de consolidar | 1,6 mm versus 1,2 mm pode ser variação, mas as imagens não provam identidade | **REVISÃO HUMANA** |
| MÉDIA | P48/P56/P61 | Três Navels Ponto de Luz semelhantes | Manter separados até comparar desenho/pedra/fornecedor | Há históricos e imagens distintas; sem prova de duplicidade | **REVISÃO HUMANA** |
| MÉDIA | P63/P71 | Dois Labrets Flor Imperial semelhantes | Manter separados | Imagens sugerem desenhos/pedras diferentes, mas a confirmação física é necessária | **REVISÃO HUMANA** |
| MÉDIA | P171/V280 | Barbell curvo de umbigo básico sem comprimento/encaixe | Confirmar dimensões antes de comparar com P2/P13 | Produto novo sem imagem; somente movimento de inventário | **REVISÃO HUMANA** |
| BAIXA | V255 | Rose Gold anodizado isolado | Não converter sem conferir tonalidade física | Pode ser Rosé ou Dourado; sem imagem específica confiável | **REVISÃO HUMANA** |
| BAIXA | 18 produtos / 21 variações | Imagem genérica marcada como principal | Posteriormente escolher foto real já existente ou cadastrar nova | Nenhuma URL será alterada nesta etapa | **NÃO ALTERAR AGORA** |
| BAIXA | P163–P201 | 39 produtos novos sem imagem | Cadastro manual de imagens reais | Não reutilizar imagem por similaridade textual | **NÃO ALTERAR AGORA** |

## Estoques negativos: causa provável e proteção

V53 e V63 não possuem qualquer movimento, venda, agendamento, item de agendamento, reserva, contagem ou log de inventário associado. Assim, não é possível reconstruir matematicamente o saldo. A causa mais provável é um valor legado inserido/importado ou salvo diretamente antes da instrumentação de movimentos.

O código atual impede negativo nos fluxos de movimento manual, atendimento, venda e reserva. Entretanto, `replaceJewelryVariants()` aceita `Number(variant.quantity)` sem rejeitar valores negativos, e o PATCH do produto também aceita `quantity` diretamente. Proteção proposta para etapa posterior:

1. rejeitar quantidade negativa na API de edição de produto/variações;
2. adicionar teste de regressão para PATCH com quantidade negativa;
3. considerar `CHECK (quantity >= 0)` em migration separada somente depois de sanear os dois registros legados.

## Imagens para cadastro manual

### B — imagem genérica principal em variações

P13, P18, P21, P24, P28, P30, P33, P40, P41, P48, P51, P52, P57, P58, P59, P64, P65 e P77.

### C — sem imagem

P163 Segmento cravejado frontal pérolas; P164 Segmento coração meio cravejado; P165 Segmento coração cravejado; P166 Segmento cravejado especial; P167 Barbell reto com topo coração; P168 Navel haste Push Pin; P169 Navel completo topo 5 zircônias; P170 Navel flor cravejado; P171 Barbell curvo umbigo básico; P172 Floating Navel ponto de luz; P173 Barbell reto mamilo lateral opala branca; P174 Taper/Conector reto; P175 Taper/Conector curvo; P176 Taper/Conector Push Pin; P177 Bolinha; P178 Topo básico bolinha; P179 Topo 3 bolinhas; P180 Topo 4 esferas; P181 Topo chapado martelado; P182 Topo estrela 8 pontas; P183 Topo ramos 5 folhas; P184 Topo flor 3 pétalas; P185 Topo cluster opala negra; P186 Cluster 10 zircônias; P187 Topo esfera opala; P188 Topo esfera Moss; P189 Topo cluster 3 zircônias e 10 esferas; P190 Topo esfera azul; P191 Topo Opala 3 navetes; P192 Topo cluster retângulo 5 zircônias; P193 Topo Spike; P194 Surface haste; P195 Haste Microdermal; P196 Topo Microdermal Ágata Moss; P197 Topo Microdermal cravejado Flat; P198 Anzol ponto de luz; P199 L-Bar Christina; P200 Disco de silicone; P201 Pedra para piercing dental.

## Preservação e segurança

- Nenhuma quantidade foi recalculada, somada ou substituída.
- A conciliação das 98 linhas não foi reexecutada.
- As nove joias manuais não foram consultadas como candidatas nem alteradas.
- Nenhum INSERT, UPDATE, UPSERT, DELETE ou merge foi executado.
- Toda reorganização proposta preserva os `variation_id`; produtos novos seriam criados apenas depois de aprovação.
- Vendas, agendamentos, reservas, movimentações, imagens, preços, custos e financeiro permaneceram inalterados.

## Testes executados

- Workflow remoto somente leitura: **sucesso** (run 31715040351).
- Asserções do plano: **sucesso**; 11 correções de campo, 3 propostas estruturais, 11 revisões humanas, 9 linhas proibidas e escopo 2/tenant_2.
- Suíte backend: **418 testes; 416 passaram; 2 falharam**.
- Testes de proteção de estoque passaram: venda acima do estoque com e sem variação, soma de linhas contra o mesmo saldo, venda exata zerando saldo e rollback sem devolver conexão transacional ao pool.
- Falhas preexistentes e não relacionadas: `dashboard.test.mjs` (`revenueToday`, 100 × 250) e `pagination.test.mjs` (offset sem limit, HTTP 404 × 200).

**Escritas no banco: 0**  
**Outros tenants afetados: 0**
