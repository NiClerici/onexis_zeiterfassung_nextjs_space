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

### - [ ] 1. Backups nach Infomaniak Swiss Backup

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

### - [ ] 2. Server-Härtung

`ufw` (default deny incoming, allow 22/80/443), `fail2ban` mit
sshd-Jail, `unattended-upgrades`. `PasswordAuthentication no` ist bereits
aktiv (am 18.08. geprüft) — nur bestätigen.

**Reihenfolge beachten:** erst die Regel für Port 22, dann `ufw enable`.
Andersherum sperrt man sich aus; Rettungsweg wäre die VNC-Konsole im
Infomaniak-Manager.

Verify: aus einer **neuen** SSH-Sitzung `ufw status verbose` und
`fail2ban-client status sshd`; von aussen 22/80/443 offen, ein
willkürlicher vierter Port zu; Healthcheck weiterhin grün.

### - [ ] 3. Einladungslink im Dialog statt per Mail

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

### - [ ] 4. Import der Alt-Exporte (Excel)

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
