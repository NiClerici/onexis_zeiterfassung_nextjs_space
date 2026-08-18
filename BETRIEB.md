# BETRIEB.md — Backups, Härtung, Einladungslink, Alt-Import

Arbeitsplan und Fortschrittsstand für den Loop
`.claude/commands/betrieb.md`. Gleiche Regeln wie HARDENING.md und
FOLLOWUP.md: erster nicht abgehakter Punkt, vollständig erledigen,
verifizieren, abhaken.

**Ausgangslage (18.08.2026):** Die Instanz läuft produktiv unter
`https://zeit-onexis.duckdns.org` (Deployment-Loop `/infomaniak`
abgeschlossen, Commit dac6e9f). Organisation "Onexis GmbH" existiert,
Nico ist `owner`, eine Einladung ist offen. Es liegen noch keine
Zeiteinträge vor — der Zeitpunkt für Backups und Härtung ist also jetzt,
bevor echte Daten entstehen.

**Anders als HARDENING.md: dieser Loop baut Features.** Punkt 3 und 4
sind bewusst neue Funktionalität. Punkt 1 und 2 fassen keinen Code an,
sondern den Server.

## Regeln für jede Iteration

1. Nimm den **ersten** Punkt, dessen Box nicht abgehakt ist.
2. Erledige ihn **vollständig** — keine Teilstände.
3. Bei Code-Punkten danach in dieser Reihenfolge:
   - `npx prisma generate` (sonst falsche Typecheck-Fehler)
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - `git add -A && git commit` mit aussagekräftiger Nachricht
4. Bei Server-Punkten: Verify-Befehl ausführen, Ergebnis hier festhalten.
5. **Blockiert?** Grund als `> BLOCKER: …` unter den Punkt schreiben und
   aufhören.
6. Erst dann die Box abhaken.

**Keine Zugangsdaten in dieser Datei** — keine S3-Schlüssel, keine
Passwörter, keine Einladungs- oder Reset-Token. Die Datei ist getrackt
und landet auf GitHub.

---

### - [x] 1. Backups nach Infomaniak Swiss Backup

`deploy/backup.sh` ist fertig; die Dump/Restore-Mechanik wurde laut
`deploy/README.md` lokal gegen eine echte Datenbank verifiziert (alle 16
Tabellen mit identischen Zeilenzahlen). Es fehlen ausschliesslich
Zugangsdaten und die AWS-CLI auf dem VPS.

Teilschritte: Abo anlegen (MANUELL) → `awscli` installieren →
`aws configure` → `S3_ENDPOINT`/`S3_BUCKET` an die `.env` auf dem VPS
anhängen → einmal von Hand laufen lassen → Cronjob 03:00.

**Restore-Test ist Teil dieses Punktes, nicht optional.** Rückspielen in
eine Wegwerf-Datenbank (`zeiterfassung_restoretest`), Zeilenzahlen
vergleichen, Wegwerf-DB löschen. `deploy/restore.sh` dabei nicht
verwenden — es überschreibt die Produktivdatenbank.

Verify: Datei im Bucket mit Grösse > 0 **und** bestandener Restore-Test.

**Ergebnis (18.08.2026):** Swiss-Backup-Produkt bestellt (Tarif "Device",
Backup Cloud, nicht Acronis) — die Zugangsdaten entstehen erst NACH der
Bestellung im Produkt selbst unter "Manage my devices" → "Add device" →
Typ S3, nicht auf der Bestellseite. Angelegtes S3-Device heisst
`onexis-zeiterfassung`, Endpoint `https://s3.swiss-backup02.infomaniak.com`,
Standort 02. Auf dem VPS `awscli` (1.22.34) installiert,
`aws configure` interaktiv von Nico ausgefuehrt (Region `us-east-1` —
reiner AWS-CLI-Pflichtwert fuer die Signatur, keine Aussage ueber den
tatsaechlichen Speicherort, der liegt fest bei Infomaniak Schweiz).

Bucket `onexis-zeiterfassung-backups` angelegt (statt des von Infomaniak
vorgegebenen generischen `default`-Buckets). `S3_ENDPOINT` und
`S3_BUCKET` an die `.env` auf dem VPS angehaengt.

Erster Lauf von `deploy/backup.sh`: Dump 42217 Bytes, erfolgreich nach
S3 hochgeladen. **Restore-Test bestanden:** Dump aus S3 geladen, in eine
Wegwerf-Datenbank `zeiterfassung_restoretest` zurueckgespielt (NICHT in
`zeiterfassung`, `deploy/restore.sh` nicht verwendet), alle 17 Tabellen
(16 fachliche + `_prisma_migrations`) mit identischen Zeilenzahlen wie
im Original — Diff leer. Wegwerf-DB und temporaere Dateien danach
entfernt.

Cronjob taeglich 03:00 eingerichtet:
`cd /home/ubuntu/zeiterfassung && ./deploy/backup.sh >> /var/log/zeiterfassung-backup.log 2>&1`,
Log-Datei mit `ubuntu:ubuntu`-Rechten vorbereitet.

