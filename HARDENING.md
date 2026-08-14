# HARDENING.md — Logik-, Test- und UX-Härtung

Diese Datei ist Arbeitsplan und Fortschrittsstand, gleiche Regeln wie
BUGS.md/MIGRATION.md. **Anders als dort: dieser Loop baut keine neuen
Features.** Ziel ist ausschliesslich, bestehende Logik zu verifizieren,
Testlücken zu schliessen und UI/UX zu begradigen. Wenn ein Punkt einen
echten Feature-Bedarf aufdeckt (nicht nur einen Bug), wird er unter
"Notizen des Loops" als Vorschlag für eine künftige Datei festgehalten,
nicht hier umgesetzt.

## Regeln für jede Iteration

1. Nimm den **ersten** Punkt, dessen Box nicht abgehakt ist.
2. Behebe ihn **vollständig** — keine Teilstände.
3. Danach in dieser Reihenfolge:
   - `npx prisma generate` (sonst falsche Typecheck-Fehler)
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - Bei DB-Änderungen: `npx prisma migrate dev` mit sprechendem Namen
   - Bei UI-Änderungen: Browser-Verifikation wie in BUILD.md Schritt 4–6
   - `git add -A && git commit` mit aussagekräftiger Nachricht
4. Erst dann die Box abhaken.
5. **Blockiert?** Grund als `> BLOCKER: …` unter den Punkt schreiben und aufhören.
6. Alle Boxen abgehakt → Loop beenden.

**Nicht anfassen ohne konkreten Befund:** Architektur- und Schema-
Entscheidungen aus MIGRATION.md (Organization/Membership, Soft-Delete,
Audit-Trail-Design, JWT-Sessions) gelten als gesetzt. Dieser Loop ändert
sie nur, wenn ein Punkt unten einen echten Fehler darin nachweist — nicht
aus stilistischer Präferenz.

**Referenzwerte, die nach JEDEM Punkt noch stimmen müssen** (Profil 40h,
60%, 25 Ferientage, Start 01.04.2026, Stichtag 12.08.2026):
- Sollstunden/Tag = 4.8
- Soll August bis 12.08. = 38.4, Soll August gesamt = 100.8
- Ferienanspruch 2026 = 18.8

---

## Teil A — Logik verifizieren

### - [x] A1. Referenzwerte und bekannte Grenzfälle nochmals gegenprüfen

Bevor irgendetwas Neues geprüft wird: alle vier Referenzwerte oben plus die
in MIGRATION.md dokumentierten Zusatztests (Pensumswechsel-Feriensaldo,
Austrittsdatum, Feiertags-Wochen) noch einmal isoliert laufen lassen und in
dieser Datei mit Datum bestätigen. Das ist die Baseline, gegen die alle
folgenden Punkte laufen.

### - [x] A2. Mehrfache Pensumsänderungen im selben Zeitraum

Bisher getestet: ein Wechsel pro Zeitraum. Neuer Testfall: zwei oder drei
`PensumChange`-Einträge innerhalb desselben Analyse-/Ferienzeitraums
(z.B. 100% → 80% → 60% je zum Monatsersten, Auswertung über das ganze
Quartal). Prüfen: `sollStundenTag`, `kennzahlen`, `feriensaldo` und
`teamKennzahlen` liefern für jeden einzelnen Tag den zum jeweiligen
Zeitpunkt gültigen Satz, nicht den letzten. Gleicher Test zusätzlich mit
einem Wechsel exakt auf den `gueltig_ab`-Tag selbst (Boundary).

### - [x] A3. Jahresübergänge und Kalenderrandfälle

- Ferienanspruch bei Eintritt/Austritt exakt am 31.12. bzw. 1.1.
- `wochenUebersicht`/Überzeit-Berechnung für eine Kalenderwoche, die über
  den Jahreswechsel läuft (KW 52/53 → KW 1)
