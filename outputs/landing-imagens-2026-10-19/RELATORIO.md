# Imagens da página principal — 19/10/2026

As quatro imagens JFIF fornecidas na Área de Trabalho foram copiadas, sem recompressão, para `frontend/public/assets/landing/features/` com extensão JPEG. Correspondem aos recursos Agendamento online, Controle de estoque, Ficha digital e Controle financeiro.

Os blocos deixaram de ter altura fixa de 120–140 px. No computador as fotos ocupam a maior coluna, alternando com o texto; no celular ficam acima do texto. A proporção original é mantida, sem corte. Dimensões intrínsecas declaradas e carregamento adiado das imagens.

Conteúdo embutido, semente SQL e migration de plataforma `0009_landing_feature_images.sql` atualizados. A migration encontra os recursos pelos títulos antigos ou novos e mantém a ordem, os campos extras e os outros itens personalizados.

Validação concluída:

- 8 testes de componente da landing e 19 testes de API aprovados.
- Build de produção aprovado.
- Chromium e WebKit em 320, 390, 768 e 1366 px, usando API real e banco descartável: imagens carregadas, proporções preservadas e sem rolagem horizontal.
- Atualização de conteúdo antigo e reaplicação do SQL conferidas em transação revertida no banco descartável.
- Capturas dos recursos e medições em `results.json`. Elementos flutuantes ocultados somente nas capturas para não cobrir os recursos.

Não publicado. Aplicar a migration de plataforma na publicação; o deploy atual não aplica migrations automaticamente. Nenhuma alteração na base de trabalho ou produção.
