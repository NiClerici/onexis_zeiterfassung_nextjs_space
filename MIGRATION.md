# MIGRATION.md — Vom internen Tool zum verkaufbaren SaaS

Diese Datei ist Arbeitsplan **und** Fortschrittsstand. Sie ist die einzige Quelle
der Wahrheit für den Loop. Gleiche Regeln wie BUGS.md.

## Regeln für jede Iteration

1. Nimm den **ersten** Punkt, dessen Box nicht abgehakt ist.
2. Behebe ihn **vollständig** — keine Teilstände.
3. Danach in dieser Reihenfolge:
   - `npx prisma generate` (sonst falsche Typecheck-Fehler)
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - Bei DB-Änderungen: `npx prisma migrate dev` mit sprechendem Namen
   - Bei UI-relevanten Änderungen: Browser-Verifikation wie in BUILD.md Schritt 4–6
   - `git add -A && git commit` mit aussagekräftiger Nachricht
4. Erst dann die Box abhaken.
5. **Blockiert?** Grund als `> BLOCKER: …` unter den Punkt schreiben und aufhören.
6. Alle Boxen abgehakt → Loop beenden.

**Kontext:** Next.js 14 App Router + Prisma + PostgreSQL + NextAuth. Bestehende
App ist Single-User und läuft korrekt. Ziel ist ein mandantenfähiges SaaS für
Schweizer KMU, verkauft an Dienstleister (Ingenieur-/Architekturbüros, Agenturen,
Treuhänder) mit 5–50 Mitarbeitenden.

**Nicht anfassen ohne Auftrag:** `lib/calc.ts` ist verifiziert korrekt (20 Tests
grün, Referenzwerte stimmen). Änderungen daran nur, wo ein Punkt es explizit
verlangt, und immer mit Test dazu.

**Referenzwerte, die nach JEDEM Punkt noch stimmen müssen** (Profil 40h, 60%,
25 Ferientage, Start 01.04.2026, Stichtag 12.08.2026):
- Sollstunden/Tag = 4.8
- Soll August bis 12.08. = 38.4, Soll August gesamt = 100.8
- Ferienanspruch 2026 = 18.8

---

## Punkte

### - [x] 1. Bug: feriensaldo ignoriert Pensumsänderungen

`lib/calc.ts`, Funktion `feriensaldo()`: ruft `sollStundenTag(d, profil, [])` mit
leerem changes-Array auf. Nach einem Pensumswechsel wird das Tagessoll für die
Umrechnung Stunden → Ferientage falsch berechnet, damit auch bezogen/geplant/offen.

**Fix:** `changes: PensumChangeInput[]` zu `FeriensaldoInput` hinzufügen und an
`sollStundenTag` durchreichen. Alle Aufrufer anpassen (grep nach `feriensaldo(`).

**Test dazu:** Nutzer mit Pensumswechsel 100% → 60% per 01.09., je ein Ferientag
davor und danach; beide müssen als exakt 1.0 Tag zählen, nicht als 0.6 bzw. 1.67.

**Zusätzlich mitgefixt — derselbe Fehler eine Ebene höher:** `buildProfil()` in
`app/api/analytics/route.ts` und `app/api/export/route.ts` (sowie der inline
gebaute `Profil` in `app/(app)/calendar/page.tsx`) füttert `lib/calc.ts` mit
`user.pensum` / `user.weeklyHours` — das sind die **aktuellen** Werte.
`pensumAt()` benutzt `Profil` aber als Fallback für Daten **vor** der ersten
`PensumChange`, braucht dort also die **historische Basis**.
`app/api/pensum-changes/route.ts` überschreibt `user.pensum` bei jeder Änderung
mit dem neuesten Wert und sichert die Basis nach `basePensum` /
`baseWeeklyHours`. Folge ohne Fix: nach einer Pensumsänderung wird das Soll
**aller** früheren Tage rückwirkend zum neuen Pensum gerechnet — und das in
diesem Punkt geforderte Testszenario stimmt zwar in der reinen Funktion, aber
nicht über die API. Muster für den Fix existiert bereits korrekt in
`app/api/time-entries/bulk-vacation/route.ts` (`basePensum ?? pensum`).