- Schaltjahr: Sollstunden-Summe über Februar in einem Schaltjahr vs. nicht
- DST-Wechsel (letzter Sonntag März/Oktober) für `von`/`bis`-Zeiterfassung
  über Mitternacht — MIGRATION.md Punkt 1 hat das für bulk-apply/
  bulk-vacation gefixt, hier gezielt für die reguläre Tageserfassung
  nachprüfen

### - [x] A4. Verrechnungsgrad und Teamkennzahlen bei Randfällen

- Person ohne jeden Eintrag im Zeitraum → `verrechnungsgrad` darf nicht
  NaN/Infinity werfen (Division durch 0 bei `ist = 0`)
- Projekt ohne `hourlyRate` und Kunde ohne `hourlyRate` gleichzeitig →
  Umsatzberechnung in der Teamsicht muss sauber 0 zeigen, nicht crashen
  oder `null` in eine Summe einrechnen
- Budget exakt erreicht (nicht überschritten) → Grenzfall der
  Hervorhebung in der Teamsicht prüfen
- Manager mit null direkt unterstellten Personen → `/team` und
  `/api/absence-requests?scope=team` dürfen nicht crashen, sondern leere
  Listen zeigen

### - [ ] A5. Compliance-Prüfung an echten Mehrfach-Eintrags-Tagen

`pruefeCompliance` wurde primär mit einem Eintrag pro Tag getestet. Neuer
Testfall: zwei `arbeit`-Einträge am selben Tag (z.B. Vormittag/Nachmittag
mit längerer Mittagspause dazwischen erfasst als Lücke statt als
`pauseMin`) — prüfen, ob die Pausenregel korrekt die Lücke zwischen den
Einträgen erkennt oder ob sie nur `pauseMin` einzeln pro Eintrag anschaut
und die Lücke ignoriert. Das ist ein plausibles echtes Nutzungsmuster
(Vormittag ein Kunde, Nachmittag ein anderer, zwei separate Einträge) und
könnte falsche oder fehlende Warnungen erzeugen.

### - [ ] A6. Monatssperre und Absenzgenehmigung im Zusammenspiel

Ein Antrag wird gestellt, bevor der Monat gesperrt wird, aber erst
genehmigt, nachdem admin ihn gesperrt hat. Was passiert?
`createAbsenceEntries` sollte entweder die Sperre respektieren und den Tag
überspringen (wie bei bulk-vacation) oder die Genehmigung explizit
ablehnen — aktuell ist unklar, welches der beiden Verhalten implementiert
ist. Klären, testen, falls nötig minimal fixen (kein neues Feature, nur
damit sich Sperre und Genehmigung nicht widersprechen).

---

## Teil B — Testlücken schliessen

### - [ ] B1. Coverage-Bericht erstellen und Lücken auflisten

`npx vitest run --coverage`. Ergebnis in dieser Datei als Liste der Dateien
mit auffällig niedriger Coverage in `lib/` und `app/api/` festhalten —
nicht direkt fixen, erst Bestandsaufnahme.

### - [ ] B2. Ungetestete Fehlerpfade in kritischen Routen

Fokus auf `time-entries`, `absence-requests`, `month-locks`, `team`,
`export/*`: für jede Route prüfen, ob es einen Test für den jeweils
"unglücklichen" Pfad gibt (fehlende Berechtigung, ungültige ID, fremde
Org-Ressource referenziert, gesperrter Monat, doppelte Anfrage). Fehlende
Fälle ergänzen. Kein Rewrite bestehender Tests ohne Befund.

### - [ ] B3. Property-basierter Test für sollStundenTag

Ein Vitest-Test, der `sollStundenTag` über einen langen zufälligen
Zeitraum (z.B. 5 Jahre) mit zufälligen Pensumsänderungen laufen lässt und
nur invariante Eigenschaften prüft: nie negativ, nie über 24h/Tag, Summe
über eine volle Woche mit konstantem Pensum entspricht exakt
`wochenstunden * pensum / 100`. Das fängt Klassen von Bugs, die einzelne
Beispieltests verfehlen.