Keine Zugangsdaten in dieser Datei — Access Key und Secret Key liegen
ausschliesslich in `~/.aws/credentials` auf dem VPS.

### - [x] 2. Server-Härtung

`ufw` (default deny incoming, allow 22/80/443), `fail2ban` mit
sshd-Jail, `unattended-upgrades`. `PasswordAuthentication no` ist bereits
aktiv (am 18.08. geprüft) — nur bestätigen.

**Reihenfolge beachten:** erst die Regel für Port 22, dann `ufw enable`.
Andersherum sperrt man sich aus; Rettungsweg wäre die VNC-Konsole im
Infomaniak-Manager.

Verify: aus einer **neuen** SSH-Sitzung `ufw status verbose` und
`fail2ban-client status sshd`; von aussen 22/80/443 offen, ein
willkürlicher vierter Port zu; Healthcheck weiterhin grün.

**Ergebnis (18.08.2026):** `ufw`, `fail2ban`, `unattended-upgrades`
installiert. Reihenfolge eingehalten — erst Regeln fuer 22/80/443
gesetzt, danach `ufw enable`. Status: `active`, Default incoming
`deny`, Default outgoing `allow`, IPv4+IPv6-Regeln fuer alle drei Ports.

`fail2ban`: `jail.local` mit explizitem `[sshd]`-Jail (maxretry 5,
bantime 3600s, findtime 600s) statt sich auf den Paket-Default zu
verlassen. Aktiv, 0 Bans bislang.

