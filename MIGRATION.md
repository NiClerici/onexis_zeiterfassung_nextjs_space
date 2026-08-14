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

### - [x] 2. Auth: E-Mail + Passwort statt Vorname + Code

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

**Ergebnis:** Vollständig umgesetzt.

- `lib/auth-options.ts`: Code-Zweig entfernt, nur noch `findUnique` auf
  E-Mail + `bcrypt.compare`. Rate-Limiting (`lib/rate-limit.ts`, Tabelle
  `LoginAttempt`, DB-basiert nicht in-memory) vor dem Passwortvergleich, 10
  Fehlversuche pro E-Mail UND IP in einem rollierenden 15-Minuten-Fenster.
  IP kommt aus `x-forwarded-for`/`x-real-ip` (Reverse-Proxy-Header, passend
  zum in Punkt 11 geplanten Caddy-Setup).
- Passwortregeln (`lib/password-policy.ts`): mindestens 10 Zeichen +
  Blockliste häufiger Passwörter (`lib/common-passwords.ts`). Ehrlich
  dokumentiert: keine verifizierte kanonische Top-1000-Liste (aus dieser
  Umgebung nicht abrufbar), sondern eine kuratierte Basisliste bekannter
  Passwörter/Muster kombiniert mit gängigen Zahlen-Suffixen, > 1000 Einträge.
  Für den Produktivbetrieb (Punkt 12) sollte das gegen einen echten
  Pwned-Passwords-Abgleich ersetzt werden — als Notiz im Code hinterlegt.