### - [ ] B4. Lasttest für Teamsicht und Exporte

`/api/team` und `/api/export?scope=org` mit einer Organisation mit
50+ Mitgliedern und mehreren tausend TimeEntries seeden (nur lokal, über
ein Skript, nicht in `scripts/seed.ts` fest einbauen) und Antwortzeit
prüfen. Kein Performance-Feature bauen — nur feststellen, ob es im
akzeptablen Bereich bleibt oder ob ein N+1-Query-Problem sichtbar wird.
Befund dokumentieren, nur bei klarem N+1 minimal fixen (z.B. fehlendes
`include` statt Schleife mit Einzelqueries).

---

## Teil C — UI/UX-Begehung

Für jeden Punkt: mit Playwright durch die echte UI klicken, nicht nur den
Code lesen. Für jede Rolle (member, manager, admin, owner) einmal.

### - [ ] C1. Konsistenz-Pass über alle Seiten

Kalender, Analytics, Team, Absenzen, Admin/Team, Admin/Feiertage,
Admin/Legal, Profil: Abstände, Kartenstile, Button-Grössen, Formular-Layout,
Farbverwendung für Status (offen/genehmigt/abgelehnt, gesperrt/offen,
Compliance-Warnung) auf Einheitlichkeit prüfen. Abweichungen notieren und
nur die auffälligsten (nicht jede Pixel-Differenz) beheben.

### - [ ] C2. Mobile-Tauglichkeit

Jede Seite bei 375px Breite (iPhone SE) durchklicken: Tagesdialog, Team-
Tabelle, Heatmap, Feiertags-Admin, Exporte. Tabellen mit vielen Spalten
(Team-Übersicht) sind der wahrscheinlichste Bruchpunkt — horizontales
Scrollen oder Karten-Layout als Fix, je nachdem was mit den vorhandenen
Tailwind-Klassen am wenigsten Aufwand macht.

### - [ ] C3. Leere Zustände

Für jede Liste/Tabelle in der App (Team, Absenzanträge, Feiertage,
Kunden, Projekte, Pensumsänderungen, Überstunden-Auszahlungen,
Monatssperren): gibt es einen sinnvollen leeren Zustand mit Erklärung, was
zu tun ist, oder nur eine leere Tabelle bzw. "undefined"? Neue Organisation
frisch registrieren und systematisch durchklicken, bevor irgendwelche
Testdaten existieren — das ist die reale erste Erfahrung eines Kunden.

### - [ ] C4. Fehler- und Ladezustände

Für die wichtigsten Mutationen (Zeiteintrag speichern, Absenzantrag stellen,
Einladung senden, Passwort ändern): Netzwerkfehler simulieren (z.B. Server
kurz stoppen oder eine Route absichtlich 500 werfen lassen) und prüfen, ob
die UI eine verständliche Fehlermeldung zeigt statt zu hängen oder still zu
scheitern. Ladezustände (Skeleton/Spinner) bei langsamen Requests (Team-
Übersicht mit vielen Mitgliedern, Export-Download) prüfen.

### - [ ] C5. Onboarding-Flow als Aussenstehender

Kompletter Durchlauf ohne jedes Vorwissen: Registrierung → Firma anlegen →
erste Einladung verschicken → als eingeladene Person Passwort setzen →
ersten Zeiteintrag erfassen → ersten Kunden/Projekt anlegen. An jeder
Stelle notieren, wo ein Schritt unklar ist, ein Text fehlt oder etwas nicht
selbsterklärend ist — das ist die kritischste einzelne Prüfung für ein
Produkt, das ohne Schulung funktionieren soll. Konkrete kleine Text-/
Label-Fixes direkt umsetzen, grössere Onboarding-Konzepte (z.B. ein
geführter Schritt-für-Schritt-Wizard) nur als Vorschlag notieren, nicht
bauen.

### - [ ] C6. Barrierefreiheit-Basics

