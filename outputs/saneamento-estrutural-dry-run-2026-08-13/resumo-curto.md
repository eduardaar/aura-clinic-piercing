# Resumo curto do dry-run estrutural

Correções consideradas seguras após aprovação:

- separar V296, V299–V301 e V312 de P15 preservando IDs e quantidades;
- preencher `top_size_mm` de V28–V31 e V320;
- corrigir categorias de P40, P46 e P51;
- definir Push Pin em V277 e V291;
- corrigir P200/V322 para material Silicone.

Devem permanecer para revisão humana:

- P1/V283; P45/P167; P4; P2/P13; P48/P56/P61; P63/P71; P171; V255; material de P201;
- estoques negativos V53=-2 e V63=-1, pois não existe histórico suficiente para reconstrução;
- imagens genéricas ou ausentes.

O código atual bloqueia negativos em movimentos, vendas, reservas e atendimentos, mas a edição em lote de variações ainda aceita quantidade negativa e deve ser protegida em etapa posterior.

**Escritas no banco: 0. Outros tenants afetados: 0.**
