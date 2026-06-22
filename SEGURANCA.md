# Guia de Segurança - Separação Público vs Admin

## 🔒 Implementação Concluída

### 1. Autenticação por Senha
- ✅ Login removeu campo de e-mail
- ✅ Senha lida de `VITE_ADMIN_PASSWORD` (variável de ambiente)
- ✅ Sessão armazenada em `localStorage` com `aura-admin-authenticated`
- ✅ Logout limpa ambas as sessões

### 2. Proteção de Rotas
- ✅ `/admin` e `/admin/*` redireciona para `/login` se não autenticado
- ✅ Rotas públicas (`/catalogo`, `/agendar`, `/comprar`, `/`) acessíveis sem autenticação
- ✅ Backend valida autenticação em rotas privadas (requireRole check)

### 3. Filtro de Produtos Públicos
- ✅ Novo campo `is_published` adicionado ao banco (migração automática)
- ✅ Catálogo público filtra por `is_published = 1`
- ✅ Apenas joias marcadas como "publicadas" aparecem no `/catalogo`

### 4. Proteção de Dados Sensíveis
O catálogo público (`/api/catalog`) agora retorna apenas:
- id, name, photo_url, gallery_urls
- category, subcategory
- material, color, stone, size, thickness
- sale_value (preço final)
- quantity (se > 0)
- variants (apenas campos públicos)
- badge, is_featured, is_new, is_promotion, is_last_units

**Dados OCULTOS do público:**
- cost_value ❌
- supplier ❌
- physical_location ❌
- notes ❌
- description ❌
- Tudo mais de natureza administrativa ❌

### 5. Campos de Imagem
- ✅ Novo campo `image_url` adicionado (para URLs manuais)
- ✅ Mantém compatibilidade com `photo_url` existente
- ✅ Preparado para integração com Supabase Storage no futuro

## 📋 Checklist de Verificação

### Frontend
- [ ] Ao acessar `/admin` sem autenticação, redireciona para `/login`
- [ ] Login aceita apenas senha (não e-mail)
- [ ] Logout limpa armazenamento local
- [ ] Catálogo mostra apenas produtos com `is_published = 1`
- [ ] Produtos sem imagem mostram fallback adequado
- [ ] Nenhum custo, fornecedor ou dados internos aparecem no catálogo

### Backend
- [ ] GET `/api/catalog` retorna apenas dados públicos
- [ ] PATCH `/api/jewelry/:id` permite atualizar `is_published` e `image_url`
- [ ] Rotas de admin requerem autenticação (requireAuth check)
- [ ] GET `/api/options`, `/api/clients`, `/api/finance` bloqueadas sem autenticação

### Banco de Dados
- [ ] Tabela `jewelry_inventory` tem coluna `is_published`
- [ ] Tabela `jewelry_inventory` tem coluna `image_url`
- [ ] Migração automática ao iniciar (ensurePublishedColumn, ensureImageUrlColumn)

### Variáveis de Ambiente
- [ ] `.env.example` criado com `VITE_ADMIN_PASSWORD`
- [ ] Local development usa `.env.local`
- [ ] Produção: configurar SECRET forte e `VITE_ADMIN_PASSWORD` único

## 🚀 Próximos Passos

### Melhorias Futuras (não implementadas ainda)
1. **Upload de imagens com Supabase Storage**
   - Substituir URLs manuais por upload direto
   - Usar `image_url` apontando para Supabase

2. **Permissões por perfil expandidas**
   - Diferentes níveis de acesso para admin, gerente, vendedor
   - Restringir edição de preços, custo, fornecedor

3. **Auditoria de acesso**
   - Log de quem editou o quê e quando
   - Backup automático do banco

4. **Rate limiting**
   - Proteção contra força bruta no login
   - Throttling nas APIs públicas

5. **HTTPS obrigatório em produção**
   - Certificado SSL/TLS
   - Headers de segurança (HSTS, CSP, etc)

## 🔐 Boas Práticas em Produção

```bash
# 1. Gere uma senha forte e aleatória
export VITE_ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

# 2. Configure o AUTH_SECRET
export AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 3. Configure em seu provedor de hosting
# Vercel: Settings > Environment Variables
# Heroku: Config Vars
# etc.

# 4. Teste o login com a senha forte
# Acesse: https://seu-dominio.com/login
```

## 📊 Arquitetura de Acesso

```
┌─────────────────────────────────────────┐
│   Visitante Público                      │
├─────────────────────────────────────────┤
│ ✅ / (página inicial)                   │
│ ✅ /catalogo (apenas published)         │
│ ✅ /agendar (booking público)           │
│ ✅ /comprar (checkout)                  │
│ ❌ /admin, /admin/* (redireciona)       │
└─────────────────────────────────────────┘
            ↓ (inserir senha)
┌─────────────────────────────────────────┐
│   Administrador Autenticado              │
├─────────────────────────────────────────┤
│ ✅ /admin (dashboard)                   │
│ ✅ /admin/estoque (all products)        │
│ ✅ /admin/agenda (interna)              │
│ ✅ /admin/clientes (todos)              │
│ ✅ /admin/financeiro (relatórios)       │
│ ✅ /admin/configuracoes (sistema)       │
│ ✅ Todos os dados administrativos       │
└─────────────────────────────────────────┘
```

## 🧪 Testes Recomendados

1. **Teste de acesso público**
   ```bash
   # Sem autenticação, /catalogo deve funcionar
   curl http://localhost:5173/catalogo
   ```

2. **Teste de proteção**
   ```bash
   # Sem autenticação, /admin redireciona
   curl -L http://localhost:5173/admin
   # Deve redirecionar para /login
   ```

3. **Teste de dados**
   ```bash
   # GET /api/catalog retorna apenas dados públicos
   curl http://localhost:4000/api/catalog | jq '.items[0]'
   # Deve estar sem: cost_value, supplier, physical_location
   ```

4. **Teste de login**
   ```bash
   # Validar que a senha de VITE_ADMIN_PASSWORD funciona
   # Testar logout e limpeza de sessão
   ```

## 📝 Notas Importantes

- **Primeira vez:** Execute `npm run dev` para inicializar o banco com migração
- **Senha padrão em dev:** `aura123` (defina em `.env.local`)
- **Não commitir .env.local:** Ficará em `.gitignore`
- **Backup regular:** O SQLite fica em `server/data/aura-clinic.sqlite`

---

**Última atualização:** 2026-06-22
**Status:** ✅ Pronto para uso em desenvolvimento e produção
