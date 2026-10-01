# E-mail transacional por SMTP

A plataforma aceita qualquer serviço que ofereça SMTP autenticado: e-mail do
domínio, Google Workspace/Gmail, Microsoft 365, Zoho e provedores transacionais,
entre outros. A configuração é global, feita pelo superadmin no painel da
plataforma: **Mais opções → Configuração de e-mail** (`/plataforma/email`). Ela
fica numa linha única de `platform.smtp_settings` (migration
`platform/0007_smtp_settings.sql`).

> **Situação em 30/09/2026:** implementado e coberto por testes locais, mas
> ainda não exercitado contra um servidor SMTP real (ver
> [ESTADO-ATUAL.md](./ESTADO-ATUAL.md)).

## Antes de configurar

Defina `SMTP_VAULT_KEY` no ambiente do backend com um segredo longo e aleatório.
Essa chave cifra a senha SMTP em AES-256-GCM antes da gravação no PostgreSQL.
Sem ela, o cofre deriva a chave de `AUTH_SECRET`; funciona, mas passa a impedir a
rotação independente do segredo de sessão, e o boot de produção registra o aviso
`[email] SMTP_VAULT_KEY não definida...`. Definir a chave depois é seguro: a
senha gravada com a derivação antiga continua legível e é regravada com a chave
nova quando o superadmin abre a tela (`GET /api/platform/email-settings`).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

O pipeline de deploy **não** sincroniza essa variável: `scripts/deploy.sh` só
faz upsert das variáveis do Asaas, de `PUBLIC_API_URL` e do R2. Em produção,
`SMTP_VAULT_KEY` precisa ser incluída à mão no `.env` do servidor.

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
| Usar este SMTP para os envios | Ativa o SMTP. Desativado, o backend usa o Resend do ambiente se ele estiver completamente configurado. |

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
- Se a senha armazenada não puder ser decifrada (por exemplo, `AUTH_SECRET`
  rotacionado sem `SMTP_VAULT_KEY`), o SMTP é tratado como inativo e o envio
  cai no Resend, se houver; a tela indica que a credencial precisa ser
  informada de novo.
- Cada processo da API guarda a configuração lida do banco por até 30 segundos;
  quem salva atualiza o próprio cache na hora.
- Os timeouts de conexão, saudação e socket do SMTP usam `EMAIL_TIMEOUT_MS`
  (padrão 15000 ms, entre 1000 e 60000).

## O que é enviado por e-mail

Fora o e-mail de teste da tela (`sendSmtpTestEmail`, que usa só o SMTP), todos
os envios passam por `sendTransactionalEmail`
(`backend/src/services/emailProvider.js`):

- **Fila de comunicações da clínica.** Mensagens com canal `email` (definido
  pela regra de automação ou pelo modelo) vão para o e-mail do cadastro do
  cliente, com o `subject` do modelo como assunto, e reservam 1 crédito do
  canal `email` antes do envio. Os eventos do agendamento (criação, lembretes,
  confirmação, reagendamento, cancelamento, conclusão e sinal pendente) entram
  na fila pelas regras de automação e saem por e-mail quando a regra está com
  canal `email`; as regras `booking_confirmed`, `booking_rescheduled` e
  `booking_cancelled` vêm da migration
  `tenant/0018_appointment_communication_events.sql` e nascem com canal
  WhatsApp.
- **Avisos da assinatura da clínica** (vencimento, carência e bloqueio), pelo
  worker `billingLifecycle`. Ver [ASAAS.md](./ASAAS.md).
- **Recuperação de senha** (`POST /api/auth/forgot-password`, migration
  `tenant/0029_password_recovery.sql`): link de uso único válido por 30
  minutos, montado com `PUBLIC_APP_URL`. A resposta ao usuário é sempre
  genérica; sem provedor ativo o e-mail simplesmente não sai.

## Rotas e variáveis

Rotas do superadmin: `GET/PUT/DELETE /api/platform/email-settings`,
`POST /api/platform/email-settings/verify` e
`POST /api/platform/email-settings/test` (`backend/src/routes/platformEmail.js`).
A tela não oferece a remoção; o `DELETE` apaga a linha de configuração.

| Variável | Uso |
| --- | --- |
| `SMTP_VAULT_KEY` | Cifra a senha SMTP (ver acima). |
| `RESEND_API_KEY` e `EMAIL_FROM` | Fallback Resend; só funciona com as duas juntas (o boot avisa se vier só uma). |
| `RESEND_API_URL` | Opcional; padrão `https://api.resend.com`. |
| `EMAIL_TIMEOUT_MS` | Timeout dos envios por SMTP e Resend. |
| `PUBLIC_APP_URL` | Origem do painel nos links enviados por e-mail; padrão = `PUBLIC_API_URL`. |
