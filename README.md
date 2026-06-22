# Aura Clinic Piercing

MVP local para gestão da Aura Clinic Piercing: agenda, estoque de joalherias, catálogo público, clientes, financeiro, prontuários, termos digitais, pós-atendimento, fidelidade e acessos administrativos.

## Tecnologias

- Frontend: React + Vite
- Backend: Node.js + Express
- Banco: SQLite local
- Uploads locais: `server/data/uploads`
- Autenticacao: token assinado no login e envio via `Authorization: Bearer`

## Como rodar

Instale as dependencias:

```bash
npm install
```

Rode o sistema:

```bash
npm run dev
```

No PowerShell do Windows, se aparecer bloqueio de script do `npm.ps1`, use:

```powershell
npm.cmd run dev
```

Depois acesse:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health`

## Login de teste

- Senha: `aura123` (defina `VITE_ADMIN_PASSWORD` em `.env.local`)

Se a sessao antiga ficar invalida depois de atualizacoes de autenticacao, saia do sistema ou limpe o armazenamento do navegador e entre novamente.

## Estrutura

```text
server/
  database.js       Schema SQLite, seeds e dados de exemplo
  index.js          API Express, autenticacao, permissoes e rotas
  data/             Banco local, PDFs e uploads
src/
  main.jsx          Aplicacao React, layout, telas e componentes
  styles.css        Identidade visual premium e responsividade
public/
  placeholder-*.svg Assets locais de exemplo
```

## Funcionalidades estaveis

- Login administrativo com token assinado
- Menu lateral e layout principal responsivo
- Permissoes por perfil no frontend
- Protecao de rotas sensiveis no backend
- **Separação entre site público e painel administrativo (novo)**
- Dashboard premium com indicadores, alertas e graficos
- Agendamento manual em modal e agenda pública com horários por profissional
- Agenda visual mensal, semanal e diária
- Estoque profissional no modelo `Categoria → Produto → Variações`
- Quantidade, SKU, custo, venda e estoque mínimo controlados por variação
- Catálogo público integrado ao estoque e seletor de variações
- Financeiro com despesas, lucro estimado e exportacao CSV/PDF/Excel
- Clientes com historico, busca, prontuario e WhatsApp
- Termo digital com assinatura e PDF
- Pos-atendimento com lembretes de 7, 15 e 30 dias
- Fidelidade com pontos, niveis e resgates
- Acessos administrativos por papel

## Segurança e Acesso

### Rotas públicas (sem autenticação)
- `/` - Página inicial
- `/catalogo` - Catálogo de produtos publicados
- `/agendar` - Agendamento público
- `/comprar` - Checkout público

### Rotas administrativas (autenticação obrigatória)
- `/admin` - Dashboard administrativo
- `/admin/estoque` - Gestão de estoque e produtos
- `/admin/agenda` - Agenda interna
- `/admin/clientes` - Base de clientes
- `/admin/financeiro` - Relatórios financeiros
- `/admin/configuracoes` - Configurações do sistema

### Proteção de dados

O catálogo público mostra apenas:
- Nome, foto, categoria, material, tamanho, cor
- Preço final (sale_value)
- Variações disponíveis
- Estoque disponível (somente se quantidade > 0)

**Dados ocultos do público:**
- Custo de produção (cost_value)
- Lucro estimado
- Fornecedor
- Observações internas
- Endereço físico do estoque
- Dados de clientes
- Financeiro interno
- Relatórios

### Autenticação

1. Copie `.env.example` para `.env.local`
2. Defina `VITE_ADMIN_PASSWORD` com uma senha forte
3. Acesse `/login` e digite a senha
4. Sessão salva em `localStorage` (aura-admin-authenticated)

**Em produção:**
- Use HTTPS obrigatoriamente
- Altere `AUTH_SECRET` e `VITE_ADMIN_PASSWORD` com valores únicos
- Configure variáveis de ambiente no servidor

## Banco de dados

O SQLite e criado automaticamente em:

```text
server/data/aura-clinic.sqlite
```

Tabelas principais:

- `users`
- `clients`
- `appointments`
- `jewelry_inventory`
- `jewelry_variants`
- `stock_movements`
- `payments`
- `professionals`
- `inventory_options`
- `expenses`
- `client_medical_records`
- `digital_terms`
- `post_care_followups`
- `loyalty_points`
- `loyalty_redemptions`

Para reiniciar os dados de exemplo, pare o servidor, apague `server/data/aura-clinic.sqlite` e rode `npm run dev` novamente.

## Niveis de acesso

- `admin`: acessa tudo
- `reception`: agenda, agendamentos e clientes
- `finance`: financeiro e relatórios
- `piercer`: atendimentos, clientes, prontuários e pós-atendimento

## Rotas principais

- `POST /api/login`
- `GET /api/health`
- `GET /api/dashboard`
- `GET/POST/PATCH /api/appointments`
- `GET/POST/PATCH/DELETE /api/jewelry`
- `POST /api/jewelry/:id/variants/:variantId/movements`
- `GET /api/catalog`
- `GET /api/booking/slots`
- `GET/PATCH /api/clients`
- `GET /api/finance`
- `GET /api/finance/export.csv`
- `GET /api/finance/export.pdf`
- `GET /api/finance/export.xlsx`
- `GET/POST/PATCH/DELETE /api/users`

## Observações de produção

Este projeto ainda e um MVP local. Para producao SaaS, o proximo passo recomendado e migrar para TypeScript, PostgreSQL, JWT com refresh token, Cloudinary e isolamento multiempresa por `tenant_id`.
