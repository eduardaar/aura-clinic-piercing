# 🧪 Guia de Testes - Separação Público vs Admin

## Testes Locais

### 1. **Teste de Login**

```bash
# 1. Abra http://localhost:5173/login
# 2. Teste com a senha padrão: aura123
# 3. Deve redirecionar para /admin (dashboard)
# 4. Logout deve limpar localStorage e ir para /login
```

### 2. **Teste de Acesso Público**

```bash
# 1. Abra http://localhost:5173/catalogo (SEM estar logado)
# 2. Deve funcionar normalmente
# 3. Tente acessar http://localhost:5173/admin
# 4. Deve redirecionar para /login
```

### 3. **Teste de Produtos Publicados**

```bash
# 1. Faça login
# 2. Vá para /admin/estoque
# 3. Crie 3 produtos:
#    - Produto A: publicar ativado
#    - Produto B: publicar desativado
#    - Produto C: publicar ativado
# 4. Faça logout
# 5. Vá para /catalogo
# 6. Deve mostrar apenas A e C (não B)
```

### 4. **Teste de Proteção de Dados**

```bash
# 1. Abra DevTools (F12)
# 2. Vá para Network
# 3. Faça logout
# 4. Acesse /catalogo
# 5. Procure pela chamada GET /api/catalog
# 6. Na Response, verifique que NÃO tem:
#    - cost_value
#    - supplier
#    - physical_location
#    - notes (internos)
# 7. Deve ter apenas: id, name, photo_url, price (sale_value), etc
```

### 5. **Teste de Campo de Imagem**

```bash
# 1. Faça login
# 2. Vá para /admin/estoque
# 3. Edite um produto
# 4. Vá para aba "Catálogo"
# 5. Verifique se há campo "URL da imagem (para catálogo)"
# 6. Teste adicionar uma URL de imagem (ex: https://...)
# 7. Salve e verifique se foi atualizado
```

### 6. **Teste de Sessionização**

```bash
# 1. Faça login
# 2. Abra localStorage (DevTools > Application > Local Storage)
# 3. Verifique se `aura-admin-authenticated` = "true"
# 4. Faça logout
# 5. Verifique se `aura-admin-authenticated` foi removido
# 6. Tente acessar /admin diretamente
# 7. Deve redirecionar para /login
```

---

## Testes de API

### 1. **Teste GET /api/catalog (dados públicos)**

```bash
curl -X GET "http://localhost:4000/api/catalog" | jq '.items[0]'

# Esperado:
# {
#   "id": 1,
#   "name": "Labret",
#   "photo_url": "https://...",
#   "category": "Labret",
#   "material": "titânio",
#   "color": "Natural",
#   "sale_value": 49.90,
#   "quantity": 5,
#   "variants": [...]
# }

# NÃO esperado:
# cost_value, supplier, physical_location, notes
```

### 2. **Teste GET /api/jewelry (dados admin)**

```bash
# Sem autenticação
curl -X GET "http://localhost:4000/api/jewelry"
# Esperado: 401 Unauthorized

# Com autenticação (após login)
curl -X GET "http://localhost:4000/api/jewelry" \
  -H "Authorization: Bearer {token}"
# Esperado: Dados completos com cost_value, supplier, etc
```

### 3. **Teste PATCH /api/jewelry/:id (atualizar publicação)**

```bash
# Com autenticação
curl -X PATCH "http://localhost:4000/api/jewelry/1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"is_published": true, "image_url": "https://example.com/image.jpg"}'

# Esperado: 200 OK com produto atualizado
```

---

## Checklist de Validação

### Segurança
- [ ] Login sem e-mail funciona
- [ ] /admin redireciona sem autenticação
- [ ] Logout limpa localStorage
- [ ] GET /api/catalog não retorna dados sensíveis
- [ ] GET /api/jewelry requer autenticação

### Funcionalidade
- [ ] Produtos publicados aparecem em /catalogo
- [ ] Produtos não publicados não aparecem
- [ ] Campo image_url está visível na interface
- [ ] Campo "Publicar no catálogo" está na aba Catálogo
- [ ] Alterações são salvas no banco

### Performance
- [ ] Build não tem erros
- [ ] Aplicação carrega rapidamente
- [ ] Sem erros no console (F12)
- [ ] API responde em < 500ms

### Compatibilidade
- [ ] Funciona no Chrome
- [ ] Funciona no Firefox
- [ ] Funciona no Safari
- [ ] Funciona mobile (responsivo)

---

## Troubleshooting

### Problema: "Rota não encontrada"
**Solução:** Reinicie o servidor com `npm run dev`

### Problema: "localStorage não limpa"
**Solução:** Abra DevTools, Application > Storage > Clear All

### Problema: "Produtos não aparecem em /catalogo"
**Solução:** 
1. Verifique se está logado
2. Edite o produto e marque como "Publicar no catálogo"
3. Recarregue a página

### Problema: "Senha não funciona"
**Solução:**
1. Verifique .env.local se VITE_ADMIN_PASSWORD está correto
2. Reinicie o servidor
3. Limpe localStorage e tente novamente

### Problema: "Imagem não aparece"
**Solução:**
1. Verifique se a URL é válida (teste em navegador)
2. Use apenas HTTPS ou HTTP (não misture)
3. Garanta que a imagem é pública (sem autenticação)

---

## Simulação de Produção

```bash
# 1. Gere uma senha forte
export VITE_ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
echo "Senha gerada: $VITE_ADMIN_PASSWORD"

# 2. Crie .env.production.local
cat > .env.production.local << EOF
VITE_ADMIN_PASSWORD=$VITE_ADMIN_PASSWORD
NODE_ENV=production
EOF

# 3. Rode build
npm run build

# 4. Valide o build
ls -la dist/

# 5. Teste localmente (simular produção)
# Copie dist/* para seu hosting
```

---

## Métricas de Sucesso

✅ **Implementação Completa** se:
1. [x] Build sem erros
2. [x] Login funciona
3. [x] /admin protegido
4. [x] Produtos filtrados por publicação
5. [x] Dados sensíveis ocultos
6. [x] Campos de imagem adicionados

---

**Última atualização:** 2026-06-22  
**Próximas melhorias:** Supabase Storage, permissões por perfil, auditoria
