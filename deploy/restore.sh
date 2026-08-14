#!/usr/bin/env bash
# Stellt ein per deploy/backup.sh erzeugtes Backup wieder her (MIGRATION.md
# Punkt 11, "getestete Restore-Anleitung"). VORSICHT: überschreibt die
# aktuelle Datenbank vollständig (pg_restore --clean --if-exists).
#
# Aufruf: deploy/restore.sh <dateiname-im-bucket>.dump
#   z.B.: deploy/restore.sh zeiterfassung-20260101-030000.dump
#
# Die pg_dump/pg_restore-Mechanik selbst wurde lokal gegen die echte
# Entwicklungsdatenbank verifiziert (alle 16 Tabellen nach einem
# vollständigen Zyklus mit exakt identischen Zeilenzahlen, siehe
# MIGRATION.md). Vor dem ersten produktiven Ernstfall trotzdem einmal
# bewusst gegen einen echten Bucket UND einen echten Container durchspielen
# — dieses Skript automatisiert nur die Schritte, ersetzt keine echte Probe.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER fehlt in .env}"
: "${POSTGRES_DB:?POSTGRES_DB fehlt in .env}"
: "${S3_ENDPOINT:?S3_ENDPOINT fehlt in .env (z.B. https://objects.rma.cloudscale.ch)}"
: "${S3_BUCKET:?S3_BUCKET fehlt in .env}"

FILENAME="${1:?Nutzung: deploy/restore.sh <dateiname>.dump}"
LOCAL_FILE="/tmp/${FILENAME}"

echo "Lade Backup von S3 (${S3_BUCKET}/backups/${FILENAME})..."
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "s3://${S3_BUCKET}/backups/${FILENAME}" "${LOCAL_FILE}"

read -r -p "Dies überschreibt die aktuelle Datenbank '${POSTGRES_DB}' vollständig. Fortfahren? [y/N] " CONFIRM
if [ "${CONFIRM}" != "y" ]; then
  echo "Abgebrochen."
  rm -f "${LOCAL_FILE}"
  exit 1
fi

echo "Kopiere in den db-Container..."
docker compose cp "${LOCAL_FILE}" db:/tmp/restore.dump

echo "Stelle wieder her..."
docker compose exec -T db pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists /tmp/restore.dump

docker compose exec db rm -f /tmp/restore.dump
rm -f "${LOCAL_FILE}"

echo "Wiederherstellung abgeschlossen. App neu starten:"
echo "  docker compose restart app"
