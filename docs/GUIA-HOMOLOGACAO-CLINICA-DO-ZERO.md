# Guia de homologação ponta a ponta — clínica de piercing

> Objetivo: criar uma clínica nova, operar um ciclo completo e conferir se cada dado aparece no módulo correto.

> Segurança: faça tudo em uma conta/tenant de teste. Não use telefone, documento, foto, termo, assinatura ou dado de paciente real.

## 1. Como executar

Crie uma planilha de evidências com: caso, data/hora, perfil usado, dados/IDs criados, resultado esperado, resultado observado, evidência e situação (aprovado, falhou, bloqueado ou dúvida).

Use o prefixo QA- em todos os dados. Ele permite filtrar e remover o cenário sem misturar com a operação real.

~~~text
Clínica: QA Estúdio Aurora Piercing
Código/slug: qa-aurora-piercing
Administrador: qa.admin@aurora-teste.local
~~~
### Resultado final esperado

- usuários, profissionais, serviços e procedimentos;
- clientes, prontuários, termos e pós-atendimento;
- produtos com variações, materiais, compras e fornecedores;
- contas a pagar e receber originadas pelos eventos certos;
- agenda concluída, serviço executado e venda avulsa de produto;
- catálogo e agendamento públicos testados;
- relatórios/exportações comparados com os eventos criados.

## 2. Mapa do ciclo

~~~text
Configuração -> profissionais + serviços + catálogo
                         |
Fornecedores -> compras -> estoque de produtos -----> vendas -> contas a receber
                         |
                         -> materiais -> saídas de consumo

Cliente -> agenda -> termo + prontuário -> atendimento concluído
                                      |              |
                                      |              -> baixa de joia
                                      |              -> serviço executado
                                      |              -> recebimento / receber
                                      -> pós-atendimento

Catálogo público -> solicitação de agenda -> agenda interna
~~~

## 3. Preparação da clínica

### H-00 — criar e acessar a clínica

1. Abra Cadastro e crie QA Estúdio Aurora Piercing.
2. Use e-mail e senha temporários exclusivos de teste.
3. Entre com o código/slug criado.
4. Confirme nome da clínica no menu e Dashboard vazio.

**Esperado**

- Não há clientes, agenda, produtos, compras ou financeiro de outra clínica.
- Os módulos visíveis dependem do plano; item com cadeado deve ser registrado como limitação de plano, não como erro imediato.
- Um segundo login com o mesmo código da clínica funciona.

**Falha bloqueadora:** dado de outro tenant aparece na conta nova.

### H-01 — identidade, horários e bloqueio

No Onboarding/configurações, use:

| Campo | Valor de teste |
| --- | --- |
| Nome público | QA Estúdio Aurora Piercing |
| Responsável | Marina QA Souza |
| WhatsApp | 77990000001 |
| E-mail | contato@aurora-teste.local |
| Endereço | Rua da Homologação, 100 — Centro — Vitória da Conquista/BA |
| Horário | terça a sábado, 10:00–19:00 |
| Cor da marca | #6D3B73 |

Crie bloqueio: QA-Bloqueio, segunda-feira de 09:00 a 13:00, motivo limpeza e manutenção.

**Esperado:** bloqueio não pode ser reservado no agendamento público nem na Agenda.

## 4. Pessoas, serviços e permissões

### H-02 — profissionais

| Nome | Papel | Comissão | Disponibilidade |
| --- | --- | ---: | --- |
| QA Marina Piercer | principal | 40% | ter–sáb, 10:00–19:00 |
| QA Rafael Piercer | auxiliar | 35% | qua–sáb, 12:00–19:00 |

Verifique: ambos aparecem nos filtros; horário de Marina não bloqueia Rafael; profissional inativo não entra em novo atendimento.

### H-03 — catálogo de serviços

Crie os serviços abaixo e vincule quem pode executá-los.

| Serviço | Duração | Preço | Sinal | Profissionais |
| --- | ---: | ---: | ---: | --- |
| QA Perfuração lóbulo unitário | 30 min | R$ 90,00 | R$ 30,00 | Marina, Rafael |
| QA Perfuração hélix | 45 min | R$ 120,00 | R$ 40,00 | Marina |
| QA Perfuração nostril | 45 min | R$ 140,00 | R$ 50,00 | Marina, Rafael |
| QA Troca de joia | 20 min | R$ 35,00 | R$ 0,00 | Marina, Rafael |