`unattended-upgrades`: `20auto-upgrades` gesetzt (Update-Package-Lists
und Unattended-Upgrade je "1"), Trockenlauf ohne Fehler ("All upgrades
installed"), beide systemd-Timer (`apt-daily`, `apt-daily-upgrade`)
enabled.

`PasswordAuthentication no` war bereits aktiv (siehe Deployment-Loop) —
erneut bestaetigt, nichts geaendert.

**Verify bestanden:** neue SSH-Sitzung funktioniert (Schluessel-Auth
unveraendert), `curl https://zeit-onexis.duckdns.org/api/health` weiterhin
`{"status":"ok","database":"ok"}`, Port 8080 (stellvertretend fuer
"alles ausser 22/80/443") von aussen zu.

### - [x] 3. Einladungslink im Dialog statt per Mail

Entscheid vom 18.08.: kein SMTP-Anbieter, stattdessen Link direkt in der
Oberfläche zum Kopieren.

**Befund, der das Design bestimmt:** Gespeichert wird nur `tokenHash`
(`prisma/schema.prisma`, Modell `Invitation`). Der Klartext-Token
existiert nur im Moment der Erstellung (`app/api/invitations/route.ts:89`).
Für eine bestehende Einladung lässt sich der Link deshalb nicht
nachträglich anzeigen — das Muster ist „erneut einladen erzeugt einen
frischen Link". Die Route unterstützt das bereits: sie entwertet
vorherige offene Einladungen derselben Adresse.

Umfang: `POST /api/invitations` gibt `inviteUrl` zurück;
`app/(app)/admin/team/page.tsx` zeigt nach dem Anlegen einen Dialog mit
Link und Kopier-Knopf; offene Einladungen bekommen „Link neu erzeugen";
`sendMail` bleibt im Aufruf für den Fall, dass später doch SMTP kommt.

**Sicherheitsgrenze:** gilt nur für Einladungen (nur `owner`/`admin`
erzeugen sie, der Ersteller darf den Link sehen). **Nicht** für
`/api/auth/forgot-password` — die Route ist unauthentifiziert, ein
zurückgegebener Token wäre Kontoübernahme über eine fremde Adresse. Der
Kommentar in `lib/mail.ts` begründet das; nicht aufweichen.

Verify: Einladung anlegen → Dialog zeigt Link → Beitritt im privaten
Fenster klappt → zweiter Aufruf desselben Links schlägt fehl. Test für
die Route.

### - [x] 4. Import der Alt-Exporte (Excel)

Vorlage ist der Jahresexport einer älteren Fassung dieser App
(Blätter `Tageszeiten`, `Kundenstunden`, `Zusammenfassung`). Nur
`Tageszeiten` ist importierbar; die beiden anderen sind aggregierte
Auswertungen ohne Tagesbezug.

**Formatunterschied:** Die Altdatei hat 4 Spalten
(`Datum, Wochentag, Stunden, Typ`), der heutige Export schreibt 8
(zusätzlich `Von, Bis, Kunde/Projekt, Notiz`, siehe
`app/api/export/route.ts:212`). Der Parser geht deshalb über
Spaltenüberschriften, nie über Positionen.

Umfang laut Entscheid: **jede Person importiert für sich selbst.**

Bausteine: `lib/import-timesheet.ts` (reiner Parser, Prisma-frei,
testbar) · `POST /api/import/timesheet` mit `dryRun`-Vorschau ·
Oberfläche unter `app/(app)/profile`. Wiederverwenden statt neu bauen:
`TYPE_LABELS` (`lib/export-helpers.ts:109`) umgekehrt für die
Typ-Zuordnung, `EINTRAG_TYPEN` (`lib/calc.ts:4`) als erlaubte Menge,
`buildArbeitszeit(hours)` aus
`app/api/time-entries/bulk-apply/route.ts` (nach `lib/` herausziehen)
für Von/Bis/Pause aus reinen Stunden.

Regeln: vorhandene Einträge am selben Datum werden **übersprungen**,
nicht überschrieben; gesperrte Monate (`MonthLock`) werden abgelehnt.

Verify: Unit-Tests mit im Test erzeugten Workbooks (beide Spalten-
varianten, kaputte Zeilen, Summenzeile, gesperrter Monat). Danach echter
Durchlauf mit Nicos Datei, Stundensumme gegen das Blatt
`Zusammenfassung` halten: Arbeitsstunden 422.0h, Ferienstunden 48.0h,
Feiertagsstunden 32.8h.

**Ergebnis (18.08.2026):** `lib/import-timesheet.ts` (reiner Parser,
kein Prisma) liest ueber Spaltenueberschriften — Pflichtspalten Datum/
Stunden/Typ, Von/Bis/Notiz optional. Typ-Zuordnung ueber die Umkehrung
von `TYPE_LABELS`; unbekannte Typen werden als Zeilenfehler gemeldet,
nicht still auf "arbeit" gemappt. Summenzeilen ("Total" in irgendeiner
Zelle) und Leerzeilen werden uebersprungen. `buildArbeitszeit` aus
`app/api/time-entries/bulk-apply/route.ts` nach `lib/arbeitszeit.ts`
gezogen (Verhalten unveraendert, nur der Ort), wird jetzt von beiden
Stellen genutzt.

`POST /api/import/timesheet` (`requireOrg()`, schreibt immer auf die
eigene `userId`) prueft Konflikte gegen die Datenbank: vorhandene
Eintraege am selben Datum werden uebersprungen, nicht ueberschrieben.
Gesperrte Monate blockieren nur fuer Rolle `member` — dieselbe Regel wie
ueberall sonst (`lib/access.ts`, `assertMonthEditable`), admin/manager/
owner duerfen auch in gesperrten Monaten importieren. Zwei Modi
(`preview`/`commit`) mit identischer Konfliktpruefung.

Oberflaeche unter `app/(app)/profile`: Datei waehlen → Vorschau (Anzahl,
Zeitraum, uebersprungene Zeilen, Fehlerliste aufklappbar) → Bestaetigen.

**Verifikation gegen Nicos echte Datei**
(`zeiterfassung_year_1787054338273.xlsx`, Export des Vorgaengersystems):
alle 159 Zeilen fehlerfrei geparst. Summen bis zum Exportzeitpunkt
(18.08.2026, aus dem Dateinamen dekodiert) stimmen exakt mit dem Blatt
"Zusammenfassung" ueberein — Arbeitsstunden 422.0h, Ferienstunden 48.0h,
Feiertagsstunden 32.8h (Summe 502.8h = "Ist-Stunden bis heute"). Die
uebrigen 546.4h sind in die Zukunft datierte Eintraege ("Geplante
Stunden") und werden beim Import mit importiert, wie es die App auch bei
selbst erfassten Zukunftsdaten tut.

Zwei neue Testdateien: `lib/import-timesheet.test.ts` (7 Faelle, reiner
Parser: beide Spaltenvarianten, Summenzeile, fehlende Pflichtspalte,
fehlendes Blatt, defekte Zeilen, Leerzeilen) und
`lib/import-timesheet-route.test.ts` (4 Faelle: preview schreibt nichts,
commit schreibt und ueberspringt beim zweiten Lauf Duplikate, gesperrter
Monat blockiert member aber nicht admin, Zeilenfehler stoppen nicht die
uebrigen gueltigen Zeilen). Volle Suite: 316/316 Tests, 21 Dateien.

### - [ ] 5. OPTIONAL: Passwort zurücksetzen ohne Mail

Ohne SMTP kommt niemand mehr in sein Konto, der sein Passwort vergisst.
`/api/admin/team` kann heute nur `GET` und `PUT`. Das Feld
`mustSetPassword` im `User`-Modell ist der vorgesehene Baustein.

Vorschlag: Admin-Aktion erzeugt einen Reset-Link für ein Mitglied und
zeigt ihn im selben Kopier-Dialog wie Punkt 3 — authentifiziert, auf
`owner`/`admin` beschränkt, damit ohne die Schwäche der öffentlichen
Route.

Vor Beginn mit Nico klären, ob der Punkt überhaupt gewollt ist.

---

## Notizen des Loops

<!-- pro Punkt: Befund, Abweichung vom Plan, Verify-Ergebnis, Datum -->
