#!/usr/bin/env bash
#
# Deploy da Aura Clinic para o servidor de produção.
#
# Fluxo: build do frontend (Vite) -> rsync do backend + do dist do frontend
# para o servidor -> rebuild da imagem docker + restart do container -> health
# check. Idempotente e seguro para rodar quantas vezes quiser.
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
SSH_OPTS="${SSH_OPTS:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

target="${SERVER_USER}@${SERVER_HOST}"
rsh="ssh ${SSH_OPTS} -o ConnectTimeout=20"

echo "==> [1/5] Build do frontend (VITE_API_URL=${API_URL})"
(
  cd frontend
  npm ci
  # .env.production garante a URL da API no bundle, sem depender do .env local.
  printf 'VITE_API_URL=%s\n' "${API_URL}" > .env.production
  npm run build
  rm -f .env.production
)

echo "==> [2/5] Sync do backend -> ${REMOTE_BACKEND}"
rsync -rlpt --delete \
  --exclude 'node_modules' --exclude '.env' --exclude '.env.*' \
  --exclude 'src/data/uploads' --exclude '*.log' --exclude '.DS_Store' \
  -e "${rsh}" \
  backend/ "${target}:${REMOTE_BACKEND}/"

echo "==> [3/5] Sync do frontend -> ${REMOTE_FRONT}"
rsync -rlpt --delete --exclude '.DS_Store' \
  -e "${rsh}" \
  frontend/dist/ "${target}:${REMOTE_FRONT}/"

echo "==> [4/5] Backup do banco + rebuild + restart da API"
# shellcheck disable=SC2087
${rsh} "${target}" REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR}" bash -s <<'REMOTE'
set -euo pipefail
cd "${REMOTE_COMPOSE_DIR}"

ts="$(date +%Y%m%d-%H%M%S)"
# Restore point por deploy (mantém os 10 dumps mais recentes).
if docker ps --format '{{.Names}}' | grep -q '^monitence-postgres$'; then
  docker exec monitence-postgres pg_dump -U aura -d aura_clinic \
    | gzip > "/root/pg-backups/aura-clinic-deploy-${ts}.sql.gz" || true
  ls -t /root/pg-backups/aura-clinic-deploy-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

# Ponto de rollback da imagem (a que está no ar agora vira :rollback).
docker tag aura-api:latest aura-api:rollback 2>/dev/null || true

# Rebuild + restart. As migrations idempotentes rodam no boot do container.
docker compose build aura-api
docker compose up -d aura-api
docker image prune -f >/dev/null 2>&1 || true

docker ps --filter name=aura-api --format 'aura-api: {{.Status}}'
REMOTE

echo "==> [5/5] Health check em ${SITE_URL}"
ok=0
for i in 1 2 3 4 5 6; do
  sleep 3
  api="$(curl -fsS -o /dev/null -w '%{http_code}' "${SITE_URL}/api/health" || echo 000)"
  front="$(curl -fsS -o /dev/null -w '%{http_code}' "${SITE_URL}/" || echo 000)"
  echo "   tentativa ${i}: api=${api} front=${front}"
  if [ "${api}" = "200" ] && [ "${front}" = "200" ]; then ok=1; break; fi
done
[ "${ok}" = "1" ] || { echo "!! Health check FALHOU"; exit 1; }

echo "==> Deploy concluído com sucesso: ${SITE_URL}"
