# Relatório de execução — saneamento estrutural seguro

Data: 2026-08-13  
Workflow: `31717907725`  
Resultado: **COMMIT / AUDITORIA APROVADA**

## Escopo e totais

- Tenant: `aura-clinic` (`2`), Aura clinic piercing
- Schema: `tenant_2`
- Produtos: 123 antes, 125 depois
- Variações: 177 antes, 177 depois
- Unidades: 353 antes, 353 depois
- Outros tenants alterados: 0

## Correções aplicadas

- V296 foi movida de P15 para P178, preservando 2 unidades.
- V299, V300 e V301 foram movidas de P15 para o novo P202 (`Topo Chapado`), preservando 5 unidades cada.
- V312 foi movida de P15 para o novo P203 (`Topo Pérola`), preservando 2 unidades.
- `top_size_mm`: V28=2, V29=2,5, V30=3, V31=4 e V320=2.
- Categorias: P40=`Argolas`, P46=`Barbell Curvo`, P51=`Barbell Reto`.
- Encaixe: V277 e V291=`Push Pin`.
- Material: P200/V322=`Silicone`.

## Preservações validadas

- Quantidade individual de todas as 177 variações: inalterada.
- V53=-2 e V63=-1: preservadas.
- Grupos de revisão humana alterados: 0.
- Nove joias manuais alteradas: 0 (linhas 10, 29, 30, 50, 51, 52, 53, 54 e 57).
- Imagens alteradas: 0.
- Outros tenants alterados: 0.

## Proteção contra estoque negativo

- Backend rejeita criação, edição direta e lote com quantidade negativa.
- O lote inteiro é validado antes de qualquer gravação.
- Frontend impede quantidade menor que zero e apresenta mensagem de validação.
- Testes específicos: 30/30 aprovados.
- Suíte completa do backend: 473/473 aprovados.
- Build de produção do frontend: aprovado.

O log bruto emitido diretamente pela auditoria pós-commit está em `saneamento-auditoria.log`.
