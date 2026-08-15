#!/usr/bin/env bash
#
# Deploy da Aura Clinic para o servidor de produção.
#
# Fluxo: build do frontend -> upload para release inativa -> backup -> rebuild
# da API sem migrations -> health profundo -> troca atômica do frontend. Se a API
# falhar, o frontend que já estava no ar permanece intacto.
#
# Uso local (chave SSH):
#   SSH_OPTS="-i ~/.ssh/aura_deploy" ./scripts/deploy.sh
#
# Uso no GitHub Actions: o workflow monta a chave e chama este script com as
# variáveis abaixo já exportadas (ver .github/workflows/deploy.yml).
#
# Variáveis (todas com default para produção):
#   SERVER_HOST, SERVER_USER, API_URL, SITE_URL,
#   REMOTE_COMPOSE_DIR, REMOTE_BACKEND, REMOTE_FRONT, SSH_OPTS
#
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-187.77.225.233}"
SERVER_USER="${SERVER_USER:-root}"
API_URL="${API_URL:-https://auraclinic.monitence.com/api}"
SITE_URL="${SITE_URL:-https://auraclinic.monitence.com}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/home/auraclinic}"
REMOTE_BACKEND="${REMOTE_BACKEND:-/home/auraclinic/backend}"
REMOTE_FRONT="${REMOTE_FRONT:-/home/nginx/front/auraclinic}"
REMOTE_FRONT_NEXT="${REMOTE_FRONT}.next"
SSH_OPTS="${SSH_OPTS:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

target="${SERVER_USER}@${SERVER_HOST}"

# Multiplexação SSH: TODAS as operações (rsync + comandos remotos) reutilizam
# UMA única conexão TCP. Sem isso, o deploy abre várias conexões SSH seguidas e
# tropeça no rate-limit (ufw LIMIT) e no fail2ban do servidor — o que bania o
# runner do GitHub Actions no meio do deploy (timeout na porta 22).
CONTROL="$(mktemp -u "${TMPDIR:-/tmp}/aura-deploy-ctl-XXXXXX")"
rsh="ssh ${SSH_OPTS} -o ConnectTimeout=20 -o ControlMaster=auto -o ControlPath=${CONTROL} -o ControlPersist=180"
cleanup() { ssh -o ControlPath="${CONTROL}" -O exit "${target}" 2>/dev/null || true; }
trap cleanup EXIT

# Retry APENAS para falha de conexão. A rota entre o runner do GitHub (Azure) e
# este servidor cai de vez em quando: o SYN não chega, o ConnectTimeout estoura
# em 20s e o deploy inteiro morre com o build já pronto. Confirmado no servidor
# — nos horários das falhas não há registro nenhum no sshd, o fail2ban está
# zerado e o UFW nunca disparou; ou seja, o pacote se perde no caminho.
#
# ssh e rsync usam o código 255 exclusivamente para erro de conexão. Qualquer
# outro código (build quebrado, migração falhando, health check negativo) passa
# direto e derruba o deploy na hora, como deve ser.
retry_conn() {
  local label="$1"; shift
  local attempt=1 max=3 delay=10 status=0
  while :; do
    "$@" && return 0
    status=$?
    if [ "${status}" -ne 255 ] || [ "${attempt}" -ge "${max}" ]; then
      return "${status}"
    fi
    echo "   !! ${label}: falha de conexão (tentativa ${attempt}/${max}); nova tentativa em ${delay}s"
    # A conexão multiplexada pode ter ficado num estado ruim — descarta antes de tentar de novo.
    ssh -o ControlPath="${CONTROL}" -O exit "${target}" 2>/dev/null || true
    sleep "${delay}"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

# Health check por DENTRO do servidor (via a conexão SSH já aberta): bate direto
# no container aura-api e checa banco + index do front. Não passa pelo Cloudflare, que
# responde 403 para IPs de datacenter (ex.: runners do GitHub Actions).
health_check() {
  local front_path="${1:-${REMOTE_FRONT}}"
  local ok=0 health front
  for i in 1 2 3 4 5 6; do
    sleep 3
    health="$(${rsh} "${target}" 'docker exec aura-api wget -qO- http://127.0.0.1:4000/api/health/db 2>/dev/null || true')"
    front="$(${rsh} "${target}" "test -f ${front_path}/index.html && echo ok || echo missing")"
    echo "   tentativa ${i}: api=${health:-vazio} | front=${front}"
    case "${health}" in *'"database":"connected"'*) [ "${front}" = "ok" ] && { ok=1; break; } ;; esac
  done
  [ "${ok}" = "1" ] || { echo "!! Health check FALHOU"; exit 1; }
}

