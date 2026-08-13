# BUGS — Fehlersuche und Fixes nach dem Vision-Ausbau

Diese Datei ist der Arbeitsplan **und** der Fortschrittsstand für den Bugfix-Loop.
Sie ist die einzige Quelle der Wahrheit für den Loop.

## Regeln für jede Iteration

1. Nimm den **ersten** Punkt, dessen Box nicht abgehakt ist.
2. Behebe ihn **vollständig** — keine Teilstände.
3. Danach in dieser Reihenfolge:
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - Bei UI-relevanten Fixes zusätzlich: kurze Browser-Verifikation (Playwright,
     wie in BUILD.md Schritt 4–6 vorgemacht — Dev-Server starten, Flow durchklicken,
     Konsole/Server auf Fehler prüfen, danach Testdaten aufräumen)
   - `git add -A && git commit` mit aussagekräftiger Nachricht
4. Erst dann die Box abhaken (`- [ ]` → `- [x]`).
5. **Blockiert?** Schreib den Grund unter den Punkt als `> BLOCKER: …` und hör auf.
   Überspring den Punkt nicht und hak ihn nicht ab.
6. Alle Boxen abgehakt → Loop beenden.

**Kontext:** Next.js 14 + Prisma + lokale PostgreSQL (läuft). Login `John` / Code `1234`.
Der Server läuft **nicht** in UTC (Europe/Zurich) — das ist die Ursache mehrerer
Punkte hier. Vgl. BUILD.md, Abschnitt "Notizen des Loops", für die Vorgeschichte
und bereits gefixte Fälle desselben Bugs.

---

## Punkte

### - [x] 1. Timezone-Bug in bulk-apply/bulk-vacation beheben

Beide Dateien bauen `@db.Date`-Werte über lokale `Date`-Konstruktoren statt UTC —
derselbe Bug, der in `time-entries/route.ts`, `analytics/route.ts` und
`export/route.ts` bereits gefixt wurde (dort als Referenz-Pattern anschauen).
Auf einem Server mit TZ ≠ UTC verschiebt das Schreib- und Lesepfade um einen Tag.

**`app/api/time-entries/bulk-apply/route.ts`:**
- `parseDateYMD`: `new Date(y, mo - 1, d)` → `new Date(Date.UTC(y, mo - 1, d))`.
- `getTemplateHoursForDay`: `date.getDay()` → `date.getUTCDay()`.
- `existingMap`-Aufbau: `d.getFullYear()/getMonth()/getDate()` →
  `d.getUTCFullYear()/getUTCMonth()/getUTCDate()`.
- Tagesschleife: `key`/`dbDate` über UTC-Getter/`Date.UTC` bauen, Inkrement
  `current.setDate(...)` → `current.setUTCDate(...)`.

**`app/api/time-entries/bulk-vacation/route.ts`:** identisches Muster —
`parseDateYMD`, `existingMap`-Aufbau, Tagesschleife (inkl. `dayOfWeek` über
`getUTCDay()`). `getDailyRateForDate` selbst braucht **keinen Code-Change** —
sobald `current` UTC-Mitternacht ist, ist der Vergleich mit `change.effectiveFrom`
(auch `@db.Date`, also schon UTC-Mitternacht) bereits korrekt. Nur verifizieren.

**Verifizieren:** Zeitraum über einen DST-Wechsel (Ende Oktober/März) und über
einen Jahreswechsel; bestehende Ferien/Feiertage bleiben geschützt
(`skippedProtected`/`skipped`-Zähler unverändert); Pensumwechsel-Grenzfall in
bulk-vacation wählt weiterhin den richtigen Tarif.

---

### - [x] 2. Fehlende Ownership-Prüfung bei DELETE in time-entries/route.ts

`app/api/time-entries/route.ts`, `DELETE`-Handler: ruft `prisma.timeEntry.delete()`
direkt auf, ohne vorherigen `findFirst`-Ownership-Check (anders als der `PUT`-
Handler in derselben Datei und andere Routen wie `customers/route.ts` DELETE).
Bei fremder/ungültiger `id` wirft Prisma P2025 → generischer 500 statt sauberem 404.