Tab-Reihenfolge durch Kalender-Tagesdialog und die Formulare in Admin/Team
und Admin/Feiertage; Formularfelder haben `label`/`aria-label`; Farbe ist
nirgends der einzige Träger von Information (Compliance-Warndreieck hat
Text-Tooltip — prüfen, ob auch Status-Badges wie "gesperrt"/"offen" Text
und nicht nur Farbe zeigen). Kein volles WCAG-Audit, nur die
offensichtlichen Lücken.

### - [ ] C7. Verdichtung: Listen zu Übersichten machen

Symptom (belegt per Screenshot, Absenzen-Seite): der Team-Kalender rendert
eine Zeile pro Tag pro Person. Eine Ferienwoche einer Person erzeugt fünf
optisch identische Zeilen; drei Personen mit Sommerferien füllen mehrere
Bildschirmseiten, ohne mehr Information zu tragen als ein Block von drei
Zeilen. Zusätzlich trägt jede Zeile ein rotes Warndreieck, weil bei einem
3er-Team eine abwesende Person bereits die 30%-Schwelle aus MIGRATION.md
Punkt 9 überschreitet — die Warnung ist dadurch bedeutungslos.

**C7a — Warnschwelle korrigieren.** In `app/api/absences/calendar/route.ts`
die Schwelle um eine absolute Untergrenze ergänzen: gewarnt wird nur, wenn
mindestens 2 Personen gleichzeitig abwesend sind UND der Anteil ≥30% der
sichtbaren Mitglieder beträgt. Eine einzelne abwesende Person ist nie eine
Warnung, egal wie klein das Team ist. Tests in
`lib/absence-requests.test.ts` entsprechend anpassen (der bestehende
Schwellentest deckt aktuell genau den falschen Fall ab).

**C7b — Zusammenhängende Tage gruppieren.** Aufeinanderfolgende Tage
derselben Person mit demselben Absenztyp zu einem Bereich zusammenfassen
("13.–17.07. · Stefan Büttler · Ferien · 5 Tage"). Wochenenden und
Feiertage brechen einen Bereich nicht auf, wenn die Absenz darüber
hinweggeht. Reine Anzeigelogik — als testbare Funktion in
`lib/absence-ranges.ts`, nicht in der Komponente.

**C7c — Team-Kalender als Raster statt Liste.** Die Ansicht heisst
"Kalender", ist aber eine Datumsliste. Auf dasselbe Muster umstellen, das
die Teamsicht-Heatmap aus MIGRATION.md Punkt 8 bereits verwendet: Personen
als Zeilen, Tage des Monats als Spalten, Zellen nach Absenztyp eingefärbt,
Tage über der Warnschwelle als Spalte hervorgehoben. Legende für die
Farben, da Farbe sonst alleiniger Informationsträger wäre (siehe C6). Auf
Mobile (C2) horizontal scrollbar oder auf Wochen statt Tage reduziert.

**C7d — Gleiches Muster in der ganzen App suchen.** Systematisch prüfen,
wo sonst pro Datensatz eine volle Karte/Zeile gerendert wird, obwohl eine
verdichtete Darstellung dieselbe Information trägt: Pensumsänderungen und
Monatssperren in `/admin/team`, Feiertagsliste in `/admin/holidays`,
Kunden- und Projektliste im Profil, Überstunden-Auszahlungen. Kriterium:
Braucht eine Zeile mehr als eine Zeile Höhe, obwohl sie nur zwei bis drei
Werte trägt? Dann verdichten.

**C7e — Leere Zustände verdichten.** Eine volle Karte für "Keine Anträge
gestellt" ist Platzverschwendung. Leere Listen als eine Textzeile innerhalb
der bestehenden Karte darstellen, nicht als eigene Karte mit Titel,
Padding und Schatten. Betrifft dieselben Stellen wie C3.

