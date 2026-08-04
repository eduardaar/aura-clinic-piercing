#!/usr/bin/env bash
# Backup dos ANEXOS em disco (uploads públicos e privados) da Aura Clinic.
#
# Gera backend/backups/uploads_<timestamp>.tar.gz com os dois diretórios que o
# deploy preserva de propósito (`scripts/deploy.sh` exclui `src/data/uploads` e
# `src/data/private-uploads` do rsync — é por isso que eles sobrevivem aos
# deploys e é por isso que são a ÚNICA cópia desses arquivos que existe).
#
# Este script é o pré-requisito de `migrate-uploads-to-r2.mjs`: o migrador se
# recusa a rodar sem apontar para um .tar.gz recente gerado aqui.
#
# Uso:
#   npm --prefix backend run backup:uploads
#   bash backend/scripts/backup-uploads.sh
#   UPLOADS_DIR=/mnt/vol/uploads PRIVATE_UPLOADS_DIR=/mnt/vol/private bash backend/scripts/backup-uploads.sh
#
# Variáveis opcionais:
#   BACKUP_DIR            destino do .tar.gz (padrão: backend/backups)
#   UPLOADS_DIR           origem dos públicos (padrão: backend/src/data/uploads)
#   PRIVATE_UPLOADS_DIR   origem dos privados (padrão: backend/src/data/private-uploads)
#   MIN_FREE_MB           folga extra exigida em disco (padrão: 200)
#
# ---------------------------------------------------------------------------
# POR QUE AQUI NÃO EXISTE `|| true`
# ---------------------------------------------------------------------------
# `scripts/deploy.sh:232` faz o dump do Postgres assim:
#
#     docker exec monitence-postgres pg_dump ... | gzip > ".../${ts}.sql.gz" || true
#
# O `|| true` engole a falha: se o pg_dump quebrar (banco fora do ar, disco
# cheio, senha trocada), o deploy segue em frente e o operador vê "Backup do
# banco" na saída como se tivesse dado certo. Sobra um .sql.gz de zero byte que
# ninguém abre — e o dia em que ele for aberto é justamente o dia em que ele
# precisava estar bom.
#
# Aqui é o contrário, e é intencional: `set -euo pipefail`, `trap` que apaga o
# arquivo parcial, e verificação do que foi gravado (`tar -tzf` + contagem de
# entradas + checksum). Qualquer problema termina com código de saída != 0 e
# SEM deixar um .tar.gz enganoso no diretório. Um backup que mente é pior do que
# backup nenhum, porque autoriza o passo seguinte (a migração) a começar.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

UPLOADS_DIR="${UPLOADS_DIR:-$BACKEND_DIR/src/data/uploads}"
PRIVATE_UPLOADS_DIR="${PRIVATE_UPLOADS_DIR:-$BACKEND_DIR/src/data/private-uploads}"
BACKUP_DIR="${BACKUP_DIR:-$BACKEND_DIR/backups}"
MIN_FREE_MB="${MIN_FREE_MB:-200}"

fail() { echo "ERRO: $*" >&2; exit 1; }

command -v tar >/dev/null 2>&1 || fail "tar não encontrado."

# Checksum: o nome do binário muda entre Linux (sha256sum) e macOS (shasum -a 256).
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  sha256_of() { echo "sem-checksum"; }
fi

# --- 1. As origens existem? ------------------------------------------------
[ -d "$UPLOADS_DIR" ] || fail "diretório de uploads públicos não encontrado: $UPLOADS_DIR"
[ -d "$PRIVATE_UPLOADS_DIR" ] || fail "diretório de uploads privados não encontrado: $PRIVATE_UPLOADS_DIR"

# Os dois diretórios precisam estar sob um pai comum para o tar guardar caminhos
# relativos legíveis (uploads/... e private-uploads/...). Quando não estão (caso
# de volume Docker montado em outro lugar), cada um é arquivado pelo seu próprio
# pai — o `tar -tzf` na verificação continua valendo.
PUB_PARENT="$(cd "$(dirname "$UPLOADS_DIR")" && pwd)"
PRIV_PARENT="$(cd "$(dirname "$PRIVATE_UPLOADS_DIR")" && pwd)"
PUB_BASE="$(basename "$UPLOADS_DIR")"
PRIV_BASE="$(basename "$PRIVATE_UPLOADS_DIR")"

# --- 2. Quanto tem para copiar e quanto cabe -------------------------------
PUB_FILES="$(find "$UPLOADS_DIR" -type f | wc -l | tr -d ' ')"
PRIV_FILES="$(find "$PRIVATE_UPLOADS_DIR" -type f | wc -l | tr -d ' ')"
TOTAL_FILES=$((PUB_FILES + PRIV_FILES))

