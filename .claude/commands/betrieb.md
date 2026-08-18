---
description: Arbeitet BETRIEB.md ab — Backups, Server-Härtung, Einladungslink, Import der Alt-Exporte
argument-hint: [optional: Punktnummer zum Wiedereinstieg]
allowed-tools: Bash, Read, Write, Edit
---

# Betriebs-Loop: ONEXIS Zeiterfassung

Die Instanz läuft (`https://zeit-onexis.duckdns.org`, Deployment-Loop
`.claude/commands/infomaniak.md` abgeschlossen). Dieser Loop macht aus
der laufenden Instanz einen betreibbaren Dienst und schliesst zwei
Lücken im Alltag.

Fortschritt und Befunde stehen in **`BETRIEB.md`** im Repo-Root — anders
als `DEPLOY_STATE.md` ist die Datei **getrackt**, weil zwei Punkte Code
ändern und der Verlauf in die Historie gehört.

Beim Start: `BETRIEB.md` lesen, beim ersten offenen Punkt einsteigen.
Mit Argument `$ARGUMENTS` bei dieser Punktnummer beginnen.

## Regeln für jede Iteration

1. Nimm den **ersten** Punkt, dessen Box nicht abgehakt ist.
2. Erledige ihn **vollständig** — keine Teilstände.
3. Ist es ein **MANUELL**-Schritt? → Anweisung ausgeben, stoppen, auf
   Nicos Bestätigung warten. Nichts vortäuschen, nichts abhaken ohne
   Verify.
4. Bei **Code-Punkten** danach in dieser Reihenfolge:
   - `npx prisma generate`
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - `git add -A && git commit` mit aussagekräftiger Nachricht
5. Bei **Server-Punkten**: Verify-Befehl ausführen, Ergebnis in
   `BETRIEB.md` festhalten.
6. **Maximal 3 Versuche pro Punkt**, danach stoppen und melden — nicht
   weiterwursteln, nicht auf den nächsten Punkt springen.
7. Erst dann die Box abhaken und `BETRIEB.md` aktualisieren.

Loop endet, wenn Punkt 4 abgehakt ist (Punkt 5 ist optional). Dann
Kurzreport: was läuft, was bleibt offen.

## SSH-Zugang

```bash
ssh -i ~/.ssh/oracle_zeiterfassung ubuntu@179.237.100.100
cd ~/zeiterfassung
```
(Der Schlüsselname stammt aus dem abgebrochenen Oracle-Versuch.)

## Die Punkte

**1 — Backups nach Infomaniak Swiss Backup.**
`deploy/backup.sh` ist fertig und lokal gegen eine echte Datenbank
verifiziert; es fehlen nur Zugangsdaten.

- **MANUELL:** Swiss-Backup-Abo mit S3-Zugang anlegen, Endpoint, Bucket
  und Schlüssel bereithalten.
- Auf dem VPS: `sudo apt install -y awscli`, danach `aws configure`
  (die Zugangsdaten gibt Nico ein, nicht in die Chat-Ausgabe schreiben).
- `S3_ENDPOINT` und `S3_BUCKET` an die `.env` neben `docker-compose.yml`
  anhängen — `backup.sh` liest sie selbst ein.
- Einmal von Hand laufen lassen: `./deploy/backup.sh`
- Cronjob 03:00 einrichten (Zeile steht in `deploy/README.md`, Abschnitt 4).

Verify: `aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/backups/"`
zeigt eine Datei mit Grösse > 0.

**Restore-Test, nicht verhandelbar.** Ein ungeprüftes Backup ist kein
Backup. In eine **Wegwerf-Datenbank** zurückspielen, niemals in
`zeiterfassung`:
```bash
docker compose exec -T db createdb -U "$POSTGRES_USER" zeiterfassung_restoretest
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d zeiterfassung_restoretest < dump
# Zeilenzahlen der 16 Tabellen gegen das Original vergleichen
docker compose exec -T db dropdb -U "$POSTGRES_USER" zeiterfassung_restoretest
```
`deploy/restore.sh` dabei **nicht** benutzen — das Skript überschreibt
die Produktivdatenbank.

