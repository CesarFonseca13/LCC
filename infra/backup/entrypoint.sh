#!/bin/sh
# Backup diário às 03:30 (hora do container, UTC):
#  - pg_dump -Fc dos bancos clinicaos e evolution
#  - tar do storage de arquivos (PDFs de termos, fotos)
#  - retenção de 14 dias no volume local
#  - se RESTIC_REPOSITORY estiver definido, replica off-site (cifrado)
# Termos assinados têm valor probatório: backup não é opcional.
set -eu

: "${POSTGRES_SUPERUSER_PASSWORD:?}"
export PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD"
mkdir -p /backups

echo "[backup] serviço ativo — próximo ciclo às 03:30 UTC"

while true; do
  now_h=$(date -u +%H%M)
  if [ "$now_h" = "0330" ]; then
    stamp=$(date -u +%Y%m%d-%H%M)
    echo "[backup] iniciando ciclo $stamp"

    pg_dump -h postgres -U postgres -Fc -f "/backups/clinicaos-$stamp.dump" clinicaos \
      && echo "[backup] clinicaos ok" || echo "[backup] ERRO no dump clinicaos"
    pg_dump -h postgres -U postgres -Fc -f "/backups/evolution-$stamp.dump" evolution \
      && echo "[backup] evolution ok" || echo "[backup] ERRO no dump evolution"
    tar -czf "/backups/storage-$stamp.tar.gz" -C /data storage 2>/dev/null \
      && echo "[backup] storage ok" || echo "[backup] storage vazio/erro"

    # Retenção local: 14 dias
    find /backups -type f -mtime +14 -delete

    # Off-site opcional (Backblaze B2 / S3 / SFTP) — cifrado pelo restic
    if [ -n "${RESTIC_REPOSITORY:-}" ]; then
      apk add --no-cache restic >/dev/null 2>&1 || true
      restic backup /backups /wal_archive /evolution_instances \
        && restic forget --keep-daily 14 --keep-weekly 8 --prune \
        && echo "[backup] off-site ok" || echo "[backup] ERRO no off-site"
    fi

    echo "[backup] ciclo $stamp concluído"
    sleep 90
  fi
  sleep 30
done