**C7f — Monatsauswahl lokalisieren.** `<input type="month">` zeigt den
Monatsnamen in der Browsersprache ("July 2026" in einer deutschen UI).
Entweder durch zwei eigene Selects (Monat/Jahr, wie in Analytics bereits
vorhanden) ersetzen oder konsistent überall dasselbe native Feld
verwenden — aktuell ist beides gemischt. Konsistenz zählt hier mehr als
die konkrete Wahl.

---

## Notizen des Loops

_(Hier trägt der Loop Blocker, Entscheidungen, Auffälligkeiten und
Vorschläge für künftige Feature-Punkte ein — letztere ausdrücklich NICHT
in diesem Loop umsetzen.)_

### Vorbereitung — 14.08.2026

`npm install` bricht ohne `--legacy-peer-deps` ab: `@typescript-eslint/
eslint-plugin@7.0.0` verlangt als Peer `@typescript-eslint/parser@^6`,
installiert ist `parser@7.0.0`. Bereits bekannt und in `Dockerfile:15-16`
dokumentiert, dort wird `npm ci --legacy-peer-deps` verwendet. Diese
Konvention wurde hier übernommen; der Konflikt selbst wurde nicht
angefasst (Build-Konfiguration, kein Befund aus einem Punkt dieser Datei).

> Vorschlag für eine künftige Datei: `@typescript-eslint/eslint-plugin` und
> `-parser` auf ein zusammenpassendes Paar heben (beide `^7.18`), damit
> `npm install`/`npm ci` ohne Flag durchlaufen.

### A1 — Baseline bestätigt, 14.08.2026

Alle vier Referenzwerte und alle drei MIGRATION.md-Zusatztests laufen grün.
Isoliert ausgeführt (`npx vitest run lib/calc.test.ts -t "…"`), kein
Code-Change nötig.

| Referenzwert | Erwartet | Test | Ergebnis |
|---|---|---|---|
| Sollstunden/Tag | 4.8 | `lib/calc.test.ts:24` | ✓ |
| Soll August bis 12.08. | 38.4 | `lib/calc.test.ts:28` | ✓ |
| Soll August gesamt | 100.8 | `lib/calc.test.ts:42` | ✓ |
| Ferienanspruch 2026 | 18.8 | `lib/calc.test.ts:56` | ✓ |

Zusatztests aus MIGRATION.md:

| Zusatztest | Ort | Ergebnis |
|---|---|---|
| Pensumswechsel-Feriensaldo | `lib/calc.test.ts:415` | ✓ 3/3 |
| Austrittsdatum (`exitDate`) | `lib/calc.test.ts:145` | ✓ 5/5 |
| Feiertags-Wochen | `lib/calc.test.ts:474` | ✓ 7/7 |

Gesamtlauf als Baseline für alle folgenden Punkte: **`npm test` →
15 Dateien, 190 Tests, alle grün. `npm run typecheck` sauber.**
(Der `Healthcheck failed: connection refused`-Stacktrace im Testlauf ist
die erwartete Konsolenausgabe des absichtlichen Fehlerpfad-Tests in
`lib/health.test.ts`, kein Fehlschlag.)

### A2 — Mehrfache Pensumsänderungen, 14.08.2026

Befund: die Auflösung selbst war korrekt. `pensumAt` (`lib/calc.ts:137`)
wählt aus ALLEN Changes den spätesten mit `effectiveFrom <= datum`, mehrere
Wechsel im selben Zeitraum funktionieren also strukturell, und der
Wechseltag selbst zählt bereits neu. Kein Fix nötig — die Lücke war eine
Test-Lücke, nicht ein Rechenfehler. Neu abgesichert (100% → 80% → 60% je
zum Monatsersten, Auswertung über Q2 2026, Soll 416h):
`sollStundenTag`, `kennzahlen`, `feriensaldo`, `teamKennzahlen`, Boundary
auf `effectiveFrom`, unsortiertes Changes-Array.