- `User.code`, `SecurityQuestion`-Modell und der ganze
  `/api/auth/forgot-code`-Flow entfernt. Ersetzt durch
  `/api/auth/forgot-password` + `/api/auth/reset-password` mit
  `PasswordResetToken` (SHA-256-Hash gespeichert, 60 Min gültig, einmal
  verwendbar — bei Verwendung werden auch alle anderen offenen Tokens des
  Nutzers entwertet). `/api/auth/forgot-password` antwortet jetzt bewusst
  **immer identisch**, egal ob die E-Mail existiert — behebt nebenbei das
  User-Enumeration-Leak, das der alte Flow in Schritt 1 hatte (nicht in der
  ursprünglichen Punktbeschreibung verlangt, aber dieselbe Fehlerklasse wie
  der in BUGS.md #4 bereits gefixte Account-Takeover-Bug in genau diesem Flow).
- `lib/mail.ts`: SMTP über `nodemailer` (neue Abhängigkeit, `npm install
  --legacy-peer-deps` wegen eines vorbestehenden, nicht mit dieser Änderung
  zusammenhängenden Peer-Dependency-Konflikts zwischen
  `eslint-config-next` und dem gepinnten `@typescript-eslint/parser`). Ohne
  konfiguriertes SMTP (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`) wird die
  Mail nur ins Server-Log geschrieben, nie über die API-Response
  zurückgegeben — der Token bleibt damit auch lokal "nur per Mail" erreichbar.
  `.env.example` um SMTP-Variablen ergänzt (Default Infomaniak, kein
  US-Dienst).
- `mustSetPassword` auf `User`, im JWT/Session exponiert. Neue Seite
  `/set-password` (unter `app/(app)/`, damit sie Session-geschützt ist) und
  ein Gate in `app/(app)/layout.tsx`: leitet dorthin um, bis das neue
  Passwort gesetzt ist. Nutzt denselben Endpunkt wie die reguläre
  Passwortänderung (`PATCH /api/profile`) und aktualisiert danach das JWT
  ohne Neu-Login über `useSession().update()`.
- UI umgebaut: `/login` (E-Mail+Passwort), `/register` (E-Mail+Passwort statt
  Code+Sicherheitsfragen), `/forgot-password` (ersetzt `/forgot-code`, ein
  Schritt statt drei), `/reset-password` (neu, Link aus der Mail).
  Profilseite: Sicherheitsfragen-Block entfernt, Code-Ändern-Block zu
  Passwort-Ändern-Block (mit Bestätigungsfeld). `lib/i18n.tsx` entsprechend
  bereinigt (alle `sq.*`- und Code-Keys entfernt, neue Keys für Reset/
  Set-Password ergänzt). `scripts/seed.ts` erzeugt jetzt einen Nutzer mit
  E-Mail+Passwort, kein `code`/`SecurityQuestion` mehr.

**Migration — vor destruktivem Schritt angehalten, wie mit dem Nutzer
abgestimmt:** `prisma migrate dev --create-only` scheiterte non-interaktiv;
stattdessen SQL per `prisma migrate diff` (non-interaktiv, rührt die DB nicht
an) erzeugt und die Migration von Hand als Datei angelegt
(`20260813084507_auth_email_password`). Dabei eine Lücke im reinen Schema-Diff
korrigiert: `ADD COLUMN "mustSetPassword" ... DEFAULT false` hätte den
Spalten-Default auch auf **bestehende** Zeilen backfillen lassen — per Hand ein
`UPDATE "User" SET "mustSetPassword" = true;` direkt danach ergänzt, damit nur
Bestandsnutzer (nicht künftige Neuanmeldungen) beim nächsten Login zum
Passwort-Setzen gezwungen werden. SQL dem Nutzer vorgelegt (droppt `User.code`
und die `SecurityQuestion`-Tabelle, damals 1 bzw. 2 Zeilen betroffen), nach
Freigabe mit `npx prisma migrate deploy` angewendet und per SQL gegengeprüft
(`code`-Spalte weg, `SecurityQuestion`-Tabelle weg, `mustSetPassword: true`
für den Bestandsnutzer).

**Verifiziert (Playwright, Login über die echte UI, mehrere Skripte):**
Login mit dem alten Code als Passwort (`"1234"` — das ist tatsächlich der
Wert im `password`-Feld des Bestandsnutzers, nicht `"johndoe123"` aus einer
älteren Version von `scripts/seed.ts`) leitet korrekt zu `/set-password` um;
dort gesetztes neues Passwort greift ohne erneuten Login; zweiter Login mit
dem neuen Passwort landet direkt auf `/calendar`. Signup mit zu kurzem bzw.
häufigem Passwort liefert `400`, mit gültigem `200` und sofortigem Login ohne
`mustSetPassword`-Zwang. 10 Fehlversuche sperren auch ein anschliessend
korrektes Passwort. `forgot-password` liefert für existierende und
nicht-existierende E-Mail dieselbe Antwort; der Link aus dem Server-Log
funktioniert, ist danach nicht wiederverwendbar, und das damit gesetzte
Passwort loggt ein. Profilseite zeigt keinen Sicherheitsfragen-Block mehr.
Falsches Passwort zeigt eine Fehlermeldung in der echten UI.

**Zwei Bugs während der Verifikation gefunden und behoben (nicht Teil des
ursprünglichen Punkts, aber direkt durch dessen Code verursacht):**
1. `app/api/auth/forgot-password/route.ts`: die generische Antwort war ein
   Modul-Singleton-`NextResponse` — deren Body ist ein Web-Streams-Body und
   nach dem ersten Versand verbraucht. Der zweite Aufruf (egal ob dieselbe
   oder eine andere E-Mail) lieferte einen leeren Body statt der JSON-Nachricht.
   Fix: pro Aufruf eine frische `NextResponse.json(...)` erzeugen.
2. `app/(app)/layout.tsx`: `router.replace(...)` wurde direkt im Render-Pfad
   aufgerufen (bereits vor diesem Punkt so für den unauthenticated-Fall
   vorhanden, durch das neue `mustSetPassword`-Gate aber erstmals in einem
   echten Klickpfad ausgelöst) — React-Warnung "Cannot update a component
   while rendering a different component". Beide Redirects (unauthenticated
   und mustSetPassword) in einen `useEffect` verschoben, Render gibt nur noch
   `null` zurück, bis der Effect navigiert.

**Zusätzlich entfernt (in Scope, da direkt Teil der Auth-Härtung):**
`app/api/auth/login/route.ts` — ein zweiter, unauthenticateder Credential-
Check-Endpunkt, von der UI nirgends aufgerufen, der ohne Rate-Limiting einen
zweiten Weg geboten hätte, Passwörter zu erraten.

---

### - [x] 3. Mandantenfähigkeit: Organization + Membership

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

**Ergebnis:** Vollständig umgesetzt, in sechs Commits (einer je Unterpunkt,
plus ein siebter für den abschliessenden Drop). Abweichung von der
wörtlichen Reihenfolge, bewusst und dokumentiert: 3b (Datenmigration) wurde
in zwei Migrationen aufgeteilt statt einer.

- **Additive Migration** (`20260813124101_org_membership_additive`, Teil
  von 3a): Organization + Membership angelegt, orgId **nullable** an
  TimeEntry/Customer/PensumChange/OvertimePayout ergänzt, echte
  Datenmigration statt reinem Schema-Diff — Organisation „ONEXIS" angelegt,
  jeder Bestandsnutzer als Membership eingehängt (erster = owner, Rest =
  member), Arbeitseinstellungen kopiert, orgId auf allen Bestandsdaten
  gesetzt, gleichnamige Customer je Org zusammengeführt. Kein Datenverlust,
  alte Spalten blieben bestehen — deshalb ohne Rückfrage direkt angewendet.
- **3c, 3d, 3e, 3f** wie im Punkt beschrieben umgesetzt (Details in den
  einzelnen Commit-Nachrichten `MIGRATION #3a` bis `#3f`).
- **Abschliessende Migration** (`20260813130427_org_membership_cleanup`):
  erst NACH 3d (alle Routen umgestellt) und 3e (Isolationstests grün)
  wurden die jetzt redundanten Spalten gedroppt — `Customer.userId` sowie
  `User.weeklyHours/pensum/baseWeeklyHours/basePensum/vacationDays/
  startDate/stdHoursMon–Sun/role` — und orgId überall auf `NOT NULL`
  gesetzt (vorher per SQL verifiziert: 0 Zeilen mit `orgId IS NULL`). Diese
  eine Migration ist destruktiv; wie mit dem Nutzer abgestimmt wurde sie
  als Datei vorgelegt, nicht sofort ausgeführt, und erst nach expliziter
  Freigabe mit `prisma migrate deploy` angewendet.
- **Grund für die Aufteilung:** Ein einziger Migrationsschritt, der sofort
  droppt, hätte den ganzen Punkt zu einem einzigen unteilbaren, riskanten
  Commit gemacht — genau das, was „committe nach jedem Unterpunkt" verhindern
  soll. Die additive Migration ist ohne Risiko sofort anwendbar; das
  eigentliche Droppen ist der einzige Schritt, der wirklich Rückfrage
  verdient, und wird jetzt auch nicht mehr durch fünf harmlose Unterpunkte
  verzögert.
- **Zwei fachliche Verschiebungen, kein Implementierungsdetail:** Kunden
  gehören jetzt der Organisation statt dem einzelnen Mitarbeitenden (alle
  Mitglieder sehen dieselbe Kundenliste — Voraussetzung für Punkt 5/8).
  `User.role` wurde ersatzlos entfernt (durch `Membership.role` abgelöst;
  grep bestätigte vor dem Entfernen, dass es nirgends gelesen wurde).
- **Isolationstests:** 14 API-Level-Tests (`lib/api-isolation.test.ts`) +
  11 Einheitstests für `lib/access.ts` (`lib/access.test.ts`), macht
  25 neue Tests, 48 insgesamt grün. Darunter ein Härtetest mit einem
  Nutzer, der Mitglied in **beiden** Test-Organisationen ist — der einzige
  Fall, in dem `userId` allein nicht mehr zwischen Organisationen
  disambiguiert; zwei Sanity-Checks (orgId testweise aus einer Query
  entfernt) bestätigten, dass die Tests eine echte Regression fangen
  würden, bevor der Punkt als erledigt galt.
- **Browser-verifiziert** (Playwright, mehrere Durchläufe vor und nach der
  abschliessenden Migration): Bestandsnutzer John unverändert nutzbar
  (Profil, Kalender, Analytics — exakt dieselben Zahlen wie vor Punkt 3);
  zwei verschiedene Demo-Logins aus zwei verschiedenen Organisationen
  zeigen nachweislich unterschiedliche, nicht überlappende Kundendaten.

---

### - [x] 4. Onboarding: Registrierung, Einladungen, Rollen-UI

- `/register` legt Nutzer **und** Organisation an, Registrierender wird `owner`,
  `trialEndsAt` = heute + 14 Tage.
- `/api/invitations`: admin lädt per E-Mail ein, Token-Link, Eingeladener setzt
  Passwort und landet als `member` in der Organisation. Tabelle `Invitation`
  (Token gehasht, 7 Tage gültig, einmal verwendbar).
- `/admin/team`: Mitgliederliste, Rolle ändern, deaktivieren, Ein- und
  Austrittsdatum, Arbeitseinstellungen und Pensumsänderungen pro Person.
- Austrittsdatum muss in `sollStundenTag` wirken: nach `exitDate` ist das
  Tagessoll 0 (analog zum bestehenden Verhalten vor `startDate`). Test dazu.

**Ergebnis:** Vollständig umgesetzt, in vier Commits (4a–4d, je einer pro
Bullet-Punkt oben).

- **4a — Registrierung:** `/register` verlangt jetzt einen Firmennamen
  (Pflichtfeld, vorher fehlte er ganz — der registrierende Mensch selbst
  wurde fälschlich als Organisationsname verwendet) und leitet daraus den
  Slug ab. `trialEndsAt` (heute + 14 Tage) und `plan: "trial"` werden bei
  der Registrierung gesetzt — beide Felder lagen im Schema seit Punkt 3
  bereit, wurden aber nirgends befüllt. Neue Tabelle `Invitation`
  (additive Migration).
- **4b — Einladungen:** `/api/invitations` (GET/POST/DELETE, nur owner/
  admin) plus öffentliche Annahmeseite `/invite`. Token nur als SHA-256-
  Hash gespeichert (analog `PasswordResetToken`), 7 Tage gültig, einmal
  verwendbar; alte offene Einladungen an dieselbe E-Mail werden beim
  erneuten Einladen automatisch entwertet. Die Annahme behandelt zwei
  Fälle: eine neue Person setzt ein Passwort und wird direkt eingeloggt;
  eine Person mit bereits bestehendem Konto (das Datenmodell aus Punkt 3
  sieht das ausdrücklich vor) bekommt nur eine zusätzliche Membership ohne
  neues Passwort. `hashToken()`/`generateToken()` nach `lib/token.ts`
  extrahiert (dritter Verbraucher nach forgot-password/reset-password).
- **4c — `/admin/team`:** Mitgliederliste mit Rolle, Status, Vorgesetzte
  Person, Ein-/Austrittsdatum, aufklappbares Panel für Arbeitseinstellungen
  und Pensumsänderungs-Historie, plus das Einladungsformular aus 4b. Drei
  Schutzregeln gegen Rechteausweitung/Selbstsabotage: nur owner darf die
  owner-Rolle vergeben, der letzte owner kann nicht degradiert werden,
  niemand kann sich selbst deaktivieren und der letzte aktive owner nicht
  deaktiviert werden. "Deaktivieren" wirkt jetzt echt — `lib/auth-options.ts`
  wählt beim Login nur noch Memberships mit `status: "aktiv"`, ein
  deaktiviertes Mitglied bekommt beim nächsten Login keine `orgId` mehr und
  wird von `requireOrg()` aus der App ausgesperrt (bestehende Sessions
  bleiben bis zum JWT-Ablauf gültig — dokumentierte Grenze von
  JWT-Sessions, keine Server-seitige Invalidierung gebaut).
- **4d — exitDate:** `Profil.exitDate` bewusst als **required** Feld
  ergänzt (wie `changes` in Punkt 1) — der Typecheck fand dadurch alle drei
  Produktionsstellen und 17 Test-Fixtures automatisch. `sollStundenTag`
  liefert 0 für Tage nach `exitDate` (der Austrittstag selbst zählt noch,
  symmetrisch zu `startDate`). `feriensaldo()`s Anspruchsberechnung bewusst
  nicht angefasst — nicht Teil dieses Punktes, hätte mit den verifizierten
  Referenzwerten interagieren können.

**Verifiziert:** 53 Tests grün (28 in `calc.test.ts`, 5 davon neu für
`exitDate`; vor dem Fix wurden diese testweise rot verifiziert). Playwright
über echte Logins: Registrierung mit Firmenname erzeugt korrekte
Organisation mit `trialEndsAt` ~14 Tage in der Zukunft; kompletter
Einladungs-Flow (einladen → Vorschau → annehmen → Token nicht wiederverwendbar
→ widerrufen); alle drei Team-Schutzregeln lösen korrekt 400/403 aus;
Deaktivieren verhindert nachweislich den nächsten Login in der Organisation;
eine Pensumsänderung für ein anderes Mitglied über die Team-UI wirkt korrekt
auf dessen Membership; `exitDate`, über `/admin/team` gesetzt, senkt das
Soll eines Mitglieds für einen den Austritt umspannenden Zeitraum
nachweislich von 64h auf 32h — bei ausschliesslich über echte API-Aufrufe
verifizierten Werten, nicht nur in der reinen Funktion.

---

### - [x] 5. Projekte als Entität statt Freitext

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

**Ergebnis:** Vollständig umgesetzt, in fünf Commits (5a–5d, plus ein
fünfter für den abschliessenden Drop) — dieselbe zweigeteilte
Migrationsstrategie wie bei Punkt 3.

- **5a — Schema (additiv):** `Project` (customerId required, hourlyRate/
  budgetHours nullable, `@@unique([orgId,customerId,name])`),
  `Customer.hourlyRate` als Fallback, `TimeEntry.projectId`/`billable`
  ergänzt. Echte Datenmigration: bestehende `projekt`-Freitextwerte je
  (orgId, customerId, projekt) zu einem Project zusammengefasst und
  verknüpft, `billable` auf allen Zeilen aus dem bisher für kundenstunden
  verwendeten `Customer.billable`-Flag zurückgerechnet — Zeilen mit
  Freitext aber ohne customerId (generisch möglich, hier 0 Zeilen) können
  mangels der auf Project required customerId nicht automatisch migriert
  werden.
- **5b — `lib/calc.ts`:** `kennzahlen()` nutzt `eintrag.billable` direkt.
  `KundeInput`/`kunden` komplett aus `KennzahlenInput` entfernt statt nur
  ungenutzt liegen zu lassen — danach gab es dafür keinen
  Verwendungszweck mehr. `analytics/route.ts` verlor dadurch den
  kompletten Customer-Fetch, der nur für die jetzt überflüssige
  kunden-Liste existierte.
- **5c — API:** neue Route `/api/projects` (kein Rollen-Gate, analog zu
  `customers`). `time-entries` POST/PUT lösen `projectId`/`customerId`
  über einen gemeinsamen Helfer auf — ist `projectId` gesetzt, gewinnt
  dessen `customerId`, da `Project.customerId` required ist und die
  beiden Felder nie auseinanderlaufen dürfen; `billable` wird aus dem
  Kunden vorbelegt, bleibt aber überschreibbar.
- **5d — UI:** Freitext-„Projekt"-Feld im Tagesdialog durch eine Auswahl
  ersetzt (gefiltert auf aktive Projekte des gewählten Kunden) plus
  `billable`-Checkbox; Kunden-/Projektwechsel belegen `billable`
  automatisch vor. Profilseite: Kundenverwaltung um Stundensatz erweitert,
  neue Projektverwaltung-Karte strukturell analog zur Kundenverwaltung.
- **Abschliessende Migration:** `TimeEntry.projekt` gedroppt — vorher per
  grep verifiziert, dass keine Code-Stelle mehr darauf zugreift, und per
  SQL, dass 0 Zeilen Freitext ohne `projectId` hatten (kein Datenverlust).
  Wie mit dem Nutzer abgestimmt als Datei vorgelegt, erst nach expliziter
  Freigabe angewendet.
- **Bug bei der eigenen Verifikation gefunden und behoben:** ein erster,
  fehlgeschlagener Browser-Testlauf für 5c/5d navigierte wegen eines
  Off-by-one-Fehlers in der eigenen Testskript-Monatsnavigation nach
  Oktober statt September und legte dort einen Testeintrag an; die
  Aufräum-Logik dieses Laufs suchte gezielt nach dem September-Datum und
  fand den Oktober-Eintrag deshalb nicht — blieb bis zur Nachkontrolle vor
  der abschliessenden Migration als Karteileiche stehen. Per SQL
  identifiziert (Datum in der Zukunft, keine Kunden-/Projektzuordnung mehr
  durch `onDelete: SetNull`, nachdem der zugehörige Test-Kunde in einem
  späteren, erfolgreichen Lauf gelöscht wurde) und manuell entfernt.
- **Verifiziert:** 53 Tests grün (28 in `calc.test.ts`, inkl. des
  `billable`-basierten Verrechnungsgrad-Tests). Playwright über die echte
  UI, nicht nur API: Kunde mit Stundensatz und Projekt mit Stundensatz+
  Budget über die Profilseite angelegt, Tageseintrag über den echten
  Tagesdialog mit Kunde+Projekt-Auswahl erstellt — `billable` war danach
  nachweislich automatisch aktiviert, der gespeicherte Eintrag trägt in
  DB und API korrekt `projectId`, die aus dem Projekt abgeleitete
  `customerId` und `billable=true`. Nach der abschliessenden Migration:
  Kundenstunden/Verrechnungsgrad für den Bestandsnutzer unverändert,
  Export weiterhin gültig, Kalenderseite fehlerfrei.

---

### - [x] 6. Compliance nach Arbeitsgesetz

**6a. Überzeit von Überstunden trennen.** `kennzahlen()` liefert heute
`ueberzeit = ist − soll − payouts` — das sind fachlich **Überstunden**
(über der vertraglichen Arbeitszeit, Art. 321c OR). Benenne das Feld in
`ueberstunden` um und ergänze ein echtes `ueberzeit`: Summe der Wochenanteile
über der gesetzlichen Höchstarbeitszeit (`Organization.maxWeeklyHours`, 45 oder
50 Stunden, Art. 12/13 ArG), kalenderwochenweise gerechnet. Beide Werte
getrennt in Analytics und Export ausweisen. Tests für beide.

**Ergebnis:** `KennzahlenResult.ueberzeit` in `ueberstunden` umbenannt
(Art. 321c OR, unverändert `ist − soll − payoutSum`); neues Feld `ueberzeit`
ergänzt (Art. 12/13 ArG). Neuer privater Helper `montagDerWoche()` gruppiert
`typ="arbeit"`-Stunden nach Montag der Kalenderwoche (Mo–So-Konvention wie im
Kalender); für jede Woche, die `profil.maxWeeklyHours` überschreitet, wird der
Überschuss aufsummiert. Nur tatsächliche Arbeitszeit zählt — Absenzen sind
keine Arbeitszeit im Sinne des ArG. Bekannte Einschränkung (wie bei soll/ist):
nur Wochen(-anteile) innerhalb `[from, bisHeute]` fliessen ein, kein Nachladen
von Tagen ausserhalb des abgefragten Zeitraums.

`Profil` um `maxWeeklyHours` erweitert (required, nicht optional — damit
`tsc` jeden Aufrufer zwingt). Betroffene Stellen durchgereicht:
`app/api/analytics/route.ts` und `app/api/export/route.ts` (`buildProfil()`
liest jetzt `membership.org.maxWeeklyHours`, Membership-Query um
`include: { org: true }` ergänzt), `app/api/profile/route.ts` (liefert
`maxWeeklyHours` jetzt mit) und `app/(app)/calendar/page.tsx` (Client-State
+ `Profil`-Konstruktion erweitert). Beide API-Routen weisen `ueberstunden` und
`ueberzeit` getrennt aus (`netOvertime` bzw. neues Feld `weeklyOvertime`);
Excel-Export bekam eine eigene Zeile „Überzeit (> Xh/Woche)". i18n-Labels in
`lib/i18n.tsx` korrigiert: `analytics.overtime`/`analytics.netOvertime` hiessen
fälschlich „Überzeit" (waren aber Überstunden) — jetzt „Überstunden"/
„Überstunden (netto)"; neuer Key `analytics.weeklyOvertime` für den echten
ArG-Begriff. Analytics-UI (`app/(app)/analytics/page.tsx`) bekam eine eigene
KPI-Karte für die wöchentliche Überzeit.

Tests in `lib/calc.test.ts`: bestehender Test für Auszahlungsabzug auf
`ueberstunden` umbenannt plus eine Zusatzprüfung, dass eine unauffällige Woche
keine Überzeit erzeugt; vier neue Tests für die echte Überzeit (Woche über dem
Limit, Woche unter dem Limit, Absenzen zählen nicht, mehrere Wochen im
Zeitraum). Alle 13 bestehenden `Profil`-Testfixtures per Skript um
`maxWeeklyHours: 45` ergänzt.

Browser-verifiziert: Testdaten (5×10h in einer sonst leeren Woche,
manager@onexis.test, Mai 2026) direkt per SQL angelegt — Ziel der Verifikation
war die Anzeige-/Berechnungsschicht, nicht die (unveränderte)
Eintrags-Erfassung. `/analytics` zeigt „Überstunden −126.4h" und separat
„Überzeit 5.0h" (5 Werktage × 10h = 50h, 5h über dem 45h-Limit); Excel-Export
zeigt dieselben getrennten Werte in der Zusammenfassung. Keine Konsolenfehler.
Testdaten wieder gelöscht (Baseline 66 `TimeEntry`-Zeilen bestätigt
wiederhergestellt).

Keine Prisma-Migration nötig — `Organization.maxWeeklyHours` existierte
bereits seit Punkt 3a genau für diesen Zweck.

**6b. Audit-Trail und Soft-Delete.** Neue Tabelle `TimeEntryAudit`
(entryId, orgId, changedBy, changedAt, field, oldValue, newValue). Jede
Änderung und Löschung eines TimeEntry protokollieren. `TimeEntry.deletedAt`
statt Hard-Delete; alle Queries filtern auf `deletedAt: null`. Ohne das ist
die gesetzliche Aufbewahrungspflicht von 5 Jahren nicht erfüllt und der Export
bei einer Kontrolle durch das Arbeitsinspektorat wertlos.

**Ergebnis:** `TimeEntryAudit` genau wie beschrieben angelegt (entryId, orgId,
changedBy, changedAt, field, oldValue, newValue) — bewusst ohne Prisma-Relation
auf `TimeEntry`/`User` (gleiches Muster wie `Invitation.invitedByUserId`),
damit der Audit-Trail lesbar bleibt, auch wenn ein Account später gelöscht
wird. `TimeEntry.deletedAt` als nullable Spalte ergänzt. Reine additive
Migration (neue Tabelle + neue nullable Spalte) — direkt angewendet, keine
Rückfrage nötig (nur destruktive Schemaänderungen wie Spalten-Drops brauchen
laut Session-Vorgabe die explizite Freigabe).

Neues `lib/audit.ts` mit `diffTimeEntryFields()` als reine, Prisma-freie
Diff-Funktion (gleiches Trennungsprinzip wie `lib/calc.ts`) — vergleicht zwei
bereits final aufgelöste Feldzustände und liefert nur tatsächlich geänderte
Felder, Date-Felder werden dabei auf den UTC-Kalendertag reduziert. Bewusste
Scope-Entscheidung: protokolliert werden **Änderungen und Löschungen**, wie
im Punkt-Text gefordert — nicht Erstellungen (ein neu angelegter Eintrag hat
keinen "alten" Zustand, den ein field/oldValue/newValue-Schema sinnvoll
abbilden würde).

Verdrahtet in allen fünf Stellen, die TimeEntry mutieren oder lesen:
`app/api/time-entries/route.ts` (PUT diffed den vollständig aufgelösten
Zielzustand gegen `existing` und schreibt Audit-Zeilen in einer Transaktion
mit dem Update; DELETE setzt `deletedAt` statt zu löschen und schreibt eine
Audit-Zeile mit `field: "deletedAt"`; GET filtert `deletedAt: null`),
`app/api/time-entries/bulk-vacation/route.ts` und `bulk-apply/route.ts`
(beide von einem Array vorab gebauter `Prisma.PrismaPromise`-Operationen auf
eine interaktive `prisma.$transaction(async (tx) => …)` umgestellt, damit vor
jedem Update der Vorher-Zustand für den Diff bekannt ist — Neuanlagen bleiben
unauditiert, s.o.; Timeout auf 30s erhöht wegen bis zu 366 sequentiellen
Operationen), `app/api/analytics/route.ts` und `app/api/export/route.ts`
(beide TimeEntry-Queries um `deletedAt: null` ergänzt).

Tests: `lib/audit.test.ts` (8 Tests, reine Diff-Logik: keine Änderung, ein
Feld, mehrere Felder, null↔Wert, Datumsreduktion auf Kalendertag, echte
Datumsänderung, nicht-auditierte Felder werden ignoriert, boolean-Felder).
Neues `lib/time-entry-audit.test.ts` (7 Tests, Route-Ebene wie
`api-isolation.test.ts`: PUT erzeugt genau die geänderten Feld-Audit-Zeilen,
kein Audit bei echter Nicht-Änderung, mehrere Felder gleichzeitig, DELETE
setzt `deletedAt` statt Hard-Delete und protokolliert es, ein
soft-gelöschter Eintrag verschwindet aus GET, ein zweites DELETE auf denselben
Eintrag liefert 404 ohne Doppel-Audit, PUT auf einen soft-gelöschten Eintrag
liefert ebenfalls 404).

Browser-verifiziert (manager@onexis.test, Kalender, 20.05.2026 — bewusst über
den Monats-Picker statt Klick-Navigation angesteuert und der erreichte
Monat vor dem Klick auf den Tag verifiziert, siehe Lehre aus Punkt 5): Eintrag
über die UI angelegt, `bis`-Zeit bearbeitet und gespeichert, dann über den
Papierkorb-Button gelöscht. Direkter DB-Check danach bestätigte: Der Datensatz
existiert weiterhin (kein Hard-Delete) mit gesetztem `deletedAt`;
`TimeEntryAudit` enthält genau zwei Zeilen — eine für die `bis`-Änderung
(alt/neu korrekt) und eine für `deletedAt` (alt `null`, neu der Zeitstempel),
beide mit korrektem `changedBy`. Der Kalender zeigte den Tag danach korrekt
als leer ("Keine Einträge für diesen Tag"). Keine Konsolenfehler. Testdaten
(TimeEntry- und TimeEntryAudit-Zeile) danach vollständig per SQL entfernt
(Baseline 66 `TimeEntry`- und 0 `TimeEntryAudit`-Zeilen bestätigt).

**6c. Feiertage.** Tabelle `Holiday` (orgId, date, name, canton nullable,
halfDay). Schweizer Basissatz plus kantonale Feiertage als Seed, pro
Organisation auswählbar und ergänzbar. `sollStundenTag` gibt an ganzen
Feiertagen 0 zurück, an Halbtagen die Hälfte — `Holiday[]` als zusätzlicher
Parameter. Tests inklusive Karfreitag/Ostermontag (beweglich) und eines
kantonalen Feiertags.

**Ergebnis:** `Holiday`-Tabelle genau wie beschrieben (orgId, date, name,
canton nullable, halfDay), `@@unique([orgId, date, name])` gegen doppelte
Einträge beim erneuten Generieren. Reine additive Migration — direkt
angewendet.

Neues `lib/holidays.ts` (kein Prisma, kein DB-Zugriff, gleiches
Trennungsprinzip wie `lib/calc.ts`): `easterSunday()` per
Gauss'scher Osterformel (Meeus/Jones/Butcher) für die beweglichen Feste;
`swissBasisFeiertage(year)` liefert acht kantonsunabhängige Tage (Neujahr,
Karfreitag, Ostermontag, Auffahrt, Pfingstmontag, Bundesfeier, Weihnachten,
Stephanstag); `kantonaleFeiertage(year, canton)` liefert eine bewusst nicht
erschöpfende, aber reale Auswahl (Berchtoldstag für ZH/BE/SO/AG; Fronleichnam,
Mariä Himmelfahrt, Allerheiligen für LU/UR/SZ/TI/VS; Kantonsfeiertag Jura für
JU) — volle 26-Kantone-Abdeckung wäre ein eigener, deutlich grösserer Punkt
und ist bewusst nicht das Ziel hier, da die Tabelle selbst jederzeit weitere
Zeilen aufnehmen kann ("ergänzbar").

`sollStundenTag` um einen vierten, required Parameter `holidays: HolidayInput[]`
erweitert (gleiches "required statt optional"-Prinzip wie bei `changes` in
Punkt 1 und `maxWeeklyHours` in 6a — zwingt `tsc`, jeden Aufrufer zu finden):
An einem ganztägigen Feiertag liefert die Funktion 0, an einem Halbtag die
Hälfte des sonst berechneten Tagessolls. Durchgereicht durch `summeSollstunden`
und beide `KennzahlenInput`/`FeriensaldoInput` (neues Feld `holidays`) bis in
`kennzahlen()` und `feriensaldo()`. Bewusst NICHT angefasst: `bulk-vacation`
und `bulk-apply` (deren eigene Datumslogik überspringt nur Wochenenden, nicht
Feiertage) — ausserhalb des von Punkt 6c geforderten Umfangs (nur
`sollStundenTag`), wie schon bei 6a mit den Bulk-Routen entschieden.

Neue Route `app/api/holidays/route.ts`: GET (jedes Org-Mitglied, optionaler
`year`-Filter), POST mit zwei Modi — `{ generateYear, canton? }` generiert über
`lib/holidays.ts` und schreibt mit `skipDuplicates` (idempotent, wiederholtes
Generieren legt nichts doppelt an), oder `{ date, name, halfDay, canton? }`
legt einen einzelnen, manuell erfassten Feiertag an ("ergänzbar") — beide nur
admin/owner (`requireRole`). DELETE ebenso admin/owner-only, org-scoped.

Neue Seite `app/(app)/admin/holidays/page.tsx` (Nav-Tab „Feiertage" für
admin/owner, analog zum bestehenden „Team"-Tab): Jahr+Kanton generieren,
manuell ergänzen, Liste mit Löschen. Kalender (`app/(app)/calendar/page.tsx`)
lädt die Org-Feiertage, reicht sie an `sollStundenTag` durch (dadurch wird ein
Feiertag automatisch nicht mehr als "fehlender Eintrag" rot markiert — folgt
allein aus `tagesSoll === 0`, keine separate Sonderlogik nötig) und markiert
den Tag zusätzlich violett mit Titel-Tooltip (Feiertagsname). Analytics- und
Export-Route laden ebenfalls die Org-Feiertage und reichen sie an alle
`kennzahlen()`/`feriensaldo()`/`sollStundenTag()`-Aufrufe durch.

Tests: `lib/holidays.test.ts` (12 Tests) — Ostersonntag gegen eine unabhängige
Referenzimplementierung für 5 Jahre verifiziert (nicht nur gegen den eigenen
Code), Karfreitag/Ostermontag/Auffahrt/Pfingstmontag 2026 auf den Tag genau,
Basissatz-Vollständigkeit, Kantonsfeiertag Jura, Fronleichnam (beweglich) für
LU, leere Liste für einen nicht hinterlegten Kanton. `lib/calc.test.ts`
(7 neue Tests) — `sollStundenTag` an Karfreitag/Ostermontag/einem kantonalen
Feiertag (Jura) je 0, Halbtag-Feiertag halbiert korrekt, ein Feiertag am
Wochenende ändert nichts, `kennzahlen()` reduziert `soll` in einer
Karwoche mit zwei Feiertagen korrekt (32h statt 40h), ein trotz Feiertag
erfasster Arbeitseintrag zählt weiterhin normal als `ist` (Feiertage
beeinflussen nur soll, nie erfasste Ist-Stunden).

Browser-verifiziert (admin@onexis.test, „Feiertage"-Admin-Seite): 2026 +
Kanton Jura generiert → 9 Zeilen (8 Basissatz + Kantonsfeiertag Jura), Toast
und Liste korrekt; manueller Zusatzfeiertag angelegt und Toast bestätigt.
Kalender April 2026 zeigt Karfreitag (3.4.) und Ostermontag (6.4.) korrekt
violett markiert und **nicht** rot als fehlend, während alle übrigen
Werktage weiterhin korrekt als fehlend markiert sind. Keine Konsolenfehler.
Testdaten (alle 10 generierten/manuellen Holiday-Zeilen) danach vollständig
per SQL entfernt (Baseline 0 `Holiday`-Zeilen bestätigt).

**6d. Pausen- und Ruhezeitprüfung.** Reine Funktion `pruefeCompliance(eintraege
eines Tages, vortag)` in `lib/compliance.ts`, die Verstösse als Liste liefert:
Pause unter 15 Minuten bei über 5.5h, unter 30 Minuten bei über 7h, unter
60 Minuten bei über 9h; Tagesarbeitszeit über der Höchstgrenze; Ruhezeit unter
11 Stunden zum Vortag; Sonntags- oder Nachtarbeit ohne Markierung. Im Kalender
als nicht-blockierende Warnung am Tag anzeigen. Vollständig getestet.

**Ergebnis:** `pruefeCompliance(eintraegeEinesTages, eintraegeVortag)` genau
wie beschrieben in `lib/compliance.ts` (kein Prisma, kein DB-Zugriff, gleiches
Trennungsprinzip wie `lib/calc.ts`). Liefert eine Liste typisierter
`ComplianceViolation` (`pause_zu_kurz` | `tagesarbeitszeit_ueberschritten` |
`ruhezeit_zu_kurz` | `sonntagsarbeit` | `nachtarbeit`) mit deutschem
Klartext-Message pro Verstoss — rein informativ, blockiert nichts.

Pausenregel (Art. 15 ArG) bewusst als Schwellenwert, nicht additiv: die
höchste erreichte Stufe (>9h→60min, sonst >7h→30min, sonst >5.5h→15min)
bestimmt die Mindestpause, nicht die Summe aller Stufen. Tageshöchstgrenze
als dokumentierter Praxis-Richtwert (12.5h netto, SECO-Wegleitung) umgesetzt
— das Gesetz selbst kennt primär die WÖCHENTLICHE Höchstarbeitszeit
(`Profil.maxWeeklyHours`, Punkt 6a); dieser Tageswert ist eine bewusst
gekennzeichnete Vereinfachung, kein Gesetzeszitat, gleiche Vorgehensweise wie
schon beim Feiertags-Basissatz in 6c. Ruhezeit (Art. 15a ArG, 11h) vergleicht
den spätesten Schichtende-Zeitpunkt des Vortags mit dem frühesten
Schichtbeginn des aktuellen Tages als absolute Zeitpunkte (Datum + Uhrzeit),
inkl. korrekter Behandlung einer Vortags-Nachtschicht über Mitternacht.
Sonntags-/Nachtarbeit (Art. 16–18 ArG, Nachtfenster 23:00–06:00) wird
erkannt, sobald ein `arbeit`-Eintrag dort hineinfällt — es gibt (noch) kein
separates "bewilligt/markiert"-Feld im Schema, die Warnung macht genau
diese fehlende Markierung sichtbar (daher "ohne Markierung" im Punkt-Text).
Absenzen (`ferien`/`krank`/…) zählen nirgends als Arbeitszeit.

Kalender (`app/(app)/calendar/page.tsx`) berechnet pro Tag die Verstösse aus
den bereits geladenen Monatseinträgen (Vortag = derselbe Monat, Tag−1) und
zeigt bei Verstössen ein kleines gelbes Warndreieck mit den Verstoss-Texten
als Tooltip — rein informativ, es verhindert weder das Anlegen noch das
Speichern eines Eintrags. Bekannte, dokumentierte Einschränkung: am 1. eines
Monats fehlen die Einträge des Vormonats (nur der aktuelle Monat wird
geladen), die Ruhezeitprüfung zum Vortag greift dort deshalb nicht — gleiche
Klasse von Monatsgrenzen-Einschränkung wie schon bei `soll`/`ist` in
Punkt 1 und der wöchentlichen Überzeit in 6a.

Tests: `lib/compliance.test.ts` (17 Tests) — alle drei Pausenschwellen
einzeln (mit und ohne Verstoss), Tageshöchstgrenze exakt an der 12.5h-Grenze
und knapp darüber, Ruhezeit zu kurz/ausreichend/nicht prüfbar (kein Vortag)
und mit einer Vortags-Nachtschicht über Mitternacht, Sonntagsarbeit an einem
echten Sonntag vs. einem Werktag, Nachtarbeit-Überschneidung vs. Tagschicht,
leere Eingabe, Absenzen zählen nicht, mehrere gleichzeitige Verstösse.

Browser-verifiziert (manager@onexis.test, Kalender, Sonntag 03.05.2026 —
bewusst ein leerer Tag ausserhalb bestehender Testdaten, per Monats-Picker
angesteuert und der erreichte Monat vor dem Klick verifiziert): Arbeitseintrag
08:00–17:00 ohne Pause angelegt → Warndreieck erscheint mit Tooltip
"Bei 9.0h Arbeitszeit sind mindestens 30 Min. Pause vorgeschrieben (erfasst:
0 Min.) · Sonntagsarbeit erfasst — bewilligungspflichtig, sofern nicht
ausdrücklich freigegeben." — beide erwarteten Verstösse korrekt gleichzeitig
erkannt. Keine Konsolenfehler. Testdaten per SQL entfernt (Baseline 66
`TimeEntry`-Zeilen bestätigt).

Keine Prisma-Migration nötig — reine Funktion + UI, kein neues Schema.

**6e. Monatsabschluss.** Tabelle `MonthLock` (orgId, userId, year, month,
lockedAt, lockedBy). Gesperrte Monate sind für `member` read-only; `admin` kann
entsperren, was im Audit-Trail landet.

**Ergebnis:** `MonthLock` genau wie beschrieben (orgId, userId, year, month,
lockedAt, lockedBy) — Existenz einer Zeile bedeutet "gesperrt", `@@unique([orgId,
userId, year, month])`. Bewusste Design-Entscheidung, dokumentiert weil nicht
trivial aus dem Punkt-Text ableitbar: Entsperren **löscht** die `MonthLock`-Zeile
wieder (kein `unlocked`-Flag), damit "gesperrt?" weiterhin eine reine
Existenzabfrage bleibt. Der geforderte Audit-Trail ("was im Audit-Trail landet")
kann deshalb nicht `TimeEntryAudit` wiederverwenden — dessen Schema ist ein
Feld-Diff eines einzelnen `TimeEntry`, ein Sperr-/Entsperr-Ereignis ist aber ein
Vorgang auf (orgId, userId, year, month) ohne Feld-Diff. Stattdessen eine neue,
unveränderliche Tabelle `MonthLockAudit` (orgId, userId, year, month, action
`"locked"`|`"unlocked"`, performedBy, performedAt) — bleibt bestehen, auch wenn
die zugehörige `MonthLock`-Zeile beim Entsperren gelöscht wird, sonst ginge "wer
hat wann entsperrt" verloren. Beide Migrationen additiv, direkt angewendet.

Neuer Helfer `assertMonthEditable(orgId, userId, role, date)` in `lib/access.ts`
(plus `isMonthLocked()`) — wirft 403, **nur wenn `role === "member"`** und der
Monat von `date` gesperrt ist. Bewusste, im Punkt-Text nicht explizit
entschiedene Scope-Frage: der Wortlaut sagt ausdrücklich "Gesperrte Monate sind
für `member` read-only" und nennt manager/admin/owner nicht — diese drei Rollen
sind deshalb NICHT eingeschränkt und können auch in gesperrten Monaten weiterhin
schreiben (z.B. um eine Korrektur vorzunehmen), ohne vorher extra entsperren zu
müssen. Verdrahtet in `app/api/time-entries/route.ts` (POST prüft das
Zieldatum; PUT prüft sowohl den bisherigen als auch — falls das Datum geändert
wird — den neuen Monat, damit sich eine Sperre nicht durch Verschieben eines
Eintrags umgehen lässt; DELETE prüft den bestehenden Monat) sowie in
`bulk-vacation`/`bulk-apply`: dort werden gesperrte Tage für `member` wie ein
Feiertag/Ferien-Tag pro Tag übersprungen statt den ganzen Aufruf abzulehnen —
der Rest eines Zeitraums bleibt so nutzbar, auch wenn er über eine
Monatsgrenze in einen gesperrten Monat hineinreicht (`bulk-vacation` zählt das
in den bestehenden `skipped`-Zähler, `bulk-apply` bekam einen eigenen neuen
`skippedLocked`-Zähler, da diese Route bereits mehrere Skip-Gründe einzeln
ausweist).

Neue Route `app/api/month-locks/route.ts`: GET (jedes Org-Mitglied für sich
selbst, ein fremdes `userId` nur wer laut `canSeeUser` darf — für die
Kalender-Anzeige und die Team-Verwaltung), POST/DELETE nur admin/owner
(`requireRole`, gleiches Muster wie bei Feiertagen in 6c). POST ist idempotent
(erneutes Sperren eines bereits gesperrten Monats liefert die bestehende Zeile
zurück statt eine zweite `MonthLockAudit`-"locked"-Zeile zu erzeugen).

UI: `/admin/team` bekam pro Mitglied einen neuen "Monatsabschluss"-Abschnitt
im aufklappbaren Panel (Jahr/Monat wählen, Sperren-Button, Liste gesperrter
Monate mit Entsperren-Button je Zeile) — strukturell analog zum bestehenden
Pensumsänderungs-Abschnitt. Kalender (`app/(app)/calendar/page.tsx`) lädt die
eigenen Sperren für das angezeigte Jahr und zeigt bei einem gesperrten
aktuellen Monat — nur für `member` — eine gelbe Hinweisleiste über dem
Kalendergitter; der Tagesdialog (`components/day-entry-dialog.tsx`) bekam eine
neue optionale `locked`-Prop, die bei `true` dieselbe Hinweisleiste im Dialog
zeigt und die Buttons "Eintrag hinzufügen", "Speichern" und den
Löschen-Button deaktiviert. Ausdrücklich nur UI-Komfort: die eigentliche
Durchsetzung liegt serverseitig in `assertMonthEditable`, nicht im
deaktivierten Button — mit Playwright verifiziert per direktem `fetch()`-Aufruf
gegen die API unter Umgehung der UI (s.u.).

Tests: `lib/access.test.ts` (5 neue Tests für `isMonthLocked`/
`assertMonthEditable`, inkl. dass admin/owner/manager NICHT geblockt werden).
Neues `lib/month-locks.test.ts` (14 Tests, Route-Ebene wie
`lib/time-entry-audit.test.ts`): Sperren/Entsperren nur admin/owner,
Idempotenz beim erneuten Sperren, Audit-Zeilen für beide Aktionen, 404 beim
Entsperren eines nicht gesperrten Monats; Durchsetzung auf POST/PUT/DELETE in
`time-entries` (member 403 beim Anlegen/Ändern/Löschen im gesperrten Monat,
admin unbeschränkt, ein Eintrag lässt sich nicht per Datumsänderung in einen
gesperrten Monat hinein verschieben); `bulk-vacation`/`bulk-apply` überspringen
korrekt genau die Tage im gesperrten Monat und legen die übrigen Tage des
Zeitraums normal an. 127 Tests insgesamt grün.

Browser-verifiziert (Playwright, komplette echte Klickpfade, nicht nur API):
admin sperrt Dezember 2026 für Mia (member@onexis.test) über `/admin/team` →
Liste zeigt "Dezember 2026"; als Mia eingeloggt zeigt der Kalender im
Dezember die gelbe Hinweisleiste, der Tagesdialog zeigt dieselbe Meldung und
der "Eintrag hinzufügen"-Button ist nachweislich `disabled`; ein direkter
`fetch()`-POST gegen `/api/time-entries` (unter Umgehung der deaktivierten
UI) liefert `403` mit der erwarteten Fehlermeldung — die serverseitige Sperre
wirkt unabhängig vom UI-Zustand. Admin entsperrt danach über `/admin/team`
wieder → Liste ist leer. Keine echten Konsolenfehler (der einzige geloggte
Eintrag ist die erwartete `403`-Netzwerkantwort des bewussten Testaufrufs).
`TimeEntry`-Baseline (66 Zeilen) blieb während des gesamten Laufs unverändert
— der blockierte POST-Versuch hat nachweislich nichts geschrieben. Testdaten
(`MonthLock`- und `MonthLockAudit`-Zeilen) danach vollständig per SQL
entfernt (Baseline 0/0 bestätigt).

Keine UI-Änderung an Punkt 7/8/9 vorgezogen — insbesondere kein
Team-Kalender, der gesperrte Monate für andere als die eigene Person anzeigt;
das bleibt Gegenstand von Punkt 8 (Teamsicht), sobald es dort ohnehin eine
Ansicht über mehrere Personen gibt.

---

### - [x] 7. Exporte

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

**Ergebnis:** Alle drei Bullets umgesetzt, keine Schemaänderung nötig (reine
API-/Berechnungs-/UI-Erweiterung), deshalb keine Prisma-Migration in diesem
Punkt. Gemeinsame Hilfsfunktionen (`buildProfil`, `mapChanges`, `mapEintraege`,
`parseExportRange`, Excel-Stil-Helfer) aus `app/api/export/route.ts` nach
`lib/export-helpers.ts` extrahiert, damit alle drei Export-Routen sie nutzen
können, ohne dass eine `route.ts`-Datei Hilfsfunktionen aus einer anderen
`route.ts`-Datei importiert (Next.js App Router erlaubt aus Route-Dateien nur
HTTP-Handler- und wenige Config-Exports).

- **Bestehender Excel-Export erweitert** (`app/api/export/route.ts`): neuer
  `scope`-Parameter (`self` | `person` | `org`). `person` prüft `canSeeUser`
  (dieselbe Berechtigungslogik wie überall sonst); `org` verlangt
  `requireRole(["owner","admin"])` und liefert bewusst NICHT den vollen
  3-Sheet-Tagesbericht für jede Person (das wäre bei grösseren Organisationen
  unhandlich und überschneidet sich mit der noch kommenden Teamsicht, Punkt 8,
  `teamKennzahlen()`), sondern eine kompakte Ein-Zeile-pro-Mitglied-Übersicht
  (Soll/Ist/Überstunden/Überzeit/Verrechnungsgrad/Feriensaldo) auf einem
  eigenen Sheet "Alle Mitarbeitenden", nur aktive Mitgliedschaften.
- **ArG-Kontrollexport** (neue Route `app/api/export/arg-control/route.ts`,
  dieselben drei `scope`-Modi): läuft Tag für Tag durch den gewählten
  Zeitraum (nicht nur über vorhandene Einträge, damit Ruhetage als solche
  sichtbar sind), ein Sheet pro Person, mit Datum/Wochentag/Beginn/Ende/
  Pause(Min)/Tagesarbeitszeit/Wochenarbeitszeit/Überzeit/Ruhetag/Nachtarbeit/
  Sonntagsarbeit. Wochenarbeitszeit und Überzeit kommen aus einer neuen,
  rein additiven Funktion `wochenUebersicht()` in `lib/calc.ts` (nutzt
  `kennzahlen()`s bereits vorhandene wochenweise Überzeit-Gruppierung, gibt
  sie aber pro Woche statt nur als Summe zurück — `kennzahlen()` selbst blieb
  unverändert). `montagDerWoche()` wurde dafür von privat auf `export`
  umgestellt, damit Route und `lib/calc.ts` exakt dieselbe
  Wochendefinition verwenden statt sie zweimal zu implementieren.
  Nacht-/Sonntagsarbeit kommt aus dem bereits bestehenden `pruefeCompliance()`
  (Punkt 6d) — anders als im Kalender wird hier zusätzlich der Tag VOR dem
  gewählten Zeitraum mitgeladen, damit auch für den allerersten Tag des
  Exports ein Vortag für die Ruhezeitprüfung bekannt ist (die vom Kalender
  bekannte Monatsgrenzen-Einschränkung aus 6d/6a gilt hier also nicht).
  **Dokumentierte Vereinfachung:** Art. 73 ArGV 1 verlangt "Dauer UND LAGE"
  der Pausen; das Schema speichert nur `pauseMin` (Dauer), keine Pausen-Start-/
  Endzeit — die Spalte heisst deshalb bewusst "Pause (Min)", nicht
  "Pause (Lage)". Eine Schemaänderung dafür wäre ein eigener Punkt.
  **Bug beim eigenen Testen gefunden und behoben:** Excel-Sheetnamen müssen
  innerhalb eines Workbooks eindeutig sein — zwei Mitarbeitende mit
  identischem Vor-/Nachnamen liessen `scope=org` mit "Worksheet name already
  exists" abstürzen. Behoben mit einer Kollisions-Zähler-Disambiguierung
  (` (2)`, ` (3)`, …), inkl. korrekter Berücksichtigung von Excels
  31-Zeichen-Sheetname-Limit VOR der Kollisionsprüfung, nicht danach.
- **Lohnexport CSV** (neue Route `app/api/export/payroll/route.ts`, immer
  organisationsweit, `requireRole(["owner","admin"])`, Query nur `year`+
  `month`): eine Zeile pro Mitgliedschaft, die im gewählten Monat mindestens
  einen Tag aktiv war (Ein-/Austritt mitten im Monat zählt noch mit — nicht
  nur `status: "aktiv"` heute, sonst fehlt ein während des Monats
  ausgetretenes Mitglied für genau seinen Austrittsmonat). Spalten:
  Personal-ID, Name, E-Mail, aktuelles Pensum, Sollstunden, Stunden je
  Absenztyp (Arbeit/Ferien/Krank/Militär/Unbezahlt/Feiertag), Überstunden,
  Überzeit. **Format-Entscheidungen, dokumentiert weil nicht aus dem
  Punkt-Text ableitbar:** Semikolon als Trennzeichen mit Komma als
  Dezimaltrennzeichen (deutsch-/schweizerisches Excel-Standardgebietsschema)
  und UTF-8-BOM (korrekte Umlaute in Excel) — bewusst KEINE Swissdec-ELM-
  Zertifizierung (eigener XML-Standard mit eigenem Zertifizierungsprozess),
  wie im Punkt-Text ausdrücklich nicht verlangt; stattdessen eine generische,
  klar beschriftete CSV zur manuellen Übernahme.
- **UI** (`app/(app)/profile/page.tsx`): Rolle jetzt über `useSession()`
  gelesen (vorher nirgends in dieser Datei vorhanden). Für admin/owner ein
  neuer "Bereich"-Selektor (Eigene Daten/Mitarbeiter:in wählen/Ganze
  Organisation) über dem bestehenden Export-Button, Personen-Liste aus dem
  bereits admin/owner-gated `/api/admin/team` — bewusst KEIN Zugriff für
  manager auf fremde Exporte, da es dafür noch keine Team-Mitgliederliste
  gibt (kommt erst mit Punkt 8, Teamsicht); dieselbe Scope-Auswahl gilt auch
  für den neuen "ArG-Kontrollexport"-Button. Eigene neue Karte "Lohnexport"
  (Monat+Jahr, CSV-Button), nur für admin/owner sichtbar, da Lohndaten
  sensibel sind und organisationsweit gelten.

Tests: 5 neue in `lib/calc.test.ts` (`wochenUebersicht`: Woche am Limit ohne
Überzeit, Woche über dem Limit, mehrere Wochen korrekt getrennt und
sortiert, Einträge ausserhalb `[from,to]` ignoriert, Absenzen zählen nicht).
Neues `lib/export-routes.test.ts` (9 Tests, Route-Ebene): für alle drei
Export-Routen — `scope=self` funktioniert für jede Rolle, `scope=person`
liefert 403 ohne `canSeeUser`-Berechtigung und 200 mit, `scope=org`/
Lohnexport sind admin/owner-only (403 sonst); Lohnexport-Test prüft
zusätzlich den Semikolon-Header und eine korrekt mit Komma formatierte
Stundenzahl aus einem echten Zeiteintrag. 141 Tests insgesamt grün.

Browser-verifiziert (Playwright, echte Logins): admin sieht den Bereich-
Selektor, exportiert erfolgreich eigene Daten, die ganze Organisation und
eine ausgewählte Person (Dropdown zeigt alle vier Demo-Mitglieder korrekt),
lädt einen ArG-Kontrollexport und einen Lohnexport herunter — dessen CSV
enthält den erwarteten Semikolon-Header inkl. `Ueberstunden`/`Ueberzeit`.
Als einfaches Mitglied eingeloggt: Bereich-Selektor und Lohnexport-Karte sind
korrekt unsichtbar, der eigene ArG-Kontrollexport funktioniert weiterhin.
Keine Konsolenfehler in beiden Durchläufen. Keine Schreib-Operationen in
diesem Punkt (alle drei Routen sind reine GET-Exporte) — `TimeEntry`-Baseline
(66 Zeilen) vor und nach der Verifikation unverändert, keine Aufräumung nötig.

Keine Prisma-Migration nötig — reine Code-/UI-Erweiterung.

---

### - [x] 8. Teamsicht — der eigentliche USP

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

**Ergebnis:** Vollständig umgesetzt, in drei Commits (8a Berechnungskern,
8b API-Route, 8c UI + Nav + Export-Erweiterung), keine Schemaänderung nötig
(reine Aggregation bereits vorhandener Daten).

- **8a — `lib/calc.ts`:** neue reine Funktion `teamKennzahlen()` — ruft für
  jede Person die bereits verifizierte `kennzahlen()` auf und summiert die
  Ergebnisse zu Totals; keine eigene Berechnungslogik. `wochenUebersicht()`
  (aus Punkt 7) erweitert statt eine zweite, fast identische Funktion zu
  bauen: liefert jetzt DICHT jede Kalenderwoche im Zeitraum (auch ganz ohne
  Einträge, vorher nur Wochen mit Einträgen — nötig, damit Heatmap/Prognose
  lückenlose Wochenraster zeigen) sowie zusätzlich `kundenstunden`/
  `verrechnungsgrad` (Heatmap) und `sollStunden`/`auslastung` (Prognose) je
  Woche. Eine Funktion für drei Verwendungszwecke (ArG-Kontrollexport,
  Heatmap, Prognose) statt drei fast identischer — dieselbe
  Wochen-Gruppierung wird so garantiert nur einmal implementiert.
  `montagDerWoche()` und `summeSollstunden()` von privat auf `export`
  umgestellt (bereits bei `montagDerWoche` in Punkt 7 begonnenes Muster),
  damit keine der beiden Wochen-/Soll-Berechnungen zweimal implementiert
  wird.
- **8b — `app/api/team/route.ts`:** owner/admin/manager (member verboten).
  Sichtbarkeit als Listenfilter — dieselbe Hierarchie wie `canSeeUser()` in
  `lib/access.ts`, hier aber für eine ganze Liste statt einer Einzelprüfung:
  manager sehen sich selbst + direkt unterstellte Mitglieder
  (`Membership.managerId`), admin/owner die ganze Organisation. Liefert pro
  sichtbarem Mitglied Soll/Ist/Überstunden/Verrechnungsgrad (über
  `teamKennzahlen()`) plus Feriensaldo (separater `feriensaldo()`-Aufruf,
  andere Zeitdimension "Jahr" als der gewählte Berichtszeitraum), eine
  Heatmap-Wochenliste für den gewählten Berichtszeitraum und eine
  Prognose-Wochenliste für die kommenden 8 Wochen — bewusst ein FIXES,
  vom gewählten Berichtszeitraum UNABHÄNGIGES Prognosefenster (dokumentierte,
  aber willkürliche Wahl, kein Gesetzeswert), da die Prognose immer ab der
  aktuellen Woche in die Zukunft blickt, während der Berichtszeitraum
  typischerweise ein vergangener/laufender Monat ist. Ein einziger
  Entries-Fetch pro Person deckt beide Fenster ab (kennzahlen()/
  wochenUebersicht() filtern intern auf ihr jeweiliges `[from,to]`).
  Kunden-/Projektsicht: Stunden je aktivem Projekt/Kunde NUR aus den
  sichtbaren Mitgliedern (bei manager: nur das eigene Team), Umsatz aus dem
  Stundensatz (Projekt- vor Kunden-Stundensatz als Fallback), Budget-
  überschreitung markiert — verwendet `Project.hourlyRate`/`budgetHours`
  erstmals seit ihrer Einführung in Punkt 5 (dort als bewusst offene Lücke
  dokumentiert).
- **8c — UI (`app/(app)/team/page.tsx`) und Nachzügler-Fixes:** Rollen-Guard
  (redirect zu `/calendar` für `member`), neuer Nav-Tab „Teamsicht" für
  owner/admin/manager (`app/(app)/layout.tsx`) — bewusst getrennt vom
  bestehenden „Team"-Tab (`/admin/team`, reine Mitgliederverwaltung,
  weiterhin admin/owner-only). Zeitraum-Selektor (Monat/Jahr/Zeitraum,
  gleiches Muster wie Analytics/Export), Mitarbeitenden-Tabelle mit
  Klick-Sortierung (jede Spalte) und Namensfilter, Heatmap- und
  Prognose-Raster als eingefärbte Tabellen (Farbskala: <50% orange,
  50–80% gelb, 80–110% grün, >110% rot — "deutlich überbucht"),
  Kunden-/Projekttabelle mit rot hervorgehobenen Budgetüberschreitungen.
  Excel-Export der Tabelle nutzt den bereits in Punkt 7 gebauten
  `/api/export?scope=org`-Endpunkt wieder, statt einen eigenen zu bauen.
  **Dabei eine in Punkt 7 bereits dokumentierte, bewusst offen gelassene
  Lücke geschlossen:** `scope=org` in `/api/export` war bisher admin/owner-
  only — jetzt auch für `manager` erlaubt, dann aber serverseitig auf das
  eigene Team beschränkt (`restrictToUserIds`), statt versehentlich die
  ganze Organisation zu exportieren. `/api/team` bekam ausserdem eine kleine
  Ergänzung: `pensum` (aktueller Vertragswert, gleiche Wahl wie im
  Lohnexport) wird jetzt pro Mitglied mitgeliefert — für die Tabellenspalte
  gebraucht, war in der ursprünglichen 8b-Fassung übersehen worden.

Tests: 14 neue in `lib/calc.test.ts` (`wochenUebersicht`: dichte
Wochenliste, Verrechnungsgrad, Sollstunden/Auslastung; `teamKennzahlen`:
Konsistenz mit direktem `kennzahlen()`-Aufruf, Totals-Summierung,
Null-Fälle). Neues `lib/team-route.test.ts` (6 Tests): Berechtigungs-Scoping
für alle drei erlaubten Rollen (member 403, manager nur eigenes Team,
admin/owner alle), Budgetüberschreitung + Umsatzberechnung, Feriensaldo/
Heatmap/Prognose-Struktur pro Mitglied, Totals-Aggregation. 154 Tests
insgesamt grün.

Browser-verifiziert (Playwright, drei echte Logins): admin sieht alle vier
Demo-Mitglieder in Tabelle, Heatmap und Prognose, Spalten-Sortierung und
Namensfilter funktionieren, Excel-Export lädt herunter; manager sieht
nachweislich nur sich selbst und den einen direkt unterstellten Bericht
(Mia), nicht Anna (admin) oder John (owner) — sowohl in der Tabelle als
auch in Heatmap/Prognose; member wird beim Versuch, `/team` direkt
aufzurufen, zu `/calendar` umgeleitet, und der Nav-Tab „Teamsicht" ist für
member gar nicht erst sichtbar. Keine Konsolenfehler in allen drei
Durchläufen. Keine Schreib-Operationen in diesem Punkt (alle Routen sind
GET) — `TimeEntry`-Baseline (66 Zeilen) vor und nach der Verifikation
unverändert.

Bewusst NICHT Teil dieses Punktes: eine Team-Mitgliederliste für manager in
der Profilseiten-Export-UI (dort bei Punkt 7 als offene Lücke dokumentiert)
— die manager-Sichtbarkeitslogik existiert jetzt serverseitig vollständig
(`/api/team`, `/api/export?scope=org`), aber `profile/page.tsx`s
Personen-Picker nutzt weiterhin `/api/admin/team` (admin/owner-only) und
bietet manager deshalb keine UI, um für ein einzelnes Teammitglied zu
exportieren. Das bleibt eine bewusst offene, dokumentierte Lücke für einen
späteren Punkt.

Keine Prisma-Migration nötig — reine Aggregation bereits vorhandener Daten.

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
- Punkt 2: Wie mit dem Nutzer abgestimmt vor der destruktiven Migration
  angehalten (droppt `User.code` und die `SecurityQuestion`-Tabelle) und die
  per Hand ergänzte SQL vorgelegt — nach Freigabe mit `prisma migrate deploy`
  angewendet und verifiziert (Details unter **Ergebnis:** beim Punkt selbst).
  Zwei echte Bugs erst durch die Browser-Verifikation gefunden, nicht durch
  Typecheck/Tests: ein Modul-Singleton-`NextResponse` mit verbrauchtem
  Body-Stream (`forgot-password`-Route) und ein `router.replace()` im
  Render-Pfad statt in `useEffect` (`(app)/layout.tsx`) — beide sind
  Beispiele dafür, dass Response-Objekte in Next.js Route Handlers und
  Navigations-Side-Effects in React nicht wiederverwendet/während des
  Renderns ausgeführt werden dürfen; ohne den echten Klick-Pfad (nicht nur
  API-Calls) wären beide unentdeckt geblieben.
- Punkt 2, Auffälligkeit: der Login-Testnutzer im `password`-Feld hielt
  tatsächlich `bcrypt("1234")`, nicht `bcrypt("johndoe123")` wie die alte
  Version von `scripts/seed.ts` es für einen frischen Seed vorgesehen hätte —
  der Datensatz wurde also irgendwann über den alten Code-Ändern-Flow
  aktualisiert (der `password` immer auf denselben Hash wie `code` setzte),
  nicht zuletzt über `seed.ts`s `upsert` mit `update: {}` neu erzeugt. Für
  künftige Punkte relevant: `scripts/seed.ts` verändert bestehende Zeilen nie,
  Annahmen über den tatsächlichen DB-Zustand sollten daher immer per Query
  geprüft werden, nicht aus dem Seed-Skript abgeleitet werden.
- Punkt 2, kleine bewusste Erweiterung über den Wortlaut hinaus: die
  `LoginAttempt`-Tabelle bekam ein `action`-Feld (`"login"` |
  `"forgot-password"` | `"reset-password"`) statt drei getrennter Tabellen —
  deckt "Rate-Limiting auf `/api/auth/*`" (nicht nur den Login) mit einer
  Tabelle ab. `/api/auth/login/route.ts` (ungenutzter, ungedrosselter
  Zweit-Endpunkt für denselben Credential-Check) im selben Zug entfernt.
- Punkt 3: in sechs Commits abgearbeitet (3a/3c/3d/3e/3f je einzeln, 3b in
  zwei Migrationen aufgeteilt — additiv sofort, destruktiv erst nach 3d/3e
  und expliziter Freigabe). Ausführliche Begründung unter **Ergebnis:**
  beim Punkt selbst.
- Punkt 3, methodischer Fund beim Schreiben der Isolationstests: ein Sanity-
  Check (orgId testweise aus einer Query entfernt, Tests müssen dann rot
  werden) deckte auf, dass die ersten GET-Tests orgId-Isolation gar nicht
  wirklich bewiesen — userId allein disambiguiert in diesem Datensatz schon
  zwischen Organisationen, weil jeder Testnutzer eindeutig einer Org
  angehört. Erst ein Nutzer mit Mitgliedschaft in zwei Organisationen macht
  den Unterschied sichtbar. Für künftige Isolationstests (Punkt 8/9)
  relevant: ohne einen solchen Sanity-Check hätte sich ein grüner Testlauf
  angefühlt wie ein Beweis, ohne einer zu sein.
- Punkt 3, Auffälligkeit für Punkt 4/8: `requireOrg()` nimmt aktuell die
  erste Membership eines Nutzers nach `createdAt` — es gibt noch keine
  Org-Wechsel-UI. Sobald ein Mensch real in zwei Organisationen sein kann
  (wovon Punkt 3 im Datenmodell bereits ausgeht), braucht es einen
  bewussten Wechsel-Mechanismus, nicht nur die implizite Auswahl der
  ältesten Mitgliedschaft.
- Punkt 4: in vier Commits abgearbeitet (4a–4d, je einer pro Bullet-Punkt).
  Die Org-Wechsel-Lücke aus der vorigen Notiz wurde dabei genutzt statt
  gelöst: `lib/auth-options.ts` filtert beim Login jetzt zusätzlich auf
  `status: "aktiv"`, damit "deaktivieren" aus 4c echte Wirkung hat — aber
  wählt weiterhin nur die älteste (jetzt: älteste aktive) Membership. Bleibt
  eine offene Lücke für später: eine Person mit mehreren aktiven
  Organisationen kann sich nicht bewusst für eine entscheiden.
  `/api/invitations/accept` behandelt diesen Fall für eine bereits
  bestehende Person zwar korrekt (fügt nur eine Membership hinzu), aber
  ohne UI, um danach zwischen Organisationen zu wechseln.
  > BLOCKER: keiner — nur eine bewusst offen gelassene, dokumentierte
  > Lücke, kein Show-Stopper für die folgenden Punkte.
- Punkt 4a, methodische Wiederholung aus Punkt 1/3: `Profil.exitDate`
  wurde bewusst REQUIRED statt optional gemacht (4d) — der Typecheck fand
  dadurch alle drei Produktionsstellen und 17 Test-Fixtures automatisch,
  ohne dass grep danach suchen musste. Dieselbe Technik wie `changes` in
  Punkt 1 und `exitDate`/`orgId` in Punkt 3 — inzwischen ein verlässliches
  Muster für diesen Loop: neue Pflichtfelder auf zentralen, oft
  konstruierten Typen lieber required machen als optional mit Default,
  wenn ein vergessener Aufrufer sonst still falsches Verhalten zeigen würde
  statt eines Compile-Fehlers.
- Punkt 4c, Sicherheitsdesign-Entscheidung: drei separate Schutzregeln
  (nur owner vergibt owner-Rolle; letzter owner nicht degradierbar; niemand
  deaktiviert sich selbst; letzter aktiver owner nicht deaktivierbar) statt
  einer einzigen groben Regel ("owner kann sich nicht selbst schaden"). Der
  Grund: die vier Fälle sind unabhängig voneinander verletzbar (z.B. könnte
  ein admin theoretisch versuchen, sich selbst zum owner zu machen, ohne
  dass der aktuelle owner betroffen wäre) — eine einzige Regel hätte
  mindestens einen der vier Fälle übersehen. Alle vier einzeln
  Playwright-verifiziert.
- Punkt 5: in fünf Commits abgearbeitet (5a–5d je einzeln, plus die
  abschliessende, destruktive Migration nach Freigabe) — dieselbe
  zweigeteilte Strategie wie Punkt 3. Ausführliche Begründung unter
  **Ergebnis:** beim Punkt selbst.
- Punkt 5, methodischer Fund beim eigenen Nachverifizieren (wieder,
  ähnlich wie schon in Punkt 3e): ein Browser-Testskript mit einer
  fehlerhaften Monatsnavigation (Off-by-one — zwei Klicks statt einem, um
  von August nach September zu kommen) erzeugte einen Testeintrag am
  falschen Datum; die Aufräum-Logik desselben Laufs suchte gezielt nach
  dem beabsichtigten Datum und übersah die Karteileiche deshalb. Erst der
  SQL-Check unmittelbar vor der abschliessenden Migration deckte die
  überzählige Zeile auf. Für künftige Punkte relevant: Testskripte, die
  Kalendernavigation über Klicks simulieren, sollten die tatsächlich
  erreichte Seite (z.B. den Monats-Header-Text) verifizieren, BEVOR sie
  einen Tag anklicken — nicht erst am Ende prüfen, ob die erwarteten
  Werte am erwarteten Datum stehen. Ein "Erfolg" beim Speichern beweist
  nicht, dass am richtigen Tag gespeichert wurde.
- Punkt 5, Auffälligkeit für Punkt 8 ("Kunden- und Projektsicht: Stunden
  je Kunde und Projekt, Budget gegen verbraucht"): `Project.hourlyRate`
  und `budgetHours` werden seit diesem Punkt zwar gespeichert und in der
  Profilseite verwaltet, aber nirgends berechnet oder angezeigt (kein
  Soll/Ist gegen das Budget, kein aus dem Stundensatz abgeleiteter
  Umsatz) — das ist bewusst ausserhalb des Scopes von Punkt 5 geblieben
  und wird der eigentliche Inhalt von Punkt 8.
- Punkt 6a: `Organization.maxWeeklyHours` existierte bereits seit Punkt 3a
  (vorausschauend für genau diesen Punkt angelegt) — keine Migration nötig,
  reine Code-Verdrahtung. Für die Browser-Verifikation wurde die
  Testfixture (5×10h-Woche) bewusst per SQL statt über die Kalender-UI
  angelegt, weil die Eintrags-Erfassung selbst in 6a nicht verändert wurde
  und nur die Berechnungs-/Anzeigeschicht zu verifizieren war — vermeidet
  das Risiko eines weiteren Klick-Navigations-Bugs wie in Punkt 5. Wichtig
  für 6b–6e: der ArG-Begriff „Überzeit" ist jetzt sauber von der
  OR-„Überstunden" getrennt (Feld, i18n-Label, UI-Karte, Export-Zeile) —
  künftige Compliance-Punkte (v.a. 6d, Pausen-/Ruhezeitprüfung) sollten
  konsequent denselben Begriff verwenden und nicht wieder vermischen.
- Punkt 6b: die beiden Bulk-Routen (`bulk-vacation`, `bulk-apply`) bauten
  bisher ein Array von Prisma-Operationen und führten es als
  Batch-Transaktion (`prisma.$transaction([...])`) aus — das geht nicht mehr,
  sobald pro Update ein Vorher-Zustand für den Audit-Diff gebraucht wird.
  Beide auf eine interaktive Transaktion (`prisma.$transaction(async (tx) =>
  …)`) umgestellt. Wichtig für künftige Punkte, die diese Routen anfassen
  (z.B. 6c, falls Feiertage auch bulk gesetzt werden): Erstellungen werden
  bewusst NICHT auditiert, nur Änderungen an bestehenden Zeilen und
  Löschungen — konsequent so weiterführen, nicht nachträglich doch
  Create-Audits ergänzen, ohne das explizit zu entscheiden. Ausserdem: jede
  neue Stelle, die TimeEntry liest, MUSS `deletedAt: null` filtern — leicht
  zu vergessen, da es keinen DB-Constraint gibt, der das erzwingt (bewusst
  keine Prisma-Middleware/globalen Filter verwendet, um explizit zu bleiben,
  welche Query was sieht).
- Punkt 6c: bewusst keine Vollabdeckung aller 26 Kantone in
  `kantonaleFeiertage()` — nur eine reale, aber kleine Auswahl (ZH/BE/SO/AG,
  LU/UR/SZ/TI/VS, JU). Für Punkt 8/9 oder eine spätere Iteration relevant,
  falls weitere Kantone gebraucht werden: entweder `lib/holidays.ts` gezielt
  erweitern (mit Quellenangabe/Verifikation der Daten, nicht aus dem
  Gedächtnis) oder — meist einfacher und schon jetzt möglich — den fehlenden
  Feiertag direkt als manuellen Eintrag über `/admin/holidays` anlegen, ohne
  Code zu ändern ("ergänzbar" ist bewusst so gebaut). Ausserdem wichtig: die
  bereits bestehenden `TimeEntry`-Einträge vom Typ `feiertag` (manuell vom
  Nutzer als Feiertag markierte Arbeitstage, z.B. bei individuellen
  Feiertagsregelungen) sind ein komplett separater Mechanismus von der neuen
  `Holiday`-Tabelle (org-weiter, automatisch das Soll reduzierender Kalender)
  — beide bewusst nicht zusammengeführt, da sie unterschiedliche Dinge
  ausdrücken (persönlicher Eintrag vs. organisationsweiter Fakt).
- Punkt 6d: die Tageshöchstgrenze (12.5h) und die Nachtzeitspanne
  (23:00–06:00) sind wie der Feiertags-Basissatz in 6c bewusst dokumentierte
  Praxis-Vereinfachungen, keine wörtlichen Gesetzeszitate — falls das in
  einem späteren Punkt (z.B. 12, Verkaufsfähigkeit/Rechtstexte) genauer
  werden muss, zuerst dort nachschärfen, nicht rückwirkend hier. Ausserdem:
  die Compliance-Prüfung im Kalender rechnet aktuell nur mit den bereits
  geladenen Monatsdaten — bekommt `/admin/holidays` oder ein künftiger
  Punkt einen Jahres- oder Wochenview, sollte die Ruhezeitprüfung an
  Monatsgrenzen (aktuell: 1. eines Monats ungeprüft) nochmals angeschaut
  werden, statt die Einschränkung stillschweigend fortzuschreiben.
- Punkt 6e (letzter Unterpunkt von Punkt 6, damit ist Punkt 6 komplett
  abgeschlossen): zwei Design-Entscheidungen, die der Punkt-Text offen liess
  und die für spätere Punkte relevant sein könnten. Erstens: Entsperren
  löscht die `MonthLock`-Zeile, statt sie mit einem Flag zu markieren — der
  geforderte Audit-Trail ("was im Audit-Trail landet") lebt deshalb in einer
  eigenen, unveränderlichen Tabelle `MonthLockAudit`, nicht in
  `TimeEntryAudit` (dessen Feld-Diff-Schema für ein Sperr-/Entsperr-Ereignis
  ohne einzelnen `TimeEntry`-Bezug nicht passt). Zweitens: nur die Rolle
  `member` ist von einer Sperre betroffen, wörtlich wie im Punkt-Text —
  manager/admin/owner können auch in gesperrten Monaten weiterhin schreiben.
  Sollte ein späterer Punkt (z.B. 8, Teamsicht) einen strengeren
  "wirklich niemand darf mehr schreiben"-Monatsabschluss brauchen, ist das
  eine bewusste Erweiterung dieser Entscheidung, keine Korrektur eines
  Fehlers. Ausserdem, methodisch: die serverseitige Durchsetzung
  (`assertMonthEditable` in den API-Routen) wurde separat vom UI-Zustand
  (deaktivierte Buttons) verifiziert — per direktem `fetch()` gegen die API
  unter Umgehung der UI —, um sicherzustellen, dass ein deaktivierter Button
  nicht die einzige Verteidigungslinie ist.
- Punkt 7: echter Bug beim eigenen Testen gefunden (nicht beim ersten
  Schreiben, sondern erst durch einen Testfall mit zwei absichtlich
  gleichnamigen Nutzern) — `scope=org` im ArG-Kontrollexport stürzte mit
  "Worksheet name already exists" ab, sobald zwei Mitarbeitende denselben
  Vor-/Nachnamen tragen. Für künftige Punkte relevant, die ebenfalls ein
  Workbook mit einem Sheet pro Person bauen (denkbar in Punkt 8, Teamsicht,
  falls dort auch ein Multi-Personen-Export entsteht): Sheetnamen müssen
  aktiv disambiguiert werden, Personennamen sind in einer echten
  Organisation KEIN verlässlich eindeutiger Schlüssel — dafür immer die
  `userId` oder eine andere technische ID heranziehen, nicht den
  Anzeigenamen. Ausserdem methodisch bestätigt: ein Testfall mit bewusst
  kollidierenden Fixture-Daten (hier: zwei Nutzer mit identischem Namen)
  deckte einen Bug auf, den ein Testfall mit "sauberen", eindeutigen
  Testnamen nie gefunden hätte — für Punkte mit ähnlichen Mehrpersonen-
  Aggregationen (Punkt 8, Punkt 9) lohnt sich mindestens ein Testfall mit
  bewusst uneindeutigen/kollidierenden Eingabedaten.
- Punkt 7, Scope-Entscheidung für später: `scope=person`/`scope=org` in den
  Export-Routen sind aktuell nur für admin/owner in der UI erreichbar
  (`/api/admin/team` als Personen-Quelle ist admin/owner-gated). Ein manager
  kann sein Team serverseitig zwar schon heute exportieren (`canSeeUser`
  erlaubt es, die Route prüft das korrekt), hat dafür aber noch keine
  UI-Personenliste. Das ist bewusst nicht in diesem Punkt nachgezogen worden
  — Punkt 8 (Teamsicht) baut ohnehin eine Team-Mitgliederliste für manager,
  die dann auch hier wiederverwendet werden kann, statt sie hier vorzeitig
  und isoliert zu duplizieren.
- Punkt 8: `wochenUebersicht()` (Punkt 7) mehrfach wiederverwendet statt
  einer zweiten/dritten fast identischen Funktion — jetzt Grundlage für
  ArG-Kontrollexport, Teamsicht-Heatmap UND Teamsicht-Prognose gleichzeitig.
  Wichtig für künftige Punkte, die ebenfalls eine wochenweise Aufschlüsselung
  brauchen: zuerst prüfen, ob `wochenUebersicht()` mit einem zusätzlichen
  Feld erweitert werden kann, bevor eine neue, eigene Wochen-Gruppierung
  entsteht — die Funktion mutiert dadurch zwar zu einem "Mehrzweck"-Rückgabe-
  typ mit Feldern, die nicht jeder Aufrufer braucht (ArG-Kontrollexport
  ignoriert `verrechnungsgrad`/`auslastung`, die Heatmap ignoriert
  `ueberzeit`), aber das ist der bewusst akzeptierte Kompromiss gegenüber
  drei separaten, garantiert irgendwann auseinanderdriftenden
  Wochen-Gruppierungen.
- Punkt 8, offene Lücke aus Punkt 7 nur TEILWEISE geschlossen: die
  serverseitige manager-Sichtbarkeit für Exporte ist jetzt vollständig
  (`/api/team`, `/api/export?scope=org` mit `restrictToUserIds`), aber
  `profile/page.tsx`s Personen-Picker für `scope=person`-Exporte nutzt
  weiterhin `/api/admin/team` (admin/owner-only) — ein manager kann also
  weiterhin nicht gezielt EIN einzelnes Teammitglied exportieren, nur das
  ganze Team auf einmal über die neue `/team`-Seite. Falls das für Punkt 9
  oder später gebraucht wird: `/api/team`s bereits vorhandene
  Sichtbarkeitsliste liesse sich leicht zu einem generischen
  „sichtbare Mitglieder"-Endpunkt für manager extrahieren, statt
  `/api/admin/team` nachträglich für manager zu öffnen (das ist bewusst
  weiterhin eine reine Verwaltungs-Route für admin/owner, siehe Kommentar
  dort).
- Punkt 8, Testmethodik: `lib/team-route.test.ts`s Fixture-Zeiteintrag
  musste bewusst auf ein Datum im ECHTEN aktuellen Monat gelegt werden
  (nicht auf ein beliebiges Zukunftsdatum wie in früheren Testfiles dieses
  Loops oft verwendet), weil `kennzahlen()` Einträge nach `heute` als
  `geplantZukunft` statt als `ist` zählt — ein zunächst rotgelaufener Test
  (`totals.ist` war 0) deckte das auf. Für künftige Tests, die reale
  „Ist"-Stunden über `kennzahlen()`/`teamKennzahlen()` prüfen wollen: das
  Testdatum muss immer vor dem tatsächlichen `new Date()`-Zeitpunkt der
  Testausführung liegen, nicht nur irgendein plausibles Kalenderdatum.