**Ergebnis:** `changes: PensumChangeInput[]` zu `FeriensaldoInput` ergänzt
(bewusst **required**, nicht optional — dadurch fängt `tsc --noEmit` jeden
vergessenen Aufrufer, statt still auf das alte Verhalten zurückzufallen; genau
das hat einen vierten Aufrufer in `lib/calc.test.ts` aufgedeckt, den grep nach
`feriensaldo(` in den Produktionsdateien nicht gezeigt hätte) und an
`sollStundenTag` durchgereicht. Beide Produktions-Aufrufer
(`analytics/route.ts`, `export/route.ts`) hatten `changes` bereits im Scope.

`buildProfil` in beiden Routen und die inline-Konstruktion im Kalender auf
`basePensum ?? pensum` bzw. `baseWeeklyHours ?? weeklyHours` umgestellt.
`/api/profile` lieferte `basePensum`/`baseWeeklyHours` bereits mit — keine
API-Änderung nötig, nur das Client-State-Interface im Kalender erweitert.
`currentDailyRate` in `analytics/route.ts` (Feiertags-Karte) bewusst auf
`user.pensum`/`user.weeklyHours` umgestellt, damit diese eine Stelle weiterhin
mit dem **aktuellen** Tarif rechnet und ihr Verhalten unverändert bleibt.

Drei neue Tests in `lib/calc.test.ts` (Reduktion 100→60 %, Erhöhung 60→100 %,
und `geplant` nach heute). Vor dem Fix schlagen alle drei fehl, jeweils mit
exakt dem in diesem Punkt vorhergesagten Wert (`expected 0.6 to be 1`) —
verifiziert durch temporäres Zurücksetzen der Änderung. 23 Tests grün, die vier
Referenzwerte unverändert.

