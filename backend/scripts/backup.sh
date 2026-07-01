#!/usr/bin/env bash
# Backup local do banco Postgres da Aura Clinic.
# Gera um dump SQL em backend/backups/aura_clinic_<timestamp>.sql
#
# Uso:
#   npm --prefix backend run backup
#   ou: bash backend/scripts/backup.sh
#
# Requisitos: pg_dump instalado (client do PostgreSQL) e DATABASE_URL definida
# (lida automaticamente de backend/.env se existir).
set -euo pipefail

# Diretório deste script e raiz do backend (um nível acima de scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Carrega variáveis de backend/.env (se existir), sem sobrescrever as já definidas
# no ambiente. Lê linha a linha (robusto: não depende de process substitution).
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Ignora comentários e linhas que não são KEY=VALUE.
    case "$line" in
      ''|\#*) continue ;;
    esac
    if printf '%s' "$line" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*='; then
      key="${line%%=*}"
      value="${line#*=}"
      # Só define se a variável ainda não estiver no ambiente.
      if [ -z "$(eval "printf '%s' \"\${$key:-}\"")" ]; then
        export "$key=$value"
      fi
    fi
  done < "$ENV_FILE"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Erro: DATABASE_URL não definida. Configure em backend/.env ou no ambiente." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Erro: pg_dump não encontrado. Instale o client do PostgreSQL." >&2
  exit 1
fi

BACKUP_DIR="$BACKEND_DIR/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT="$BACKUP_DIR/aura_clinic_${TIMESTAMP}.sql"

echo "Gerando backup em: $OUTPUT"
pg_dump "$DATABASE_URL" > "$OUTPUT"

echo "Backup concluído: $OUTPUT"
