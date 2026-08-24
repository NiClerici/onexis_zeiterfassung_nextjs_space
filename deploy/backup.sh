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
#
# Ops-Protokoll (/dev, "Developer-Übersicht"): dieses Skript lief bisher nur
# als Cronjob auf der VM und schrieb nach /var/log/zeiterfassung-backup.log
# — ausserhalb jedes Containers, also für die App unsichtbar. Ein stiller
# Fehlschlag wäre nie aufgefallen. log_ops_event() unten schreibt deshalb pro
# Lauf genau eine Zeile in die OpsEvent-Tabelle (prisma/schema.prisma), über
# denselben "docker compose exec -T db"-Weg, den dieses Skript für pg_dump
# ohnehin schon benutzt — kein zusätzliches Werkzeug auf der VM nötig. Die
# Kind-Ausprägung "errorlog-prune" räumt im selben Lauf die ErrorLog-Tabelle
# auf (90 Tage Aufbewahrung, siehe lib/error-log.ts) — das läuft aktuell
# nirgends sonst automatisch.

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

# Schreibt eine Zeile nach OpsEvent. gen_random_uuid() ist seit PostgreSQL 13
# fest im Core (kein pgcrypto/uuid-ossp nötig, postgres:16-alpine reicht) —
# Prisma generiert die id sonst clientseitig (cuid()), das gibt es hier nicht,
# die Spalte selbst trägt keinen DB-Default (siehe migration.sql). detail wird
# ausschliesslich aus diesem Skript befüllt (Dateiname/Grösse oder ein fester
# Fehlertext), nie aus Nutzereingaben — einfaches Escaping von ' reicht.
log_ops_event() {
  local kind="$1" status="$2" detail="${3:-}"
  local escaped_detail="${detail//\'/\'\'}"
  if ! docker compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO \"OpsEvent\" (id, kind, status, detail) VALUES (gen_random_uuid()::text, '${kind}', '${status}', '${escaped_detail}');" \
    > /dev/null 2>&1; then
    echo "Warnung: OpsEvent (${kind}/${status}) konnte nicht geschrieben werden." >&2
  fi
}

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DUMP_FILE="/tmp/zeiterfassung-backup-${TIMESTAMP}.dump"

# EXIT-Trap statt ERR-Trap: feuert garantiert bei jedem Skriptende (Erfolg
# UND jeder durch "set -e" ausgelöste Abbruch), unabhängig davon, welcher
# Befehl fehlschlägt — ein ERR-Trap müsste dagegen an jeder Stelle einzeln
# sitzen. BACKUP_OK wird erst ganz am Schluss auf 1 gesetzt, bleibt also 0
# bei jedem vorzeitigen Abbruch dazwischen.
BACKUP_OK=0
on_exit() {
  if [ "${BACKUP_OK}" -eq 1 ]; then
    log_ops_event "backup" "ok" "zeiterfassung-${TIMESTAMP}.dump (${DUMP_SIZE:-unbekannte Grösse})"
  else
    log_ops_event "backup" "failed" "Abbruch bei zeiterfassung-${TIMESTAMP}.dump — Details im Cron-/Systemlog"
  fi
}
trap on_exit EXIT

echo "Erzeuge Dump..."
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" -Fc "${POSTGRES_DB}" > "${DUMP_FILE}"
DUMP_SIZE=$(du -h "${DUMP_FILE}" | cut -f1)

echo "Lade nach S3 hoch..."
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${DUMP_FILE}" "s3://${S3_BUCKET}/backups/zeiterfassung-${TIMESTAMP}.dump"

rm -f "${DUMP_FILE}"
BACKUP_OK=1
echo "Backup abgeschlossen: zeiterfassung-${TIMESTAMP}.dump (${DUMP_SIZE})"

# Aufbewahrungsdauer der Backups selbst: über eine Lifecycle-Regel im Bucket
# steuern (bei den meisten S3-kompatiblen Anbietern im
# Objektspeicher-Dashboard konfigurierbar), nicht hier im Skript — robuster,
# da unabhängig davon, ob der Cronjob zuverlässig läuft.

# ErrorLog-Aufräumung (lib/error-log.ts: 90 Tage Aufbewahrung). Eigener,
# unabhängiger Block NACH dem Backup-Trap (der bezieht sich nur auf
# BACKUP_OK) — ein Fehlschlag hier soll den bereits erfolgreich gemeldeten
# Backup-Status nicht überschreiben, deshalb eigenes log_ops_event mit
# eigenem Ergebnis statt Wiederverwendung von BACKUP_OK/on_exit.
echo "Räume ErrorLog auf (> 90 Tage)..."
if PRUNE_OUTPUT=$(docker compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -t -c \
  "DELETE FROM \"ErrorLog\" WHERE \"createdAt\" < now() - interval '90 days';" 2>&1); then
  log_ops_event "errorlog-prune" "ok" "$(echo "${PRUNE_OUTPUT}" | tr -d '[:space:]')"
  echo "ErrorLog-Aufräumung abgeschlossen."
else
  log_ops_event "errorlog-prune" "failed" "$(echo "${PRUNE_OUTPUT}" | tr '\n' ' ')"
  echo "Warnung: ErrorLog-Aufräumung fehlgeschlagen." >&2
fi