Browser-Verifikation (Playwright, Login über die echte UI): Pensumsänderung
100 % → 60 % per 10.09.2026 angelegt, danach je ein Ferientag am 01.09. (vor)
und 15.09. (nach dem Wechsel) über `bulk-vacation`. `bulk-vacation` schreibt
korrekt `hours=8` bzw. `hours=4.8`; Feriensaldo weist beide als je 1.0 Tag aus
(`plannedDays: 2`, ohne Fix 1.6) — sowohl über `/api/analytics` als auch im
gerenderten Analytics-Block („Geplant | 2"). Juni-Soll blieb nach der
Pensumsänderung bei 176h und fiel **nicht** rückwirkend auf 105.6h
(buildProfil-Fix). Export liefert weiterhin ein gültiges xlsx. Keine
Konsolen-/Serverfehler. Testdaten aufgeräumt und DB-Ausgangszustand
gegengeprüft.

---

### - [ ] 2. Auth: E-Mail + Passwort statt Vorname + Code

`lib/auth-options.ts`, `authorize()`: der Code-Login lädt per `findMany` alle
Nutzer mit passendem Vornamen und nimmt den ersten, dessen vierstelliger Code
passt. Sobald mehrere Organisationen im System sind, ist das ein
Account-Takeover-Vektor — gleicher Vorname plus zufällig gleicher Code genügt.

**Fix:**
- Code-Login-Zweig ersatzlos entfernen. Nur noch E-Mail + Passwort, `findUnique`
  auf die E-Mail, `bcrypt.compare` gegen `password`.
- Passwortregeln: mindestens 10 Zeichen, gegen die Top-1000-Passwortliste prüfen.
- Rate-Limiting auf `/api/auth/*`: max. 10 Fehlversuche pro E-Mail und IP in
  15 Minuten, danach 15 Minuten Sperre. In der DB (Tabelle `LoginAttempt`), nicht
  im Speicher — die App läuft potenziell mehrfach.
- `User.code` und der ganze `/api/auth/forgot-code`-Flow inklusive
  `SecurityQuestion`-Modell entfallen. Ersetzt durch Passwort-Reset per E-Mail
  mit signiertem, einmal verwendbarem Token (60 Minuten gültig, Tabelle
  `PasswordResetToken`, Token nur als Hash speichern).
- Mailversand über eine `lib/mail.ts`-Abstraktion mit SMTP-Config aus ENV.
  **Kein US-Dienst** (kein SendGrid, Postmark, Resend) — der Kunde kauft
  Schweizer Datenhaltung. Default: Infomaniak-SMTP.
- Bestehende Nutzer: Migration setzt ein Flag `mustSetPassword`, beim ersten
  Login wird zum Setzen gezwungen. `/(auth)/login` und `/(auth)/forgot-code`
  entsprechend umbauen.

---

### - [ ] 3. Mandantenfähigkeit: Organization + Membership

Das ist der grösste Punkt. Aktuell hängt alles an `userId`; `Customer` sogar
pro Nutzer statt pro Firma. Arbeite ihn in genau dieser Reihenfolge ab und
committe nach jedem Unterpunkt.

**3a. Schema.** Neue Modelle:

```
Organization: id, name, slug (unique), plan (trial|starter|pro),
  trialEndsAt, maxWeeklyHours (45|50, default 45), createdAt

Membership: id, orgId, userId, role (owner|admin|manager|member),
  managerId (nullable, self-relation), status (aktiv|inaktiv),
  entryDate, exitDate (nullable)
  @@unique([orgId, userId])
```

Alle bestehenden Modelle bekommen `orgId` mit Index:
`TimeEntry`, `Customer`, `PensumChange`, `OvertimePayout`.

`Customer` wandert von `userId` auf `orgId` — Unique-Constraint wird
`@@unique([orgId, name])`. Die Arbeitseinstellungen (weeklyHours, pensum,
vacationDays, startDate, stdHoursMon–Sun, baseWeeklyHours, basePensum) gehören
fachlich zur Anstellung, nicht zur Person: verschiebe sie von `User` nach
`Membership`. `User` behält nur Identität (email, password, firstName, lastName,
language) — ein Mensch kann später in zwei Organisationen sein.

**3b. Datenmigration.** Schreibe eine echte SQL-Migration, die bestehende Daten
nicht verliert: eine Organisation „ONEXIS" anlegen, alle bestehenden Nutzer als
Membership dort einhängen (der erste als `owner`, Rest `member`), Arbeits-
einstellungen von User nach Membership kopieren, `orgId` auf allen Datensätzen
setzen, Customer-Duplikate über gleiche Namen zusammenführen und die TimeEntries
umhängen. Erst danach die alten Spalten droppen. Vorher/nachher-Zählungen in der
Migration als Kommentar dokumentieren.

**3c. Session und Zugriffshelfer.** `orgId` und `role` ins NextAuth-JWT und in
die Session. Dann ein Helfer `lib/access.ts`:

```ts
requireSession()                       // wirft 401
requireOrg()                           // liefert { userId, orgId, role }
requireRole('admin' | 'manager' | ...) // wirft 403
scopeToOrg(where)                      // hängt orgId an jedes Prisma-where
canSeeUser(targetUserId)               // member: nur self; manager: Team; admin: alle
```

**3d. Alle 14 API-Routen umstellen.** Jede Query in `app/api/**/route.ts` muss
über `orgId` gefiltert sein, jeder Zugriff auf fremde `userId` über `canSeeUser`
geprüft. Kein `prisma.*.findMany` ohne `orgId` im where — das gilt auch für
Aggregationen und Counts.

**3e. Isolationstests.** Neue Testdatei `lib/access.test.ts` plus API-Level-Tests:
zwei Organisationen mit je zwei Nutzern seeden, dann verifizieren, dass ein
Nutzer aus Org A über **keinen** Endpunkt Daten aus Org B lesen, ändern oder
löschen kann — auch nicht durch Mitgeben fremder IDs im Body, in Query-Params
oder über Relationen (z.B. TimeEntry mit customerId aus der fremden Org anlegen).
Dieser Punkt gilt erst als erledigt, wenn diese Tests existieren und grün sind.

**3f. Seed.** `scripts/seed.ts` erzeugt zwei Organisationen mit je mehreren
Rollen, damit Mandantentrennung real klickbar ist.

---

### - [ ] 4. Onboarding: Registrierung, Einladungen, Rollen-UI

- `/register` legt Nutzer **und** Organisation an, Registrierender wird `owner`,
  `trialEndsAt` = heute + 14 Tage.
- `/api/invitations`: admin lädt per E-Mail ein, Token-Link, Eingeladener setzt
  Passwort und landet als `member` in der Organisation. Tabelle `Invitation`
  (Token gehasht, 7 Tage gültig, einmal verwendbar).
- `/admin/team`: Mitgliederliste, Rolle ändern, deaktivieren, Ein- und
  Austrittsdatum, Arbeitseinstellungen und Pensumsänderungen pro Person.
- Austrittsdatum muss in `sollStundenTag` wirken: nach `exitDate` ist das
  Tagessoll 0 (analog zum bestehenden Verhalten vor `startDate`). Test dazu.

---

### - [ ] 5. Projekte als Entität statt Freitext

`TimeEntry.projekt` ist ein String — damit gibt es keine Budgets und keine
Stundensätze, und genau das ist das Verkaufsargument.

```
Project: id, orgId, customerId, name, hourlyRate (nullable),
  budgetHours (nullable), active
  @@unique([orgId, customerId, name])
```

`Customer` bekommt `hourlyRate` (nullable) als Fallback. `TimeEntry` bekommt
`projectId` (nullable FK) und `billable Boolean` — beim Anlegen aus
Projekt/Kunde vorbelegt, im Tagesdialog überschreibbar. Der bisherige
`projekt`-String wird migriert: bestehende Werte je Organisation zu Projekten
zusammenfassen und verknüpfen, Spalte danach droppen.

`lib/calc.ts`: `kennzahlen()` nutzt für `kundenstunden` künftig
`eintrag.billable` statt der Kunden-Lookup-Liste. Bestehende Tests anpassen,
Referenzwerte müssen gleich bleiben.

---

### - [ ] 6. Compliance nach Arbeitsgesetz

**6a. Überzeit von Überstunden trennen.** `kennzahlen()` liefert heute
`ueberzeit = ist − soll − payouts` — das sind fachlich **Überstunden**
(über der vertraglichen Arbeitszeit, Art. 321c OR). Benenne das Feld in
`ueberstunden` um und ergänze ein echtes `ueberzeit`: Summe der Wochenanteile
über der gesetzlichen Höchstarbeitszeit (`Organization.maxWeeklyHours`, 45 oder
50 Stunden, Art. 12/13 ArG), kalenderwochenweise gerechnet. Beide Werte
getrennt in Analytics und Export ausweisen. Tests für beide.

**6b. Audit-Trail und Soft-Delete.** Neue Tabelle `TimeEntryAudit`
(entryId, orgId, changedBy, changedAt, field, oldValue, newValue). Jede
Änderung und Löschung eines TimeEntry protokollieren. `TimeEntry.deletedAt`
statt Hard-Delete; alle Queries filtern auf `deletedAt: null`. Ohne das ist
die gesetzliche Aufbewahrungspflicht von 5 Jahren nicht erfüllt und der Export
bei einer Kontrolle durch das Arbeitsinspektorat wertlos.

**6c. Feiertage.** Tabelle `Holiday` (orgId, date, name, canton nullable,
halfDay). Schweizer Basissatz plus kantonale Feiertage als Seed, pro
Organisation auswählbar und ergänzbar. `sollStundenTag` gibt an ganzen
Feiertagen 0 zurück, an Halbtagen die Hälfte — `Holiday[]` als zusätzlicher
Parameter. Tests inklusive Karfreitag/Ostermontag (beweglich) und eines
kantonalen Feiertags.

**6d. Pausen- und Ruhezeitprüfung.** Reine Funktion `pruefeCompliance(eintraege
eines Tages, vortag)` in `lib/compliance.ts`, die Verstösse als Liste liefert:
Pause unter 15 Minuten bei über 5.5h, unter 30 Minuten bei über 7h, unter
60 Minuten bei über 9h; Tagesarbeitszeit über der Höchstgrenze; Ruhezeit unter
11 Stunden zum Vortag; Sonntags- oder Nachtarbeit ohne Markierung. Im Kalender
als nicht-blockierende Warnung am Tag anzeigen. Vollständig getestet.

**6e. Monatsabschluss.** Tabelle `MonthLock` (orgId, userId, year, month,
lockedAt, lockedBy). Gesperrte Monate sind für `member` read-only; `admin` kann
entsperren, was im Audit-Trail landet.

---

### - [ ] 7. Exporte

- Bestehenden Excel-Export auf Organisationsebene erweitern: pro Person oder
  gesamte Organisation, Zeitraum frei wählbar.
- **Neu: ArG-Kontrollexport.** Eine prüffähige Tabelle mit allen nach
  Art. 73 ArGV 1 verlangten Angaben — Beginn und Ende der täglichen Arbeitszeit
  mit Uhrzeit, Pausen ab einer halben Stunde mit Lage und Dauer, wöchentliche
  Arbeitszeit, Überzeit separat, Ruhetage, Nacht- und Sonntagsarbeit. Das ist
  ein Verkaufsargument, kein Nice-to-have.
- **Neu: Lohnexport CSV** — Stunden, Absenzen nach Typ, Überstunden pro Person
  und Monat, neutral formatiert zur Übernahme in Swissdec-zertifizierte
  Lohnprogramme. Keine eigene Swissdec-Zertifizierung anstreben.

---

### - [ ] 8. Teamsicht — der eigentliche USP

Neue Seite `/team` für `admin` und `manager` (Manager sieht nur sein Team):

- Tabelle aller Mitarbeitenden: Pensum, Soll, Ist, Saldo, **Verrechnungsgrad**,
  Feriensaldo. Sortier- und filterbar, Excel-Export.
- Auslastungs-Heatmap: Mitarbeitende × Kalenderwochen, eingefärbt nach
  Verrechnungsgrad.
- Kunden- und Projektsicht: Stunden je Kunde und Projekt, Budget gegen
  verbraucht, Umsatz aus den Stundensätzen, überzogene Budgets hervorgehoben.
- Prognose: geplante Auslastung der kommenden Wochen aus vorerfassten Einträgen —
  wer ist über- oder unterbucht.

Die Kennzahlen kommen aus `lib/calc.ts`, aggregiert über mehrere Personen. Neue
reine Funktion `teamKennzahlen()` mit Tests, keine Rechenlogik in Komponenten
oder Routen.

---

### - [ ] 9. Absenzen mit Genehmigung

Tabelle `AbsenceRequest` (orgId, userId, from, to, type, status, decidedBy,
decidedAt, comment). Member stellt Antrag, Manager oder Admin genehmigt.
Bei Genehmigung werden die TimeEntries automatisch erzeugt (bestehende
`bulk-vacation`-Logik wiederverwenden). Team-Kalender mit Abwesenheiten und
Warnung bei zu vielen gleichzeitig Abwesenden.

---

### - [ ] 10. Aufräumen und Sicherheit

- `next` auf eine gepatchte Version aktualisieren (14.2.28 hat eine bekannte
  Sicherheitslücke). Danach vollen Regressionspass.
- Doppelte Abhängigkeiten entfernen: von `plotly.js` / `react-plotly.js` /
  `chart.js` / `react-chartjs-2` / `recharts` bleibt **nur recharts**;
  `mapbox-gl` fliegt raus (wird nirgends gebraucht); von `formik` + `yup` +
  `react-hook-form` + `zod` bleiben **react-hook-form + zod**; von `jotai` +
  `zustand` + `swr` + `@tanstack/react-query` bleibt **react-query**.
  Jeweils erst per grep prüfen, wo tatsächlich verwendet, dann migrieren.
- `browserslist` auf `["last 2 versions", "> 0.5%", "not dead"]` — kein IE 11.
- Security-Header in `next.config.js` (CSP, HSTS, X-Frame-Options).
- **Keine Drittdienste ausserhalb der Schweiz**: Fonts selbst hosten statt
  Google-CDN, kein US-Analytics, kein US-Error-Tracking. Das ist Teil des
  Produktversprechens und darf nicht durch bequeme Defaults unterlaufen werden.

---

### - [ ] 11. Deployment auf Schweizer Infrastruktur

- `Dockerfile` (Next.js standalone output) und `docker-compose.yml` mit App,
  PostgreSQL und Caddy als Reverse Proxy mit automatischem TLS.
- `deploy/README.md`: Schritt-für-Schritt-Anleitung für eine einzelne VM bei
  cloudscale.ch oder Infomaniak Public Cloud, inklusive tägliches `pg_dump`
  in S3-kompatiblen Schweizer Objektspeicher und getesteter Restore-Anleitung.
- ENV-Dokumentation vollständig in `.env.example`.
- Healthcheck-Endpunkt `/api/health` (DB-Verbindung prüfen).

---

### - [ ] 12. Verkaufsfähigkeit

- `/admin/legal`: AVV (Auftragsbearbeitungsvertrag) und
  Bearbeitungsverzeichnis-Vorlage als Download, Datenschutzerklärung mit
  explizit genanntem Hosting-Standort.
- Vollständiger Organisationsexport (JSON + Excel) und Löschung auf Knopfdruck,
  mit Hinweis auf die gesetzliche Aufbewahrungspflicht.
- `lib/billing.ts` als Interface (`BillingProvider`) mit Plan-, Nutzerlimiten-
  und Trial-Logik. Implementierung vorerst manuell — aber Trial-Ablauf muss
  wirken: nach `trialEndsAt` ist die Organisation read-only.

---

## Notizen des Loops

_(Hier trägt der Loop Blocker, Entscheidungen und Auffälligkeiten ein.)_

- Vorbereitung: MIGRATION.md existierte im Repo noch nicht (nur als Text
  geliefert) und wurde nach dem Muster von BUGS.md angelegt.
- Punkt 1: Bei der Recherche kam ein zweiter Bug derselben Fehlerklasse eine
  Ebene höher dazu (`buildProfil` füttert die *aktuellen* statt der
  *historischen* Pensumswerte in `lib/calc.ts`). Bewusst in diesem Punkt
  mitgefixt statt vertagt, weil das in Punkt 1 geforderte Testszenario sonst
  zwar in der reinen Funktion, aber nicht über die API stimmt. Details unter
  **Ergebnis:** beim Punkt selbst.
- Punkt 1: `changes` bewusst als **required** Feld ergänzt statt optional. Ein
  optionales Feld mit Default `[]` hätte vergessene Aufrufer still auf das
  alte, falsche Verhalten zurückfallen lassen; so hat der Typecheck sie
  gefunden — konkret einen vierten Aufrufer in `lib/calc.test.ts`, den ein
  grep über die Produktionsdateien nicht gezeigt hätte.
- Punkt 1, Auffälligkeit für später (kein Blocker): `.env` enthält kein
  `NEXTAUTH_URL`. Solange der Dev-Server auf Port 3000 läuft, fällt das nicht
  auf; auf einem abweichenden Port (z.B. wenn 3000 belegt ist und Next auf
  3001 ausweicht) warnt NextAuth und die Anmeldung verhält sich unzuverlässig.
  Für die Verifikation hier mit explizit gesetztem `NEXTAUTH_URL` gestartet.
  Gehört zur ENV-Dokumentation in Punkt 11.
- Punkt 1, Fehler beim Verifizieren (behoben): Ein erster Anlauf des
  Verifikationsskripts wählte den 15.06./15.07.2026 als Ferientage. An beiden
  Tagen existierten bereits `arbeit`-Einträge, `bulk-vacation` übersprang sie
  darum korrekt — das Skript fand aber die bestehenden Einträge und löschte
  sie beim Aufräumen. Beide Einträge wurden aus dem einheitlichen Muster der
  Nachbartage (08:00–16:30, 30min Pause, `hours` null; 42 von 43 Einträgen im
  Zeitraum sind identisch) wiederhergestellt und die Lückenfreiheit aller
  Werktage vom 01.06.–31.08.2026 per SQL gegengeprüft. Das Skript arbeitet
  seither nur noch auf nachweislich leeren Tagen, bricht ab wenn der Zieltag
  belegt ist oder `bulk-vacation` nicht `created: 1` meldet, und löscht
  ausschliesslich selbst erzeugte IDs.
