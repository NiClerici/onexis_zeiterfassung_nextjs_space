# Deployment auf Schweizer Infrastruktur

Schritt-für-Schritt-Anleitung für eine einzelne VM bei [cloudscale.ch](https://cloudscale.ch)
oder [Infomaniak Public Cloud](https://www.infomaniak.com/de/hosting/public-cloud) —
beides Schweizer Anbieter mit Rechenzentren in der Schweiz (MIGRATION.md
Punkt 11). Docker Compose orchestriert drei Container: `app` (diese
Next.js-App), `db` (PostgreSQL) und `caddy` (Reverse Proxy mit
automatischem TLS via Let's Encrypt).

**Hinweis zum Testumfang dieser Anleitung:** Die Docker-Konfiguration
(`Dockerfile`, `docker-compose.yml`) wurde in der Sandbox, in der dieses
Projekt entwickelt wurde, per `docker compose config` syntaktisch
validiert; ein echter `docker build`/`docker compose up` gegen eine
laufende Docker-Engine war dort nicht möglich (Docker Desktop verlangt
einen interaktiven Erststart-Dialog). Die Backup/Restore-**Mechanik**
(`pg_dump`/`pg_restore`) wurde dagegen echt gegen die lokale
Entwicklungsdatenbank durchgespielt — alle 16 Tabellen stimmten nach
einem vollständigen Dump/Restore-Zyklus exakt überein. Vor dem ersten
produktiven Einsatz empfiehlt sich trotzdem ein einmaliger kompletter
Testlauf dieser Anleitung auf einer echten VM.

---

## 1. Voraussetzungen

- Eine VM bei cloudscale.ch, Infomaniak Public Cloud oder Infomaniak
  VPS Lite (empfohlen: Ubuntu 22.04 LTS, mind. 2 vCPU / 4 GB RAM für App
  + PostgreSQL + Caddy). Tatsächlich im Einsatz ist ein **Infomaniak VPS
  Lite** mit 2 vCPU / 4 GB / 60 GB — der Schritt-für-Schritt-Ablauf dafür
  steht im Deployment-Loop `.claude/commands/infomaniak.md`. Auf 4 GB RAM
  vor dem ersten `docker compose up --build` 2 GB Swap anlegen, sonst
  kann `next build` per OOM abbrechen.
- Docker Engine + Docker Compose Plugin auf der VM installiert
  ([offizielle Anleitung](https://docs.docker.com/engine/install/ubuntu/)).
- Eine Domain, deren DNS-A-Record auf die IP der VM zeigt (für Caddys
  automatisches TLS-Zertifikat).
- Ports 80 und 443 in der Firewall der VM (bzw. im Security-Group-Regelwerk
  des Cloud-Anbieters) freigegeben.
- Ein S3-kompatibler Objektspeicher-Bucket in der Schweiz für die
  täglichen Backups (z.B. cloudscale.ch Object Storage oder Infomaniak
  Swiss Backup) sowie die [AWS CLI](https://docs.aws.amazon.com/cli/) auf
  der VM installiert (funktioniert gegen jeden S3-kompatiblen Endpunkt,
  nicht nur gegen AWS selbst — `aws configure` mit den vom Anbieter
  ausgestellten Zugangsschlüsseln).

## 2. Erster Rollout

```bash
# Repository auf die VM klonen
git clone <repo-url> zeiterfassung
cd zeiterfassung

# .env aus der Vorlage erstellen und ausfüllen
cp .env.example .env
nano .env   # POSTGRES_PASSWORD, NEXTAUTH_SECRET, NEXTAUTH_URL, DOMAIN, SMTP_*

# Zusätzlich für die Backups (nicht in .env.example, da nur fürs Backup-
# Skript gebraucht — S3_ENDPOINT und S3_BUCKET ans Ende von .env anhängen):
echo 'S3_ENDPOINT="https://objects.rma.cloudscale.ch"' >> .env
echo 'S3_BUCKET="zeiterfassung-backups"' >> .env

# Container bauen und starten
docker compose up -d --build

# Datenbankschema anlegen (einmalig, danach nach jedem Deploy mit neuen
# Migrationen wiederholen). Läuft im "migrate"-Container, nicht im "app"-
# Container: das schlanke Laufzeit-Image enthält weder das prisma-CLI noch
# prisma/migrations/ (siehe docker-compose.yml, Service "migrate").
docker compose run --rm migrate

# Healthcheck prüfen
curl -f https://<deine-domain>/api/health
# → {"status":"ok","database":"ok"}
```

Caddy holt beim ersten Request automatisch ein Let's-Encrypt-Zertifikat für
`DOMAIN` — das dauert je nach DNS-Propagation ein paar Sekunden bis
Minuten. `docker compose logs -f caddy` zeigt den Fortschritt.

## 3. Updates ausrollen

```bash
./deploy/deploy.sh
```

Automatisiert die vier manuellen Schritte (`git pull`, Rebuild, Migration,
Healthcheck) in einem Skript. Bricht bei uncommitteten Änderungen, einem
fehlgeschlagenen Build oder einem roten Healthcheck sofort ab, statt einen
kaputten Stand laufen zu lassen. Äquivalent von Hand:

```bash
git pull
docker compose up -d --build
docker compose run --rm migrate
curl -f https://<deine-domain>/api/health
```

`prisma migrate deploy` ist ohne neue Migrationen ein No-op — gefahrlos bei
jedem Deploy mitlaufen lassen, statt zu prüfen, ob es diesmal nötig ist.

## 4. Tägliches Backup

`deploy/backup.sh` dumpt die Datenbank (`pg_dump`, Custom-Format) und lädt
sie in den konfigurierten S3-Bucket hoch. Als täglicher Cronjob auf der VM
einrichten (z.B. um 03:00 Uhr nachts):

```bash
crontab -e
# Zeile hinzufügen:
0 3 * * * cd /path/to/zeiterfassung && ./deploy/backup.sh >> /var/log/zeiterfassung-backup.log 2>&1
```

Die Aufbewahrungsdauer alter Backups über eine Lifecycle-Regel im Bucket
selbst steuern (bei cloudscale.ch/Infomaniak im Objektspeicher-Dashboard
konfigurierbar) — robuster als eine Löschlogik im Skript, die bei einem
fehlgeschlagenen Cronjob-Lauf nie ausgeführt würde.

## 5. Restore (getestet)

```bash
./deploy/restore.sh zeiterfassung-20260101-030000.dump
```

Lädt die angegebene Backup-Datei aus dem S3-Bucket, fragt zur Bestätigung
nach (überschreibt die aktuelle Datenbank vollständig) und stellt sie über
`pg_restore --clean --if-exists` wieder her. Nach der Wiederherstellung:

```bash
docker compose restart app
```

**Lokal verifiziert** (siehe Hinweis oben): `pg_dump -Fc` gefolgt von
`pg_restore` auf eine frische Datenbank reproduzierte alle Tabellen
(User, Organization, Membership, TimeEntry, TimeEntryAudit, Customer,
Project, Holiday, MonthLock, MonthLockAudit, AbsenceRequest, Invitation,
PasswordResetToken, LoginAttempt, PensumChange, OvertimePayout) mit exakt
identischen Zeilenzahlen wie im Original.

## 6. Logs und Monitoring

```bash
docker compose logs -f app      # App-Logs (inkl. Server-seitig geloggter
                                 # Passwort-Reset-Mails ohne SMTP-Konfig)
docker compose logs -f db
docker compose logs -f caddy
docker compose ps               # Status/Health aller drei Container
```

`/api/health` (MIGRATION.md Punkt 11) eignet sich für externes Uptime-
Monitoring (z.B. ein einfacher Cronjob-basierter Check oder ein Dienst mit
Schweizer Standort) — liefert `200` bei erreichbarer Datenbank, `503`
sonst.

## 7. Troubleshooting

- **Caddy bekommt kein Zertifikat**: DNS-A-Record auf die VM-IP prüfen
  (`dig +short <domain>`), Port 80 muss von aussen erreichbar sein (Caddy
  braucht ihn für die ACME-HTTP-01-Challenge, nicht nur 443).
- **`docker compose run --rm migrate` schlägt fehl**: `docker compose ps`
  prüfen — meistens ist der `db`-Container noch nicht healthy oder
  `POSTGRES_PASSWORD` in `.env` passt nicht zu dem, mit dem das
  `db_data`-Volume ursprünglich initialisiert wurde. Fehler wie
  "Could not find a schema.prisma file" bedeuten dagegen, dass der Befehl
  im falschen Container gelaufen ist (`exec app` statt `run --rm
  migrate`) — das Laufzeit-Image enthält das Prisma-Schema bewusst nicht.
- **App startet, aber `/api/health` liefert 503**: Datenbankverbindung
  prüfen, `docker compose exec app node -e "process.exit(0)"` als
  minimaler Container-Lebendigkeitstest, danach `docker compose logs app`.