Se existir a camada de procedimentos, crie QA Hélix simples e QA Nostril ponto de luz.

**Esperado:** somente Marina é elegível para Hélix. Arquivar serviço preserva histórico e impede novo agendamento.

### H-04 — usuários e perfis

Crie, se o plano permitir:

| Usuário | E-mail | Perfil | Validar |
| --- | --- | --- | --- |
| QA Recepção | qa.recepcao@aurora-teste.local | recepção | agenda, clientes e vendas |
| QA Financeiro | qa.financeiro@aurora-teste.local | financeiro | compras, pagar, receber, relatórios |
| QA Piercer | qa.piercer@aurora-teste.local | piercer | agenda, prontuário e pós |

Em outro navegador, entre com cada perfil. Tente abrir por URL uma página proibida.

**Esperado:** o perfil não vê nem acessa páginas sem permissão.

## 5. Financeiro base e fornecedores

### H-05 — cadastros auxiliares

Fornecedores:

| Nome | Uso |
| --- | --- |
| QA Titanium Brasil Ltda. | joias de revenda |
| QA Medical Supply Ltda. | luvas e agulhas |
| QA Água Serra Azul | água para atendimento |

Categorias:

~~~text
Receitas: Serviços de piercing; Venda de joias; Troca de joia
Despesas: Materiais de consumo; Compra para revenda; Marketing; Aluguel
Centros: QA Atendimento; QA Estoque/Loja; QA Administração
~~~

**Esperado:** fornecedor aparece em Compras; categoria e centro de custo aparecem nos lançamentos manuais. Não crie grafias alternativas como Descartáveis e Descartaveis.

## 6. Produtos, variações e catálogo

### H-06 — categorias de teste

Cadastre/valide somente estas famílias:

~~~text
QA Argolas
QA Labrets
QA Topos
QA Acessórios
~~~

Evite criar Argola, Argolas e Argolas / Segmentos como famílias diferentes. Detalhes como Clicker e D-Ring ficam como subcategoria/variação até a taxonomia canônica ser concluída.

### H-07 — produtos e variações

Cadastre com saldo inicial zero; a entrada virá por compra.

| Produto pai | Categoria | Variações | Venda |
| --- | --- | --- | ---: |
| QA Labret haste reta titânio | QA Labrets | 6 mm / 1,2 mm / Natural; 8 mm / 1,2 mm / Natural; 8 mm / 1,2 mm / Dourado | R$ 55,00; R$ 60,00; R$ 65,00 |
| QA Argola clicker lisa | QA Argolas | 8 mm / 1,2 mm / Natural; 10 mm / 1,2 mm / Natural | R$ 85,00; R$ 90,00 |
| QA Topo ponto de luz | QA Topos | 2 mm / Natural; 3 mm / Natural | R$ 45,00; R$ 50,00 |
| QA Disco de silicone | QA Acessórios | única | R$ 8,00 |

SKUs sugeridos:

~~~text
QA-LAB-06-12-NAT
QA-LAB-08-12-NAT
QA-LAB-08-12-DOR
QA-CLK-08-12-NAT
QA-TOP-03-NAT
~~~

Inclua descrição e imagem principal. Em um produto, inclua imagem adicional.

**Verificações**

- SKU duplicado é recusado.
- Produto pai totaliza suas variações.
- Preço/custo de uma variação não altera as demais.
- Produto arquivado não entra em venda nem catálogo.
- Produto com saldo zero não pode ser comprado como disponível.

### H-08 — catálogo público

Em janela anônima:

1. Abra o catálogo.
2. Filtre por categoria, material, cor, tamanho e disponibilidade.
3. Abra QA Labret haste reta titânio, troque a variação e confira preço/imagem.
4. Desligue Visível no catálogo público em QA Disco de silicone.
5. Atualize o catálogo.

**Esperado**

- Item desligado some do catálogo, reserva e compra pública.
- Variação zero permanece zero; nunca herda saldo do produto pai.
- Somente produtos com publicação completa aparecem.

## 7. Materiais, compras e contas a pagar

### H-09 — materiais de consumo

Cadastre em Materiais:

| Material | Unidade | Mínimo | Custo de referência |
| --- | --- | ---: | ---: |
| QA Luva nitrílica preta P | caixa | 2 | R$ 42,00 |
| QA Agulha descartável 18G | unidade | 20 | R$ 3,50 |
| QA Gaze estéril | pacote | 3 | R$ 12,00 |
| QA Água mineral 500 ml | unidade | 12 | R$ 3,00 |
| QA Antisséptico | frasco | 1 | R$ 28,00 |