**2 — Server-Härtung.**
Reihenfolge ist sicherheitskritisch: **erst** die Regel für Port 22,
**dann** `ufw enable`. Andersherum sperrt man sich aus. Rettungsweg wäre
die VNC-Konsole im Infomaniak-Manager (Passwort ist gesetzt).

```bash
sudo apt install -y ufw fail2ban unattended-upgrades
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
sudo systemctl enable --now fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades   # nicht-interaktiv setzen
```
`PasswordAuthentication no` ist bereits aktiv — nur bestätigen, nichts
ändern.

Verify: **aus einer neuen SSH-Sitzung** `sudo ufw status verbose` und
`sudo fail2ban-client status sshd`; von aussen 22/80/443 offen und ein
willkürlicher vierter Port zu; `curl -f https://$DOMAIN/api/health`
weiterhin ok.

**3 — Einladungslink im Dialog statt per Mail.**
Nico will bewusst keinen SMTP-Versand. Der Link soll direkt nach dem
Anlegen zum Kopieren erscheinen.

Befund, der das Design bestimmt: Gespeichert wird nur `tokenHash`. Der
Klartext-Token existiert ausschliesslich im Moment der Erstellung
(`app/api/invitations/route.ts:89`). Für eine **bestehende** Einladung
lässt sich der Link deshalb nicht nachträglich einblenden — das Muster
ist „erneut einladen erzeugt einen frischen Link". Die Route unterstützt
das bereits: sie entwertet vorherige offene Einladungen derselben
Adresse.

- `POST /api/invitations` gibt zusätzlich `inviteUrl` zurück.
- `app/(app)/admin/team/page.tsx`: nach dem Anlegen ein Dialog
  (`components/ui/dialog.tsx` ist vorhanden) mit Link, Kopier-Knopf,
  Gültigkeitshinweis („7 Tage, einmal verwendbar") und dem Hinweis, den
  Link vertraulich zu behandeln.
- Liste offener Einladungen bekommt „Link neu erzeugen" (ruft dieselbe
  Route erneut auf).
- Der `sendMail`-Aufruf bleibt stehen: wird doch einmal SMTP gesetzt,
  geht die Mail zusätzlich raus.

**Harte Sicherheitsgrenze:** Das gilt **nur** für Einladungen — nur
`owner`/`admin` dürfen sie erzeugen, der Ersteller darf den Link ohnehin
sehen. Für `/api/auth/forgot-password` gilt es **nicht**: die Route ist
unauthentifiziert, ein zurückgegebener Token wäre Kontoübernahme über
eine fremde E-Mail-Adresse. Der Kommentar in `lib/mail.ts` sagt genau
das — nicht aufweichen.

Verify: Einladung anlegen → Dialog zeigt Link → Link in einem privaten
Fenster öffnen → Beitritt klappt; zweiter Aufruf desselben Links schlägt
fehl. Test für die Route ergänzen.

**4 — Import der Alt-Exporte (Excel).**
Vorlage: `~/Downloads/zeiterfassung_year_1787054338273.xlsx` — der Export
einer **älteren Fassung dieser App**. Blätter: `Tageszeiten`,
`Kundenstunden`, `Zusammenfassung`. Nur `Tageszeiten` ist importierbar,
die anderen beiden sind aggregierte Auswertungen.

Die Altdatei hat **4 Spalten** (`Datum, Wochentag, Stunden, Typ`), der
heutige Export schreibt **8** (`app/api/export/route.ts:212`). Der Parser
geht deshalb **über Spaltenüberschriften**, nie über Positionen, und
toleriert fehlende Spalten.

Umfang: **jede Person importiert für sich selbst**, kein Admin-Import
für Dritte.