**Eine echte Lücke gefunden und geschlossen:** `PensumChange` hat kein
`@@unique([userId, effectiveFrom])` (`prisma/schema.prisma:35-48`), zwei
Changes auf denselben Tag sind also möglich (z.B. eine Korrektur). Bei
Gleichstand entschied `pensumAt` per `>` für den ZUERST übergebenen
Eintrag — das Ergebnis hing damit von der Array-Reihenfolge ab, ohne dass
die Funktion dazu etwas zusagte. Auf `>=` geändert: der zuletzt übergebene
gewinnt. Das deckt sich mit `getDailyRateForDate` in
`lib/absence-entries.ts:52-58` (überschreibt in Schleifenreihenfolge) und
mit dem `orderBy: { effectiveFrom: "asc" }` aller acht Aufrufer, bei dem
der später angelegte Eintrag hinten steht.

**Zweite Implementierung derselben Regel angebunden statt entfernt:**
`createAbsenceEntries` löst das Pensum in `getDailyRateForDate` selbst auf,
statt `pensumAt` zu benutzen. Ein Vergleich beider über einen Zeitraum mit
zwei Wechseln zeigt keine Abweichung — die Duplikation wurde deshalb NICHT
angefasst (kein Befund = kein Eingriff), aber durch
`lib/absence-entries.test.ts` aneinandergebunden: jeder erzeugte Eintrag
wird gegen `sollStundenTag` geprüft, ein künftiges Auseinanderdriften
bricht damit den Test.

Stand nach A2: 16 Dateien, 201 Tests, typecheck sauber.

> **Befund ausserhalb von A2 — Absenzen an Feiertagen.**
> `createAbsenceEntries` kennt die `Holiday`-Tabelle nicht (kein
> Holiday-Query, kein `holidays`-Parameter), und nichts im Code
> materialisiert Feiertage als `feiertag`-TimeEntries — der Skip in
> `lib/absence-entries.ts:102` greift nur, wenn jemand einen solchen
> Eintrag von Hand angelegt hat. Eine genehmigte Ferienwoche über einen
> Feiertag erzeugt daher am Feiertag einen `ferien`-Eintrag mit vollen
> Stunden, während `sollStundenTag` für denselben Tag 0 liefert
> (`lib/calc.ts:182-183`). Folge in `kennzahlen`: die Stunden zählen ins
> `ist`, das `soll` ist 0 → Phantom-Überstunden in Höhe eines Tagessolls
> je Feiertag. Der Feriensaldo bleibt korrekt (`tagesSoll > 0 ? … : 0`,
> `lib/calc.ts:486`), der Ferientag wird also nicht doppelt abgezogen.
> Gehört zu keinem Punkt dieser Datei — als eigener Punkt nachzutragen,
> hier bewusst nicht gefixt.

### A3 — Kalenderrandfälle, 14.08.2026

Alle vier Bereiche geprüft, **kein Rechenfehler gefunden**. Die
UTC-Arithmetik in `lib/calc.ts` (`toUTCDate`, `montagDerWoche` per
`setUTCDate`, `summeSollstunden` tageweise) trägt alle Randfälle. 13 neue
Tests halten das fest:

| Randfall | Ergebnis |
|---|---|
| Ferienanspruch Eintritt 01.01. | 25 (voll) ✓ |
| Ferienanspruch Eintritt 31.12. | 2.1 (25/12) ✓ |
| Eintritt 31.12. des Vorjahres | 25 im Folgejahr ✓ |
| KW 53/2026 → KW 1/2027 (Mo 28.12.–So 03.01.) | eine Woche, 50h, 5h Überzeit ✓ |
| Schaltjahr Februar 2028 (21 Werktage) vs. 2026 (20) | 168h vs. 160h ✓ |
| 29.02.2028 als normaler Werktag | 8h ✓ |
| DST-Sonntage 29.03./25.10.2026 | kein Datumsversatz ✓ |
| Nachtschicht 22:00–06:00 an beiden Umstellungstagen | 7.5h wie an jedem anderen Tag ✓ |

Zwei bewusst festgehaltene Ist-Verhalten (je mit einem Test dokumentiert,
kein Fix in diesem Loop):

