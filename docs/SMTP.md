# E-mail transacional por SMTP

A plataforma aceita qualquer serviço que ofereça SMTP autenticado: e-mail do
domínio, Google Workspace/Gmail, Microsoft 365, Zoho e provedores transacionais,
entre outros. A configuração é global e fica em **Plataforma → E-mail**.

## Antes de configurar

Defina `SMTP_VAULT_KEY` no ambiente do backend com um segredo longo e aleatório.
Essa chave cifra a senha SMTP em AES-256-GCM antes da gravação no PostgreSQL.
Sem ela, o cofre deriva a chave de `AUTH_SECRET`; funciona, mas passa a impedir a
rotação independente do segredo de sessão.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

A API nunca devolve a senha nem parte dela. Depois de salvar, o painel mostra
somente se há uma credencial armazenada. Deixar o campo de nova senha vazio
preserva a atual; trocar o usuário exige informar a senha de novo.

## Campos

| Campo | Uso |
| --- | --- |
| Host | Nome do servidor sem protocolo, por exemplo `smtp.exemplo.com`. |
| Porta | Normalmente `465` para TLS direto ou `587` para STARTTLS. Use o valor informado pelo provedor. |
| Usuário e senha | Credencial SMTP. Alguns serviços exigem senha de aplicativo em vez da senha normal. Usuário vazio também permite um relay sem autenticação. |
| Nome/e-mail do remetente | Identidade usada no cabeçalho `From`. O provedor pode exigir que o endereço esteja verificado ou pertença à conta. |
| Responder para | Endereço opcional usado no cabeçalho `Reply-To`. |
| Usar este SMTP | Ativa o SMTP. Desativado, o backend usa o Resend do ambiente se ele estiver completamente configurado. |

Não habilite TLS direto e STARTTLS juntos. Na porta 465 marque **TLS direto**;
na porta 587 deixe TLS direto desligado e marque **Exigir STARTTLS**.

## Homologação

1. Salve a configuração sem ativá-la.
2. Clique em **Verificar conexão**. Isso testa DNS, conexão TCP, negociação TLS
   e autenticação, mas não garante que o servidor aceitará aquele remetente.
3. Informe um endereço controlado pela equipe e clique em **Enviar teste**.
4. Confira recebimento, spam, remetente e resposta.
5. Ative **Usar este SMTP para os envios**, salve e exercite uma automação de
   e-mail com um cliente fictício.

Se a conexão funcionar e o envio falhar, revise principalmente o endereço de
remetente autorizado. Em Gmail/Google Workspace com verificação em duas etapas,
normalmente é necessário criar uma senha de aplicativo. Outros provedores podem
exigir liberação de SMTP autenticado no painel da conta.

## Comportamento operacional

- O SMTP do painel tem prioridade sobre o Resend.
- O transporte mantém um pequeno pool de conexões para os envios automáticos e
  é recriado quando a configuração muda.
- Falhas de conexão ou autenticação não expõem a resposta bruta do servidor ao
  navegador.
- Sem SMTP ativo e sem Resend, a fila permanece em modo assistido e não debita
  crédito por uma tentativa que não ocorreu.
