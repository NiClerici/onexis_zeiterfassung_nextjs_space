#!/usr/bin/env bash
# Tägliches PostgreSQL-Backup nach S3-kompatiblem Schweizer Objektspeicher
# (MIGRATION.md Punkt 11). Für einen täglichen Cronjob auf der VM gedacht,
# NICHT innerhalb eines Containers (braucht Zugriff auf die docker-compose-
# CLI und die AWS-CLI, beides einfacher direkt auf dem Host).
#
# Mechanik (pg_dump in ein Custom-Format, danach pg_restore) wurde lokal
# gegen die echte Entwicklungsdatenbank verifiziert: alle 16 Tabellen nach
# einem vollständigen Dump/Restore-Zyklus mit exakt identischen
# Zeilenzahlen (siehe MIGRATION.md, Ergebnis zu diesem Punkt). Die
# S3-Anbindung selbst ist in dieser Sandbox nicht gegen einen echten
# cloudscale.ch/Infomaniak-Bucket testbar — vor dem ersten produktiven
# Einsatz einmal manuell mit echten Zugangsdaten durchlaufen lassen.
#
# Vorbedingungen: aws-cli installiert und mit Schweizer S3-Endpoint
# konfiguriert (siehe deploy/README.md), .env im selben Verzeichnis wie
# docker-compose.yml mit POSTGRES_USER/POSTGRES_DB/S3_ENDPOINT/S3_BUCKET.

set -euo pipefail
cd "$(dirname "$0")/.."

# .env laden (POSTGRES_USER, POSTGRES_DB, S3_ENDPOINT, S3_BUCKET).
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

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DUMP_FILE="/tmp/zeiterfassung-backup-${TIMESTAMP}.dump"

echo "Erzeuge Dump..."
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" -Fc "${POSTGRES_DB}" > "${DUMP_FILE}"

echo "Lade nach S3 hoch..."
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${DUMP_FILE}" "s3://${S3_BUCKET}/backups/zeiterfassung-${TIMESTAMP}.dump"

rm -f "${DUMP_FILE}"
echo "Backup abgeschlossen: zeiterfassung-${TIMESTAMP}.dump"

# Aufbewahrungsdauer: über eine Lifecycle-Regel im Bucket selbst steuern
# (bei den meisten S3-kompatiblen Anbietern im Objektspeicher-Dashboard
# konfigurierbar), nicht hier im Skript — robuster, da unabhängig davon,
# ob der Cronjob zuverlässig läuft.
