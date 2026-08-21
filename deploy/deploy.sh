#!/usr/bin/env bash
# Rollt die aktuelle origin/main-Version auf dieser VM aus (deploy/README.md
# Abschnitt 3 "Updates ausrollen", als Skript statt vier manueller Befehle).
# Für die direkte Ausführung auf dem Host gedacht, NICHT in einem Container.
#
# Ablauf: git pull, Image neu bauen und Container neu starten, Migrationen
# anwenden (No-op ohne neue Migrationen, siehe deploy/README.md), danach
# Healthcheck gegen DOMAIN aus .env. Bricht bei jedem Fehler sofort ab
# (set -e) und lässt den vorherigen Container-Zustand unangetastet — ein
# fehlgeschlagener Build ersetzt nie einen laufenden Container.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Fehler: .env fehlt in $(pwd) — falsches Verzeichnis?" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
: "${DOMAIN:?DOMAIN fehlt in .env}"

# Uncommittete Änderungen auf der VM wären entweder vergessene lokale
# Debug-Anpassungen oder ein Sonderfall, der Aufmerksamkeit braucht — in
# beiden Fällen soll git pull nicht stillschweigend darüber hinweggehen.
if [ -n "$(git status --porcelain)" ]; then
  echo "Fehler: uncommittete Änderungen im Arbeitsverzeichnis. Erst git status prüfen." >&2
  exit 1
fi

BEFORE=$(git rev-parse HEAD)
echo "Aktueller Stand: ${BEFORE}"

echo "Hole neuesten Stand von origin/main..."
git pull --ff-only origin main

AFTER=$(git rev-parse HEAD)
if [ "${BEFORE}" = "${AFTER}" ]; then
  echo "Bereits aktuell (${AFTER}) — kein Deploy nötig."
  exit 0
fi
echo "Neuer Stand: ${AFTER}"

echo "Baue und starte Container neu..."
docker compose up -d --build

echo "Wende Migrationen an..."
# --build ist hier Pflicht, nicht Kosmetik: "migrate" hat profiles: ["tools"]
# und wird von "docker compose up -d --build" oben NICHT mitgebaut. Ohne
# --build würde dieser Schritt mit einem beliebig alten, gecachten Image
# laufen — das meldet dann fälschlich "no pending migrations", obwohl das
# aktuelle Schema neue Spalten/Tabellen erwartet, die die echte DB noch gar
# nicht hat (beobachtet: P2022 auf frisch deployten Feldern trotz "erfolgreichem"
# Deploy, weil dieser Schritt lange ohne --build lief).
docker compose run --rm --build migrate

echo "Healthcheck..."
for i in $(seq 1 10); do
  if curl -fsS "https://${DOMAIN}/api/health"; then
    echo
    echo "Deploy abgeschlossen: ${BEFORE} -> ${AFTER}"
    exit 0
  fi
  sleep 3
done

echo "Fehler: Healthcheck nach Deploy fehlgeschlagen (${BEFORE} -> ${AFTER})." >&2
echo "Container-Logs prüfen: docker compose logs -f app" >&2
exit 1