- `lib/import-timesheet.ts` — reine, Prisma-freie Parserfunktion (Muster
  wie `lib/calc.ts`): Workbook rein, geprüfte Zeilen plus Fehlerliste
  raus, dadurch ohne Datenbank testbar.
  - Datum als `dd.mm.yyyy` **und** als echte Excel-Datumszelle annehmen
  - Typ über die Umkehrung von `TYPE_LABELS`
    (`lib/export-helpers.ts:109`) auf `EINTRAG_TYPEN` (`lib/calc.ts:4`)
    abbilden; unbekannte Bezeichnung → Zeilenfehler, kein stiller
    Fallback auf "arbeit"
  - Summenzeile am Ende ("Total") erkennen und überspringen
  - Ohne `Von`/`Bis`: `buildArbeitszeit(hours)` aus
    `app/api/time-entries/bulk-apply/route.ts` nutzen — dafür nach `lib/`
    herausziehen, Aufrufer anpassen, keine Verhaltensänderung
- `POST /api/import/timesheet` — `requireOrg()`, schreibt **immer** auf
  die eigene `userId`.
  - Zwei Modi: `dryRun` (Vorschau mit Anzahl, Zeitraum, Konflikten,
    Fehlern) und Übernahme.
  - Vorhandene Einträge am selben Datum werden **übersprungen**, nicht
    überschrieben — kein stilles Überschreiben erfasster Zeiten.
  - Gesperrte Monate (`MonthLock`) respektieren: Zeile ablehnen, nicht
    importieren.
- Oberfläche unter `app/(app)/profile`: Datei wählen → Vorschau →
  "X Einträge importieren".

Verify: Unit-Tests gegen im Test erzeugte Workbooks (4-Spalten- und
8-Spalten-Variante, kaputte Zeilen, Summenzeile, gesperrter Monat).
Danach echter Durchlauf mit Nicos Datei: Vorschau prüfen, importieren,
Stundensumme gegen das Blatt `Zusammenfassung` der Altdatei halten
(Arbeitsstunden 422.0h, Ferienstunden 48.0h, Feiertagsstunden 32.8h).

**5 — OPTIONAL: Passwort zurücksetzen ohne Mail.**
Streichbar, aber die Lücke ist real: Ohne SMTP kommt niemand mehr in sein
Konto, der sein Passwort vergisst. `/api/admin/team` kann heute nur lesen
und bearbeiten (`GET`, `PUT`). Das Feld `mustSetPassword` im `User`-Modell
ist der vorgesehene Baustein. Vorschlag: Admin-Aktion erzeugt einen
Reset-Link für ein Mitglied und zeigt ihn im selben Kopier-Dialog wie
Punkt 3 — authentifiziert und auf `owner`/`admin` beschränkt.

Vor Beginn dieses Punktes Nico fragen, ob er ihn will.

## Harte Regeln

- **Kein** `prisma db seed` / `scripts/seed.ts` auf dieser Instanz.
- **Kein** `prisma migrate reset`, **kein** `docker compose down -v`,
  **kein** `deploy/restore.sh` gegen die Produktivdatenbank.
- `.env` niemals committen, niemals ausgeben, niemals in den Report.
- **Keine Zugangsdaten in `BETRIEB.md`** — keine S3-Schlüssel, keine
  Passwörter, keine Einladungs- oder Reset-Token.
- Import schreibt nie auf eine fremde `userId`, auch nicht "kurz zum
  Testen".
- Kein Punkt wird ohne bestandenen Verify abgehakt. Bei Zweifeln, ob ein
  Verify wirklich grün war: als rot behandeln.
- Manuelle Schritte nie selbst "annehmen" — immer auf Nicos Bestätigung
  warten.
- Produktivdaten sind echte Arbeitszeiten von Mitarbeitenden. Änderungen
  daran nur über die geplanten Wege, nie per Ad-hoc-SQL.