**1. `exitDate` kürzt den Ferienanspruch nicht.** `feriensaldo`
(`lib/calc.ts:465-470`) kürzt anteilig nur bei EINTRITT im Abfragejahr;
`profil.exitDate` geht in den Anspruch gar nicht ein. Wer am 31.01.2026
austritt, hat für 2026 den vollen Anspruch von 25 Tagen. Das ist eine
fehlende Regel, kein Rechenfehler — `sollStundenTag` respektiert `exitDate`
korrekt (MIGRATION.md Punkt 4d), nur die Anspruchsformel kennt es nicht.

> Vorschlag für eine künftige Datei: Ferienanspruch bei Austritt analog zum
> Eintritt anteilig kürzen (`ferientage * austrittsMonat / 12`), inkl. des
> Falls Eintritt UND Austritt im selben Jahr.

**2. Nachtschichten über den DST-Wechsel werden als Wanduhrzeit gerechnet.**
`stundenAusEintrag` (`lib/calc.ts:178-191`) rechnet auf Minuten aus den
`von`/`bis`-Strings, ohne Zeitzone. Eine Schicht 22:00–06:00 in der Nacht
auf den Frühjahrswechsel dauert real 6.5h, wird aber wie überall mit 7.5h
gutgeschrieben (im Herbst umgekehrt 8.5h real). Das ist konsistent und
deterministisch, aber nicht die real geleistete Zeit. Eine Korrektur
bräuchte eine Zeitzone pro Organisation und damit ein Schema-Feld — laut
Vorwort dieser Datei ohne konkreten Befund nicht zu bauen.

> Vorschlag für eine künftige Datei: Organisation um eine Zeitzone
> erweitern und `stundenAusEintrag` an den beiden Umstellungstagen die real
> verstrichene Zeit rechnen lassen. Betrifft nur Betriebe mit Nachtarbeit.

Stand nach A3: 16 Dateien, 214 Tests, typecheck sauber.

### A4 — Randfälle Verrechnungsgrad/Teamkennzahlen, 14.08.2026

Alle vier Randfälle waren bereits korrekt behandelt — **kein Fix nötig**,
aber keiner war getestet. Fünf neue Tests schreiben sie fest:

| Randfall | Ist-Verhalten | Wo abgesichert |
|---|---|---|
| Person ohne jeden Eintrag (`ist = 0`) | `verrechnungsgrad` 0 statt NaN (`lib/calc.ts:278`), alle Felder endlich, Soll bleibt stehen, `ueberstunden` negativ | `lib/calc.test.ts` |
| Projekt UND Kunde ohne `hourlyRate` | Fallback Projekt → Kunde → 0 (`app/api/team/route.ts:131`, `:150`), Umsatz 0, kein `null` in einer Summe | `lib/team-route.test.ts` |
| Budget exakt erreicht (4h von 4h) | `ueberzogen: stunden > budgetHours` ist strikt grösser (`app/api/team/route.ts:140`) → nicht markiert | `lib/team-route.test.ts` |
| Manager ohne direkt unterstellte Personen | `/api/team` liefert 200 und nur die Person selbst; `/api/absence-requests?scope=team` liefert 200 mit leerer Liste (Selbstausschluss in `route.ts:54-56` führt zu `in: []`) | `lib/team-route.test.ts` |

Der Manager-Fall ist bemerkenswert, weil er nicht das ist, was der Punkt
erwartet hat: ein manager ohne Berichte sieht in `/team` **nicht** eine
leere Liste, sondern genau sich selbst — `listVisibleUserIds` schliesst die
anfragende Person immer ein. Die Genehmigungs-Warteschlange ist dagegen
korrekt leer, weil sie den eigenen Antrag ausschliesst. Beides ist
sinnvoll und crasht nicht; als Ist-Verhalten festgeschrieben.

Stand nach A4: 16 Dateien, 219 Tests, typecheck sauber.