**Fix:** `findFirst({ where: { id, userId } })` vor dem Delete ergänzen, bei
Fehlschlag `404` zurückgeben — Muster aus `customers/route.ts` DELETE übernehmen.

---

### - [x] 3. Datums-Validierung in time-entries POST/PUT härten

`app/api/time-entries/route.ts`, POST und PUT: `date: new Date(date)` ohne
Formatvalidierung. Aktuell sendet nur der Tagesdialog reine `"YYYY-MM-DD"`-Strings,
aber serverseitig verhindert nichts ein volles ISO-Datetime ohne Offset — das würde
lokal statt UTC interpretiert und den Timezone-Bug über einen dritten Pfad wieder
einschleppen.

**Fix:** Vor dem Schreiben mit einer `YYYY-MM-DD`-Regex validieren (wie
`parseDateYMD` in den bulk-Routen) und über `Date.UTC(...)` konstruieren. Bei
Nichtübereinstimmung `400 "Invalid date"` (bestehendes Verhalten beibehalten,
nur die Konstruktion UTC-sicher machen).

---

### - [x] 4. Sweep: Ownership-Check-Konsistenz über alle Routen

Grep über `app/api/**/route.ts` (customers, pensum-changes, overtime-payouts,
profile, profile/security-questions): für jede `update`/`delete`-Operation
prüfen, ob ein `findFirst`-Ownership-Check vorausgeht (wie in Punkt 2 gefixt).
Nur fixen, wo tatsächlich eine Lücke gefunden wird — kein Rewrite ohne Befund.
Funde als Unterpunkte hier ergänzen, bevor sie abgehakt werden.

**Ergebnis:** `customers`, `pensum-changes`, `overtime-payouts`,
`profile/security-questions`, `profile`, `profile/verify-code` — alle bereits
korrekt (Ownership-Check vorhanden bzw. Operation ist inhärent auf die eigene
`userId` aus der Session beschränkt, kein Client-Input-Trust).

**Aber gefunden — echter Account-Takeover-Bug (nicht nur Ownership-Konsistenz,
sondern eine fehlende Authentifizierung):** `app/api/auth/forgot-code/route.ts`,
Schritt 3 (Passwort zurücksetzen) rief `prisma.user.update({ where: { id: userId },
... })` auf, wobei `userId` roh aus dem Client-Body übernommen wurde — **ohne
erneute Prüfung**, dass die Sicherheitsfrage aus Schritt 2 tatsächlich korrekt
beantwortet wurde. Schritt 2 hinterlässt keinen serverseitigen Zustand; ein
Angreifer, der nur Vor-/Nachname eines Kontos kennt (Schritt 1 liefert die
`userId` dafür ohne jede Hürde), konnte Schritt 3 direkt aufrufen und das
Passwort ohne jede Sicherheitsfrage zurücksetzen.

**Fix:** Sicherheitsfragen-Prüfung in eine gemeinsame Helper-Funktion
(`hasCorrectAnswer`) extrahiert und in Schritt 3 **erneut** ausgeführt, bevor
das Passwort geändert wird (Schritt 3 verlangt jetzt `answers` im Body).
Frontend (`app/(auth)/forgot-code/page.tsx`) sendet die bereits im State
gehaltenen Antworten jetzt auch in Schritt 3 mit — keine UX-Änderung, der
Nutzer beantwortet die Frage weiterhin nur einmal in Schritt 2.

Verifiziert (Playwright): direkter Aufruf von Schritt 3 mit falschen/fehlenden
Antworten (Schritt 2 übersprungen) liefert jetzt `401`, Original-Passwort
bleibt unverändert; legitimer 3-Schritt-Flow über die echte UI funktioniert
weiterhin unverändert (Passwort wird geändert, neuer Code funktioniert, alter
nicht mehr); Zustand danach über denselben Flow wieder auf `1234` zurückgesetzt
und Login damit bestätigt.

---

### - [x] 5. Abschluss: Browser-Regressionspass