SOURCE_KB="$( { du -sk "$UPLOADS_DIR"; du -sk "$PRIVATE_UPLOADS_DIR"; } | awk '{s+=$1} END {print s+0}')"
SOURCE_MB=$(( SOURCE_KB / 1024 ))

mkdir -p "$BACKUP_DIR"

# `df -Pk` é o formato POSIX (uma linha por sistema de arquivos), estável entre
# Linux e macOS — o `df` sem -P quebra a linha quando o device é longo.
FREE_KB="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
FREE_MB=$(( FREE_KB / 1024 ))

# O .tar.gz comprime, mas imagem JPEG/PNG e PDF já vêm comprimidos: assumir
# ganho de compressão aqui seria otimismo. Exige o tamanho cheio + folga.
NEEDED_MB=$(( SOURCE_MB + MIN_FREE_MB ))
if [ "$FREE_MB" -lt "$NEEDED_MB" ]; then
  fail "espaço insuficiente em $BACKUP_DIR: ${FREE_MB}MB livres, ${NEEDED_MB}MB necessários (${SOURCE_MB}MB de anexos + ${MIN_FREE_MB}MB de folga)."
fi

if [ "$TOTAL_FILES" -eq 0 ]; then
  fail "nenhum arquivo em $UPLOADS_DIR nem em $PRIVATE_UPLOADS_DIR. Um backup vazio autorizaria a migração a rodar sem rede de segurança — confira se está no servidor certo (ou nos caminhos certos: UPLOADS_DIR / PRIVATE_UPLOADS_DIR)."
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
LISTING="$BACKUP_DIR/uploads_${TIMESTAMP}.lista.txt"

# Arquivo parcial NUNCA fica para trás: se o script morrer em qualquer ponto
# antes do fim, o .tar.gz e a listagem somem. É o que impede o migrador de
# aceitar depois um backup truncado só porque o nome e a data estavam certos.
cleanup_partial() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    rm -f "$OUTPUT" "$LISTING" "$OUTPUT.sha256"
    echo "ERRO: backup abortado (código $code). Arquivo parcial removido: $OUTPUT" >&2
  fi
}
trap cleanup_partial EXIT

echo "==> Origem pública : $UPLOADS_DIR (${PUB_FILES} arquivos)"
echo "==> Origem privada : $PRIVATE_UPLOADS_DIR (${PRIV_FILES} arquivos)"
echo "==> Total          : ${TOTAL_FILES} arquivos, ~${SOURCE_MB}MB"
echo "==> Destino        : $OUTPUT (${FREE_MB}MB livres)"

# --- 3. Compacta -----------------------------------------------------------
if [ "$PUB_PARENT" = "$PRIV_PARENT" ]; then
  tar -czf "$OUTPUT" -C "$PUB_PARENT" "$PUB_BASE" "$PRIV_BASE"
else
  tar -czf "$OUTPUT" -C "$PUB_PARENT" "$PUB_BASE" -C "$PRIV_PARENT" "$PRIV_BASE"
fi

[ -s "$OUTPUT" ] || fail "tar produziu um arquivo vazio: $OUTPUT"

# --- 4. Verifica o que foi gravado -----------------------------------------
# `tar -tzf` lê o gzip inteiro e valida o CRC: é a diferença entre "o arquivo
# existe" e "o arquivo abre". Sem isto, um .tar.gz truncado (disco que encheu
# no meio) passaria como backup bom.
echo "==> Verificando integridade (tar -tzf)..."
tar -tzf "$OUTPUT" > "$LISTING" || fail "arquivo corrompido ou ilegível: $OUTPUT"

# Entradas de diretório terminam em "/" no listado do tar; só os arquivos contam.
ARCHIVED_FILES="$(grep -cv '/$' "$LISTING" || true)"
if [ "$ARCHIVED_FILES" -lt "$TOTAL_FILES" ]; then
  fail "o arquivo contém ${ARCHIVED_FILES} arquivos, mas o disco tem ${TOTAL_FILES}. Backup incompleto."
fi

CHECKSUM="$(sha256_of "$OUTPUT")"
printf '%s  %s\n' "$CHECKSUM" "$(basename "$OUTPUT")" > "$OUTPUT.sha256"

SIZE_MB="$(( $(wc -c < "$OUTPUT") / 1048576 ))"

trap - EXIT
echo
echo "Backup concluído e verificado."
echo "  arquivo : $OUTPUT (${SIZE_MB}MB)"
echo "  conteúdo: ${ARCHIVED_FILES} arquivos"
echo "  sha256  : $CHECKSUM"
echo "  listagem: $LISTING"
echo
echo "Para restaurar (nunca sobrescreva sem conferir antes):"
echo "  tar -xzf $OUTPUT -C /destino/temporario"
echo
echo "Próximo passo (dry-run da migração):"
echo "  npm --prefix backend run migrate:r2 -- --backup=$OUTPUT"