# ---------------------------------------------------------------------------
# Modo rollback (ROLLBACK=true)
# ---------------------------------------------------------------------------
#
# O deploy normal já marcava a imagem em uso como `aura-api:rollback` antes de
# publicar a nova — mas nada no projeto sabia usá-la. Um ponto de restauração
# que ninguém consegue invocar não é um ponto de restauração.
#
# ESCOPO: volta a imagem anterior da API e, quando existir, troca o frontend
# atual pela release anterior. Migrations e `.env` continuam forward-only.
#
# As migrations são idempotentes e só acrescentam (CREATE/ALTER ... IF NOT
# EXISTS), então a imagem anterior convive com o schema novo — ela apenas
# ignora as colunas que não conhece.
if [ "${ROLLBACK:-false}" = "true" ]; then
  echo "==> ROLLBACK: voltando a API para a imagem anterior (aura-api:rollback)"
  echo "    ATENÇÃO: o schema do banco e o .env NÃO voltam."
  # shellcheck disable=SC2087
  ${rsh} "${target}" REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR}" REMOTE_FRONT="${REMOTE_FRONT}" bash -s <<'REMOTE'
set -euo pipefail
cd "${REMOTE_COMPOSE_DIR}"

if ! docker image inspect aura-api:rollback >/dev/null 2>&1; then
  echo "!! Não existe imagem aura-api:rollback neste servidor — nada a reverter."
  echo "   (ela só passa a existir depois do primeiro deploy bem-sucedido)"
  exit 1
fi

# Troca as tags mantendo o caminho de volta: a que está no ar agora vira a
# nova `rollback`, para um segundo disparo desfazer o desfazer.
docker tag aura-api:latest aura-api:previous-failed 2>/dev/null || true
docker tag aura-api:rollback aura-api:latest
docker tag aura-api:previous-failed aura-api:rollback 2>/dev/null || true

docker compose up -d redis aura-api

# A publicação normal mantém exatamente uma release anterior. A troca de
# diretórios é atômica no mesmo filesystem e também preserva o caminho de volta.
if [ -f "${REMOTE_FRONT}.previous/index.html" ]; then
  rm -rf "${REMOTE_FRONT}.rollback-failed"
  [ ! -e "${REMOTE_FRONT}" ] || mv "${REMOTE_FRONT}" "${REMOTE_FRONT}.rollback-failed"
  mv "${REMOTE_FRONT}.previous" "${REMOTE_FRONT}"
  [ ! -e "${REMOTE_FRONT}.rollback-failed" ] || mv "${REMOTE_FRONT}.rollback-failed" "${REMOTE_FRONT}.previous"
else
  echo "   frontend anterior não encontrado; somente a API foi revertida"
fi
docker ps --filter name=aura-api --format 'aura-api: {{.Status}}'
REMOTE

  echo "==> Health check pós-rollback"
  health_check
  echo "==> Rollback concluído: ${SITE_URL}"
  exit 0
fi

echo "==> [1/6] Build do frontend (VITE_API_URL=${API_URL})"
(
  cd frontend
  npm ci
  # .env.production garante a URL da API no bundle, sem depender do .env local.
  printf 'VITE_API_URL=%s\n' "${API_URL}" > .env.production
  npm run build
  rm -f .env.production
)

echo "==> [2/6] Sync do backend -> ${REMOTE_BACKEND}"
retry_conn "sync do backend" rsync -rlpt --delete \
  --exclude 'node_modules' --exclude '.env' --exclude '.env.*' \
  --exclude 'src/data/uploads' --exclude 'src/data/private-uploads' \
  --exclude '*.log' --exclude '.DS_Store' \
  -e "${rsh}" \
  backend/ "${target}:${REMOTE_BACKEND}/"

echo "==> [3/6] Upload do frontend para release inativa -> ${REMOTE_FRONT_NEXT}"
retry_conn "sync do frontend" rsync -rlpt --delete --exclude '.DS_Store' \
  -e "${rsh}" \
  frontend/dist/ "${target}:${REMOTE_FRONT_NEXT}/"

# Segredos de infraestrutura: gateway de pagamento (Asaas) e armazenamento de
# arquivos (Cloudflare R2). Ficam no .env DO SERVIDOR (que o rsync exclui de
# propósito, para o repositório nunca virar fonte de credencial), e chegam aqui
# como secrets do GitHub Actions.
#
# Upsert idempotente e CONSERVADOR: variável com valor vazio é PULADA, nunca
# escrita. Isso é o que garante que rodar o deploy sem os secrets configurados
# não apague uma chave que já está em produção e funcionando.
echo "==> [3.5/6] Sincronizar segredos de Asaas e R2 (só os que vierem preenchidos)"
secret_env=""
for var in \
  ASAAS_BASE_URL ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN ASAAS_VAULT_KEY PUBLIC_API_URL \
  R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
  R2_BUCKET_PUBLIC R2_BUCKET_PRIVATE R2_PUBLIC_BASE_URL; do
  value="${!var:-}"
  [ -n "${value}" ] || continue
  secret_env="${secret_env}${var}=${value}"$'\n'