Einmaliger Playwright-Durchlauf über die von Punkt 1–4 betroffenen Flows:
Kalender → Standardwoche anwenden, Ferien eintragen (je über einen Jahreswechsel),
Tageseintrag löschen (eigene und — über die API direkt — fremde ID prüfen).
Sicherstellen, dass keine Regression entstanden ist. Kein Aufbau einer
Dauer-Testsuite (dafür gibt es keinen Auftrag) — punktuelle Verifikation wie in
BUILD.md Schritt 4–6.

**Ergebnis:** `npm run typecheck` und `npm test` grün. Playwright-Durchlauf
über die echte UI: Login; "Standardwoche anwenden" über einen Jahreswechsel
(28.12.2026–03.01.2027) erzeugt exakt die 5 korrekten Werktage, Wochenende
richtig übersprungen; "Ferien eintragen" (01.–05.02.2027) erzeugt alle 5
Werktage korrekt; Löschen des eigenen Eintrags über den Tagesdialog
funktioniert; Löschen einer ungültigen ID liefert weiterhin sauber `404`.
Keine Konsolen-/Serverfehler, keine Wechselwirkungen zwischen den vier Fixes
festgestellt. Testdaten aufgeräumt.

---

## Notizen des Loops

_(Hier trägt der Loop Blocker, Entscheidungen und Auffälligkeiten ein.)_

- Vorbereitung: Codebase-Recherche (Explore-Agent) hat den Rest der App als
  sauber bestätigt — keine alten englischen Typ-Strings mehr (work/vacation/
  holiday), Frontend-Fetches durchgängig defensiv (`res?.ok`-Checks), Fehler-
  behandlung in den meisten Routen konsistent (try/catch → 500, Session-Check
  zuerst). Es gibt praktisch keine automatisierte Testabdeckung außerhalb von
  `lib/calc.test.ts` (kein Playwright/Cypress im Repo, `vitest.config.ts`
  inkludiert nur `lib/**/*.test.ts`) — das ist bewusst **nicht** Teil dieser
  Checkliste (kein Auftrag dazu), aber eine Empfehlung für einen möglichen
  nächsten Loop, falls weiterhin nach Bugs gesucht werden soll.
- Punkt 1: Fix wie geplant umgesetzt (UTC-Getter/-Setter + `Date.UTC(...)` überall
  in `parseDateYMD`, Tagesschleife, `existingMap`-Aufbau, Wochentag-Lookup in
  beiden Dateien; `getDailyRateForDate` unverändert gelassen, da bereits korrekt
  sobald `current` UTC-Mitternacht ist). Verifiziert per Playwright/API:
  DST-Übergang Ende Oktober (23.–27.10.2026) landet auf den richtigen Tagen,
  Jahreswechsel (29.12.2026–04.01.2027) korrekt inkl. Wochenend-Skip, Feiertag-
  Schutz bleibt bei `overwriteExisting=true` bestehen, Pensumwechsel-Grenzfall
  (effectiveFrom-Tag selbst) wählt korrekt den neuen Tarif. Zusätzlich ein
  echter UI-Klickpfad ("Standardwoche anwenden" im Kalender) bestätigt.
  Keine Konsolen-/Serverfehler. Testdaten aufgeräumt.
- Punkt 2: `findFirst({ where: { id, userId } })` vor dem `delete` ergänzt, bei
  Fehlschlag `404`. Verifiziert per Playwright: Löschen über den Tagesdialog
  (echter UI-Klickpfad) funktioniert weiterhin wie zuvor; DELETE mit ungültiger
  ID liefert jetzt sauber `404 {"error":"Not found"}` statt vorher generischem
  `500` (Prisma P2025). Testdaten aufgeräumt.
- Punkt 3: `parseDateYMD`-Helper ergänzt (extrahiert nur den "YYYY-MM-DD"-Teil,
  baut via `Date.UTC(...)`, plus Kalender-Gültigkeitsprüfung z.B. gegen
  30. Februar) und in POST/PUT statt `new Date(date)` verwendet. Verifiziert
  per Playwright: normales Erstellen über den Tagesdialog funktioniert
  weiterhin; ein volles ISO-Datetime ("2026-08-11T23:30:00") landet jetzt
  korrekt auf dem 11.08. statt potenziell verschoben zu werden; malformte und
  kalendarisch ungültige Daten liefern sauber `400` (POST und PUT). Testdaten
  aufgeräumt.