**Esperado:** material não aparece em Produtos, Vendas ou Catálogo; saída acima do saldo é recusada.

### H-10 — compra de revenda

Compra em QA Titanium Brasil Ltda.:

| Item | Quantidade | Custo unitário |
| --- | ---: | ---: |
| QA-LAB-08-12-NAT | 10 | R$ 22,00 |
| QA-CLK-08-12-NAT | 5 | R$ 35,00 |
| QA Topo ponto de luz 3 mm | 8 | R$ 16,00 |

Parcelas: R$ 300,00 para 10 dias e R$ 223,00 para 40 dias.

Confirme a compra.

**Esperado:** as variações corretas aumentam; duas parcelas aparecem em Contas a pagar; confirmar/reenviar não duplica estoque nem títulos.

### H-11 — compra de consumo

Compra em QA Medical Supply Ltda.:

| Material | Quantidade | Custo unitário |
| --- | ---: | ---: |
| QA Luva nitrílica preta P | 4 caixas | R$ 42,00 |
| QA Agulha descartável 18G | 50 | R$ 3,50 |
| QA Água mineral 500 ml | 24 | R$ 3,00 |

Parcelas: R$ 200,00 para 15 dias e R$ 215,00 para 45 dias.

**Esperado:** somente Materiais aumenta e as parcelas aparecem em Pagar. Não crie despesa manual adicional para a mesma nota.

### H-12 — saídas e ajuste de materiais

Registre:

~~~text
Agulha 18G: saída 2 — teste QA de perfuração hélix
Luva nitrílica: saída 1 caixa — abertura de rotina
Água 500 ml: saída 3 — atendimento e recepção
Gaze estéril: ajuste com motivo "contagem física QA"
~~~

**Automação entregue:** configure a ficha técnica do serviço antes deste teste. Ao concluir o atendimento, o sistema deve baixar automaticamente luva, agulha e demais materiais da receita, congelar o consumo no atendimento e consumir os lotes por FEFO. A saída manual acima continua útil para perdas, uso administrativo e contagem física.

Cadastre dois lotes sem aumentar o saldo e tente cadastrar um terceiro cuja soma ultrapasse a quantidade do material. O terceiro lote deve ser recusado. Em seguida, faça uma saída e confirme que o lote com validade mais próxima diminuiu primeiro.

## 8. Clientes, agenda e atendimento

### H-13 — clientes

| Cliente | WhatsApp | Caso de teste |
| --- | --- | --- |
| QA Ana Clara Lima | 77990000011 | atendimento com saldo pendente |
| QA Bruno Alves | 77990000012 | venda à vista e parcelada |
| QA Carla Mendes | 77990000013 | agenda pública e remarcação |

Na ficha de Ana, inclua a nota fictícia: QA: alergia a níquel; usar somente titânio.

Verifique busca por nome/WhatsApp e isolamento da ficha entre clientes.

### H-14 — agenda com sinal

Crie para QA Ana Clara Lima:

| Campo | Valor |
| --- | --- |
| Serviço | QA Perfuração hélix |
| Profissional | QA Marina Piercer |
| Horário | próximo horário livre de Marina |
| Joia/variação | QA Labret / QA-LAB-08-12-NAT |
| Serviço | R$ 120,00 |
| Joia | R$ 60,00 |
| Total | R$ 180,00 |
| Sinal Pix | R$ 40,00 |
| Saldo | R$ 140,00 |

Tente duplicar o horário de Marina.

**Esperado:** conflito é recusado; sinal e saldo ficam no atendimento; joia/variação são identificáveis.

### H-15 — prontuário e termo

Antes da conclusão:

1. Registre prontuário fictício com histórico, alergia e orientação.
2. Gere termo digital com assinatura desenhada apenas para teste.
3. Anexe apenas arquivo fictício/placeholder, se a tela permitir.

**Esperado:** prontuário e termo ficam somente na ficha do cliente; termo gera registro/PDF ou equivalente; nada é público.

### H-16 — concluir atendimento

Conclua a agenda de Ana e confira:

| Módulo | Resultado esperado |
| --- | --- |
| Agenda | status atendido, sinal e saldo preservados |
| Serviços | linha de serviço executado, derivada da Agenda |
| Estoque | QA-LAB-08-12-NAT reduz 1 com movimento de origem |
| Receber | saldo de R$ 140,00, uma única vez |
| Pós-atendimento | lembretes criados |
| Fidelidade | pontos, se o recurso/plano estiver ativo |

**Não esperado:** duas baixas da joia, dois recebíveis para o mesmo saldo, ou venda avulsa criada para representar o serviço.

### H-17 — pagamentos e pós-atendimento

1. Baixe R$ 100,00 do saldo de Ana via cartão.
2. Confira saldo pendente de R$ 40,00.
3. Baixe R$ 40,00 via Pix em outra data.
4. Registre pós-atendimento:

~~~text
Cicatrização dentro do esperado.
Sem sinais de irritação.
Orientada a retornar em 30 dias.
~~~

**Esperado:** pagamentos parciais não criam novo título; o título só encerra ao totalizar R$ 140,00.

### H-18 — remarcação e cancelamento

Para QA Carla Mendes, crie perfuração nostril com sinal de R$ 50,00:

1. Remarque para horário livre.
2. Tente remarcar para o bloqueio H-01.
3. Cancele antes de atender e escolha explicitamente entre retenção do sinal, crédito do cliente ou reembolso manual.
4. Repita com uma agenda sem pagamento e use “Sem pagamento recebido”.

**Esperado:** cancelamento direto por simples troca de status é recusado; cada resolução fica auditada. Crédito passa a aparecer na ficha do cliente e reembolso manual gera despesa financeira rastreável.

## 9. Venda avulsa

### H-19 — venda paga à vista

Para QA Bruno Alves:

| Item | Variação | Qtd. | Valor |
| --- | --- | ---: | ---: |
| QA Argola clicker lisa | QA-CLK-08-12-NAT | 1 | R$ 85,00 |
| QA Disco de silicone | única | 1 | R$ 8,00 |

Forma: dinheiro; status concluída/paga.

**Esperado:** Vendas aceita apenas produtos; estoque baixa nas linhas certas; não cria recebível pendente para pagamento à vista.

### H-20 — venda parcelada

Venda para Bruno:

~~~text
1 x QA Topo ponto de luz 3 mm = R$ 50,00
Parcela 1: R$ 25,00 hoje via Pix
Parcela 2: R$ 25,00 em 30 dias via cartão
~~~

**Esperado:** duas parcelas independentes; baixa da primeira não encerra a segunda; estoque reduz uma única vez na conclusão.

### H-21 — saldo insuficiente e devolução

1. Tente vender acima do estoque.
2. Tente concluir com variação esgotada.
3. Após venda concluída, faça uma devolução parcial vendável e gere crédito do cliente.
4. Faça devolução de item danificado, sem retorno ao estoque, com reembolso manual.

**Esperado nos itens 1 e 2:** recusa sem saldo negativo ou gravação parcial.

**Esperado nas devoluções:** somente a quantidade selecionada retorna; itens danificados não voltam ao saldo; a soma devolvida nunca supera a venda; títulos pendentes são reduzidos antes de gerar crédito ou reembolso sobre valores já recebidos.

## 10. Público, financeiro e relatórios

### H-22 — agendamento público

Em navegador anônimo:

1. Abra o agendamento público.
2. Escolha QA Perfuração nostril, profissional compatível e horário livre.
3. Use QA Carla Mendes.
4. Selecione joia publicada com saldo.
5. Envie e trate a solicitação no painel interno.

**Esperado:** serviços/profissionais inativos não aparecem; bloqueio/horário ocupado é recusado; joia não publicada não pode ser enviada; solicitação não duplica cliente/horário.

### H-23 — compra pública, se habilitada

Se a configuração permitir compra pública:

1. Adicione variação disponível ao carrinho.
2. Tente quantidade maior que saldo.
3. Envie pedido com dados fictícios e aceite das políticas.
4. Confira pedido, reserva/baixa e receber.

Se estiver desativada, marque não aplicável por configuração/plano.

### H-24 — pagar, receber e lançamentos manuais

Em Pagar, localize H-10 e H-11, baixe uma parcela e deixe outra pendente. Crie despesa manual:

~~~text
Descrição: QA limpeza profissional do estúdio
Categoria: Administração
Centro: QA Administração
Valor: R$ 180,00
Vencimento: próximo dia útil
~~~