done

if [ -n "${secret_env}" ]; then
  # DUAS chamadas, e não uma só com pipe.
  #
  # A tentação é `printf ... | ssh host bash -s <<'REMOTE'`, mas isso não
  # funciona: o heredoc É a entrada padrão do comando remoto (é dele que o
  # `bash -s` lê o script), então ele SOBRESCREVE o pipe e os valores nunca
  # chegam do outro lado — falha silenciosa, com o deploy passando verde e o
  # .env intacto. (shellcheck SC2259.)
  #
  # Também não passamos os segredos na linha de comando do ssh: eles ficariam
  # visíveis em `ps` no servidor enquanto o comando roda.
  #
  # Então: primeiro o conteúdo viaja por stdin puro para um arquivo temporário
  # com permissão restrita; depois o script o consome e apaga.
  remote_tmp="/tmp/.aura-secrets-env.$$"
  printf '%s' "${secret_env}" \
    | ${rsh} "${target}" "umask 077 && cat > '${remote_tmp}'"

  # shellcheck disable=SC2087
  ${rsh} "${target}" REMOTE_BACKEND="${REMOTE_BACKEND}" SECRETS_TMP="${remote_tmp}" bash -s <<'REMOTE'
set -euo pipefail
# O temporário some aconteça o que acontecer — inclusive se o script falhar no
# meio. Deixar segredo em /tmp seria pior que não ter feito o upsert.
trap 'rm -f "${SECRETS_TMP}"' EXIT

env_file="${REMOTE_BACKEND}/.env"
touch "${env_file}"
chmod 600 "${env_file}"

# O Docker Compose interpola `$VAR` em valores sem aspas ou com aspas duplas.
# A chave de produção do Asaas começa com `$aact_prod_`; gravá-la crua faria o
# Compose procurar uma variável `aact_prod_...` e entregar uma chave vazia ao
# container. A sintaxe com aspas simples preserva o valor literalmente. Barra
# invertida e apóstrofo também são escapados conforme o formato de env do
# Compose, para que isto valha para todos os secrets sincronizados.
dotenv_literal() {
  printf "'"
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g"
  printf "'"
}

while IFS='=' read -r key value; do
  [ -n "${key}" ] || continue
  literal_value="$(dotenv_literal "${value}")"
  if grep -q "^${key}=" "${env_file}"; then
    # Reescreve no lugar. Chave e valor vão por variável de ambiente, e não
    # interpolados no padrão do Perl; URL e chaves podem conter caracteres
    # que seriam reinterpretados pelo comando de substituição.
    NEW_VALUE="${literal_value}" KEY="${key}" perl -i -pe 's/^\Q$ENV{KEY}\E=.*/"$ENV{KEY}=$ENV{NEW_VALUE}"/e' "${env_file}"
    echo "   atualizado: ${key}"
  else
    printf '%s=%s\n' "${key}" "${literal_value}" >> "${env_file}"
    echo "   adicionado: ${key}"
  fi
done < "${SECRETS_TMP}"
REMOTE
else
  echo "   nenhum secret de Asaas/R2 definido — mantendo o .env do servidor como está"
fi

echo "==> [4/6] Backup do banco + rebuild + restart da API"
# shellcheck disable=SC2087
${rsh} "${target}" REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR}" REMOTE_BACKEND="${REMOTE_BACKEND}" bash -s <<'REMOTE'
set -euo pipefail
cd "${REMOTE_COMPOSE_DIR}"

ts="$(date +%Y%m%d-%H%M%S)"
# Restore point por deploy (mantém os 10 dumps mais recentes).
#
# FAIL-CLOSED, e isto é deliberado. Antes o pg_dump terminava em `|| true`: um
# backup que falhasse passava batido e o deploy seguia assim mesmo. Como as
# migrations idempotentes rodam no BOOT do container (logo abaixo), e algumas
# delas reescrevem tabela — a conversão de dinheiro para NUMERIC(12,2) é o caso
# — deployar sem restore point é subir uma alteração de esquema sem volta.
#
# `pipefail` já está ligado, mas o pipe com gzip mascararia a falha do pg_dump
# se não fosse pelo teste de tamanho: dump vazio ou truncado gera .gz válido.
if docker ps --format '{{.Names}}' | grep -q '^monitence-postgres$'; then
  dump="/root/pg-backups/aura-clinic-deploy-${ts}.sql.gz"
  mkdir -p /root/pg-backups
  if ! docker exec monitence-postgres pg_dump -U aura -d aura_clinic | gzip > "${dump}"; then
    echo "ERRO: pg_dump falhou. Deploy abortado ANTES de tocar na aplicação." >&2
    rm -f "${dump}"
    exit 1
  fi
  if ! gzip -t "${dump}" 2>/dev/null; then
    echo "ERRO: o backup gerado está corrompido. Deploy abortado." >&2
    exit 1
  fi
  # Completude pelo MARCADOR, não pelo tamanho. O pg_dump fecha todo dump bem
  # sucedido com "PostgreSQL database dump complete"; se o processo morreu no
  # meio (disco cheio, conexão caída, OOM), o .gz continua válido e legível mas
  # não tem essa linha. Tamanho é proxy ruim: a primeira versão desta guarda
  # exigia 1 MB e abortou um deploy contra um dump íntegro de 213 KB.
  if ! gzip -dc "${dump}" | tail -n 20 | grep -q 'PostgreSQL database dump complete'; then
    echo "ERRO: o backup não tem o marcador de fim do pg_dump — dump truncado. Deploy abortado." >&2
    exit 1
  fi
  bytes="$(stat -c %s "${dump}" 2>/dev/null || echo 0)"
  echo "   backup verificado: ${dump} (${bytes} bytes, marcador de fim presente)"
  ls -t /root/pg-backups/aura-clinic-deploy-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  echo "ERRO: container monitence-postgres não está no ar; sem backup possível. Deploy abortado." >&2
  exit 1
fi

# Ponto de rollback da imagem (a que está no ar agora vira :rollback).
docker tag aura-api:latest aura-api:rollback 2>/dev/null || true

# Deploy da aplicação e rollout de banco são operações independentes. O
# processo normal grava as flags fail-safe no .env e NÃO chama o runner. Um
# rollout administrativo usa `migrations.mjs apply --tenant=... --target=...`.
env_file="${REMOTE_BACKEND}/.env"
touch "${env_file}"
chmod 600 "${env_file}"
for setting in RUN_DATABASE_MIGRATIONS=false SKIP_DATABASE_BOOTSTRAP=true RUN_MIGRATIONS_ON_BOOT=false; do
  key="${setting%%=*}"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s/^${key}=.*/${setting}/" "${env_file}"
  else
    printf '%s\n' "${setting}" >> "${env_file}"
  fi
done
echo "   migrations automáticas: desativadas (rollout exige CLI explícito por tenant)"
docker compose build aura-api

# O boot não aplica schema.sql nem migrations no deploy normal.
# `redis` explícito: guarda os contadores do loginGuard e precisa estar de pé
# antes da API. Sem ele a API sobe do mesmo jeito (cai para contadores em
# memória), mas a proteção fica mais fraca. A API é recriada de propósito:
# com a imagem sempre chamada `aura-api:latest`, o Compose pode manter o
# container anterior mesmo depois de `build`, deixando o deploy "verde" com
# código antigo ainda em execução.
docker compose up -d redis
docker compose up -d --force-recreate aura-api
docker image prune -f >/dev/null 2>&1 || true

docker ps --filter name=aura-api --format 'aura-api: {{.Status}}'
REMOTE

echo "==> [5/6] Health check da API e do banco"
# Valida a release inativa. Isso também permite o primeiro deploy, quando ainda
# não existe frontend no caminho ativo.
health_check "${REMOTE_FRONT_NEXT}"

echo "==> [6/6] Ativação atômica do frontend"
# shellcheck disable=SC2087
${rsh} "${target}" REMOTE_FRONT="${REMOTE_FRONT}" REMOTE_FRONT_NEXT="${REMOTE_FRONT_NEXT}" bash -s <<'REMOTE'
set -euo pipefail
if [ ! -f "${REMOTE_FRONT_NEXT}/index.html" ]; then
  echo "ERRO: release nova do frontend não contém index.html." >&2
  exit 1
fi
rm -rf "${REMOTE_FRONT}.previous"
if [ -e "${REMOTE_FRONT}" ]; then
  mv "${REMOTE_FRONT}" "${REMOTE_FRONT}.previous"
fi
if ! mv "${REMOTE_FRONT_NEXT}" "${REMOTE_FRONT}"; then
  [ ! -e "${REMOTE_FRONT}.previous" ] || mv "${REMOTE_FRONT}.previous" "${REMOTE_FRONT}"
  echo "ERRO: não foi possível ativar o frontend; release anterior restaurada." >&2
  exit 1
fi
REMOTE

health_check

echo "==> Deploy concluído com sucesso: ${SITE_URL}"