Em Receber, confira lado a lado:

| Origem | Esperado |
| --- | --- |
| Atendimento Ana | sinal + saldo baixado em H-17 |
| Venda H-19 | pago à vista |
| Venda H-20 | duas parcelas independentes |

O total financeiro não pode somar duas vezes agenda, serviço, venda técnica e pagamento.

### H-25 — relatórios/exportações

Filtre por período, profissional e categoria. Exporte CSV/PDF/XLSX se habilitado.

Conferência:

~~~text
Receita de serviços: Ana, uma vez.
Receita de produtos: H-19 e H-20.
Despesas: compras H-10/H-11 e limpeza avulsa.
Estoque: entradas H-10/H-11 e saídas H-12, H-16, H-19/H-20.
~~~

Abra o arquivo e confirme moeda, data, filtros, cabeçalhos e ausência de outra clínica.

## 11. Comunicações, privacidade e suporte

### H-26 — comunicações sem envio real

Em Comunicações/Integrações, use apenas dados de teste:

- visualizar templates, automações, fila e histórico;
- testar opt-in/opt-out se disponível;
- registrar crédito de comunicação somente como cenário local.

Não use token, chave, telefone ou conta de produção.

**Lacuna M-04:** WhatsApp oficial com créditos depende do plano específico: BSP/Meta, onboarding por tenant, webhook, templates aprovados, worker, opt-in e checkout idempotente.

### H-27 — suporte e privacidade

Se os recursos estiverem liberados:

1. Abra chamado QA — dúvida sobre estoque de materiais.
2. Registre solicitação fictícia de titular/LGPD, sem dado pessoal real.
3. Confira que perfil sem acesso não vê prontuário, termo, segredo ou dado de outro tenant.

## 12. Regressão obrigatória

| Código | Tentativa | Resultado correto |
| --- | --- | --- |
| R-01 | vender acima do saldo | recusar sem baixa parcial |
| R-02 | concluir duas vezes a mesma agenda | não duplicar estoque, receber ou pontos |
| R-03 | reenviar confirmação de compra | não duplicar entrada/pagar |
| R-04 | abrir produto não publicado por URL pública | não exibir nem reservar |
| R-05 | baixar recebível duas vezes | não ultrapassar título |
| R-06 | agendar horário ocupado/bloqueado | recusar |
| R-07 | recepção abrir Acessos por URL | negar |
| R-08 | alternar tenant | nunca misturar dados |
| R-09 | arquivar produto com histórico | preservar histórico; impedir nova venda |
| R-10 | remover variação usada | preservar referência/arquivar sem corromper |

## 13. Lacunas e módulos recomendados

| Código | Lacuna | Evolução proposta |
| --- | --- | --- |
| M-01 | consumo não baixa por procedimento | ficha técnica de serviço: material + quantidade; baixa ao concluir agenda |
| M-02 | sinal/cancelamento/reembolso sem política clara | módulo de cancelamento da agenda com retenção, devolução, crédito ou transferência |
| M-03 | devolução/troca/estorno pós-venda | fluxo auditável com retorno de estoque e reversão financeira |
| M-04 | WhatsApp oficial com créditos pendente | executar plano de onboarding, templates, webhook, worker e cobrança |
| M-05 | categorias de estoque/catálogo fragmentadas | taxonomia canônica pai/filha e migração assistida |
| M-06 | pendências de qualidade de estoque dispersas | painel de saúde: saldo negativo, preço zero, SKU/imagem/categoria ausentes |
| M-07 | materiais estéreis sem lote/validade | lote, validade, alerta e baixa FEFO, se requerido pela clínica |

## 14. Aprovação e reporte

A rodada é aprovada somente se todos os casos aplicáveis estiverem com evidência, R-01 a R-10 passarem, os valores de estoque/pagar/receber fecharem e M-01 a M-07 tiverem prioridade definida.

Modelo de defeito:

~~~text
BUG-YYYY-NNN — título curto
Ambiente: local/homologação
Perfil: QA Financeiro
Pré-condição: compra QA Medical Supply confirmada
Passos: abrir Pagar; baixar parcela; atualizar.
Esperado: parcela paga e saldo recalculado.
Observado: descrever com precisão.
Dados/IDs: compra #..., título #...
Evidência: captura, vídeo ou resposta sem dados sensíveis.
Severidade: bloqueadora / alta / média / baixa.
~~~
