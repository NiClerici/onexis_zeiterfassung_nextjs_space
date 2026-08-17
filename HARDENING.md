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

### - [x] A5. Compliance-Prüfung an echten Mehrfach-Eintrags-Tagen

`pruefeCompliance` wurde primär mit einem Eintrag pro Tag getestet. Neuer
Testfall: zwei `arbeit`-Einträge am selben Tag (z.B. Vormittag/Nachmittag
mit längerer Mittagspause dazwischen erfasst als Lücke statt als
`pauseMin`) — prüfen, ob die Pausenregel korrekt die Lücke zwischen den
Einträgen erkennt oder ob sie nur `pauseMin` einzeln pro Eintrag anschaut
und die Lücke ignoriert. Das ist ein plausibles echtes Nutzungsmuster
(Vormittag ein Kunde, Nachmittag ein anderer, zwei separate Einträge) und
könnte falsche oder fehlende Warnungen erzeugen.

### - [x] A6. Monatssperre und Absenzgenehmigung im Zusammenspiel

Ein Antrag wird gestellt, bevor der Monat gesperrt wird, aber erst
genehmigt, nachdem admin ihn gesperrt hat. Was passiert?
`createAbsenceEntries` sollte entweder die Sperre respektieren und den Tag
überspringen (wie bei bulk-vacation) oder die Genehmigung explizit
ablehnen — aktuell ist unklar, welches der beiden Verhalten implementiert
ist. Klären, testen, falls nötig minimal fixen (kein neues Feature, nur
damit sich Sperre und Genehmigung nicht widersprechen).

---

## Teil B — Testlücken schliessen

### - [x] B1. Coverage-Bericht erstellen und Lücken auflisten

`npx vitest run --coverage`. Ergebnis in dieser Datei als Liste der Dateien
mit auffällig niedriger Coverage in `lib/` und `app/api/` festhalten —
nicht direkt fixen, erst Bestandsaufnahme.

### - [x] B2. Ungetestete Fehlerpfade in kritischen Routen

Fokus auf `time-entries`, `absence-requests`, `month-locks`, `team`,
`export/*`: für jede Route prüfen, ob es einen Test für den jeweils
"unglücklichen" Pfad gibt (fehlende Berechtigung, ungültige ID, fremde
Org-Ressource referenziert, gesperrter Monat, doppelte Anfrage). Fehlende
Fälle ergänzen. Kein Rewrite bestehender Tests ohne Befund.

### - [x] B3. Property-basierter Test für sollStundenTag

Ein Vitest-Test, der `sollStundenTag` über einen langen zufälligen
Zeitraum (z.B. 5 Jahre) mit zufälligen Pensumsänderungen laufen lässt und
nur invariante Eigenschaften prüft: nie negativ, nie über 24h/Tag, Summe
über eine volle Woche mit konstantem Pensum entspricht exakt
`wochenstunden * pensum / 100`. Das fängt Klassen von Bugs, die einzelne
Beispieltests verfehlen.

### - [x] B4. Lasttest für Teamsicht und Exporte

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

### - [x] C1. Konsistenz-Pass über alle Seiten

Kalender, Analytics, Team, Absenzen, Admin/Team, Admin/Feiertage,
Admin/Legal, Profil: Abstände, Kartenstile, Button-Grössen, Formular-Layout,
Farbverwendung für Status (offen/genehmigt/abgelehnt, gesperrt/offen,
Compliance-Warnung) auf Einheitlichkeit prüfen. Abweichungen notieren und
nur die auffälligsten (nicht jede Pixel-Differenz) beheben.

### - [x] C2. Mobile-Tauglichkeit

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

### Teil C — Vorbereitung, 17.08.2026

`npm run seed` existiert nicht als npm-Skript — `"seed"` in `package.json`
steht unter dem `"prisma"`-Objekt (Konvention für `npx prisma db seed`),
nicht unter `"scripts"`. Geseedet mit `npx tsx --require dotenv/config
scripts/safe-seed.ts` direkt. Dev-Server lokal auf Port 3000 gestartet,
vier Playwright-Kontexte für member/manager/admin/owner mit den
Seed-Zugangsdaten aus `scripts/seed.ts` (z.B. `admin@onexis.test` /
`onexisAdmin123`).

### C7f — vorgezogen während C1 gefunden und bereits erledigt, 17.08.2026

Beim Screenshot-Vergleich über alle Rollen (C1) fiel die Monatsauswahl auf,
bevor C1 selbst etwas dazu zu vermelden hatte — die Notiz gehört inhaltlich
zu C7f, wird deshalb hier und nicht unter C1 festgehalten.

**Korrektur der Prämisse in C7f:** Der Punkt unterstellt, Analytics verwende
bereits das Zwei-Selects-Muster. Stimmt nicht — `analytics/page.tsx:129`
nutzte bis eben dasselbe native `<input type="month">` wie `absences/
page.tsx:248`, `team/page.tsx:190` und `profile/page.tsx:905` (vier
Stellen, alle nativ). Das Zwei-Selects-Muster (Monat-`<select>` mit
`t('month.N')` + Jahres-`<input type="number">`) existierte tatsächlich nur
im Lohnexport-Block auf der Profilseite. „Gemischt" stimmte also, nur die
Zuordnung im Punkt war vertauscht.

**Warum das native Feld der eigentliche Fehler war, nicht nur eine
Stilfrage:** ein `<input type="month">` rendert den Monatsnamen in der
Sprache des BROWSERS, nicht der App. Diese App ist durchgehend Deutsch und
hat keinen Sprachumschalter (`lib/i18n.tsx` ist ein einzelnes hartcodiertes
Wörterbuch) — ein Nutzer mit englischem oder französischem Browser/OS sähe
in einer sonst komplett deutschen Oberfläche plötzlich "October 2026" oder
"octobre 2026". Reproduziert: Playwright-Kontext mit `locale: "en-US"`,
Analytics-Seite, Monat auf 10 gestellt → vorher wäre "October" erschienen,
mit dem Fix zeigt die ausgewählte `<option>` weiterhin "Oktober" (per
`page.locator('select[aria-label="Monat"]').locator('option:checked')`
verifiziert).

**Entscheidung:** alle fünf Stellen (die vier nativen plus der bisherige
Lohnexport-Sonderfall) auf eine neue gemeinsame Komponente
`components/ui/month-year-picker.tsx` vereinheitlicht — Monat-`<select>` +
Jahres-`<input type="number">`, exakt das vorher nur im Lohnexport genutzte
Muster, jetzt an einer Stelle definiert statt fünfmal (einmal dupliziert,
viermal nativ). `value`/`onChange` bleiben beim bisherigen `"YYYY-MM"`-
String, keine der aufrufenden Seiten musste ihre sonstige Logik ändern.
Der Lohnexport-Block behält seine getrennten `payrollMonth`/`payrollYear`-
Zahlen-States (die Query-Params brauchen sie einzeln), nur die Darstellung
läuft jetzt über dieselbe Komponente.

**Bewusst NICHT angefasst:** das Monatssperre-Formular in
`app/(app)/admin/team/page.tsx:400-416` verwendet ebenfalls Select+Number,
aber in einer anderen Anordnung (Jahr zuerst, mit sichtbaren Labels über
je einem Grid-Feld statt einer kompakten Toolbar-Zeile) und hat NICHT den
Lokalisierungsfehler (nutzt bereits `t('month.N')` in einem `<select>`).
Andere Anordnung ist hier eine begründete Formular-Entscheidung (Admin-
Aktion mit Labels), keine Instanz derselben Inkonsistenz — der Umbau auf
`MonthYearPicker` hätte die sichtbaren Feldlabels gekostet, ohne einen
echten Fehler zu beheben.

Committet vor C1, da vollständig eigenständig verifizierbar
(`npm run typecheck`, `npm test`, Playwright mit `en-US`-Locale). Die Box
zu C7 bleibt trotzdem offen, bis C7a–e ebenfalls erledigt sind — C7 ist im
Dateikopf EIN Punkt, keine sechs.

### C1 — Konsistenz-Pass, 17.08.2026

Playwright-Screenshots von Kalender, Analytics, Team(sicht), Absenzen,
Admin/Team, Admin/Feiertage, Admin/Legal, Profil — für member, manager,
admin, owner, alle vier bei 1440×900. **Keine Konsolenfehler in keiner
Rolle auf keiner Seite** (`page.on("console"/"pageerror")` über alle 32
Kombinationen mitgeschnitten).

Ergebnis: durchgehend konsistent. Alle Karten `bg-card rounded-2xl p-4`
(bzw. `p-6`) mit `boxShadow: var(--shadow-sm)`/`var(--shadow-md)`, ein
einziger Blauton als Primäraktion (`bg-primary`/`bg-blue-500`-Familie),
Formularfelder durchgehend `bg-secondary rounded-xl`. Statusfarben folgen
einem Muster über die ganze App: Grün = positiv/aktiv/genehmigt, Rot =
negativ/abgelehnt/Warnung/überzogen, Gelb/Orange als Zwischenstufe
(`app/(app)/team/page.tsx:79-82` Auslastungs-Heatmap-Skala,
`app/(app)/absences/page.tsx:38-40` Antragsstatus, `app/(app)/admin/
team/page.tsx:309` Mitgliedschaftsstatus). Rollenbasierte Navigation
korrekt: manager sieht "Teamsicht" (scoped auf die eigenen Berichte) aber
nicht "Team"/"Feiertage"/"Rechtliches" (admin/owner-only), member sieht
nur Kalender/Absenzen/Analytics/Profil — in keinem Fall ein Rest der
verwehrten Navigation oder ein kaputter Redirect.

**Einziger echter Fund:** die Monatsauswahl, fünf verschiedene
Implementierungen derselben Interaktion — bereits als C7f behoben (siehe
oben, vorgezogen). Keine weiteren Abweichungen, die einen Fix
rechtfertigen; explizit nicht jede Pixel-Differenz gejagt, wie im Punkt
verlangt.

Stand nach C1: 17 Dateien, 288 Tests, typecheck sauber (unverändert
gegenüber B4 — C1 selbst hat ausser der bereits committeten C7f-Arbeit
keinen Code-Fix ausgelöst).

### C2 — Mobile-Tauglichkeit bei 375px, 17.08.2026

Automatisierte Überprüfung statt manuellem Durchklicken: ein Playwright-Skript
misst `document.documentElement.scrollWidth` bei 375px Viewportbreite auf
allen acht Seiten und listet zusätzlich jedes einzelne Element, dessen
eigener `scrollWidth` den Viewport überschreitet — das findet auch
Überläufe, die keine sichtbare horizontale Scrollbar erzeugen (z.B. ein
`fixed`-positioniertes Element, dessen Inhalt einfach über den Rand hinaus
verschwindet, ohne dass die Seite selbst scrollt).

**Zwei echte Befunde, beide gefixt:**

1. **Bottom-Nav für owner/admin nicht vollständig erreichbar.** 8 Tabs
   (Kalender/Absenzen/Analytics/Profil/Teamsicht/Team/Feiertage/Rechtliches)
   in einer `justify-around`-Leiste ohne Scroll-Möglichkeit ergaben ~536px
   Breite in 375px Viewport — "Feiertage" lief über den rechten Rand,
   "Rechtliches" war komplett unerreichbar (kein Fehler in
   `document.scrollWidth`, weil `fixed inset-x-0` das nicht durchreicht,
   aber ein echter Redirect-freier Dead End für die Navigation). Fix in
   `app/(app)/layout.tsx`: `overflow-x-auto` auf die Tab-Leiste, dasselbe
   Muster, das die Team-Tabelle bereits für ihre Spalten verwendet.
   `justify-around` bleibt für die kurzen Tab-Listen (member: 4, manager: 5)
   erhalten, nur ab mehr als 5 Tabs wechselt die Ausrichtung auf
   `justify-start`. Verifiziert: "Rechtliches" ist nach Scroll
   (`scrollIntoViewIfNeeded` + `isVisible()`) erreichbar.

2. **Zwei "Zeile hinzufügen"-Formulare ohne `flex-wrap`.** Kunde-hinzufügen
   (`profile/page.tsx`) und Mitglied-einladen (`admin/team/page.tsx`) hatten
   je ein `flex-1`-Textfeld neben einem festbreiten Zahlen-/Auswahlfeld und
   einem nicht schrumpfenden Button — bei 375px lief die Zeile auf 407–425px
   über den Viewport, weil das Textfeld nicht unter seine intrinsische
   Mindestbreite schrumpfen kann. Fix: `flex-wrap` ergänzt (das bereits an
   anderen Toolbar-Zeilen derselben Seiten verwendete Muster, z.B.
   `profile/page.tsx:905`) plus ein `min-w-[…]` auf dem Textfeld, damit es
   bei Platzmangel als Ganzes auf eine eigene Zeile umbricht statt bis zur
   Unlesbarkeit gequetscht zu werden.

**Systematisch nach demselben Muster gesucht:** `grep` nach
`className="flex gap-2"` (ohne `flex-wrap`) über die ganze App fand genau
zwei weitere Treffer, beide in `calendar/page.tsx` — dort aber unauffällig
(zwei `flex-1`-Buttons zu gleichen Teilen, kein fixbreiter Nachbar, kann
nicht überlaufen). Das Feiertag-manuell-Formular (`admin/holidays/page.tsx`)
nutzte bereits `flex-wrap`. Kein drittes Vorkommen des Bugs gefunden.

**Nach den Fixes:** `document.scrollWidth` ist auf allen acht Seiten wieder
exakt 375px. Die einzigen verbleibenden Elemente mit grösserem
`scrollWidth` als der Viewport sind die Bottom-Nav (536px, jetzt bewusst
selbst scrollbar) und die Team-Tabelle (554px, bereits vorher bewusst
`overflow-x-auto`) — beides in sich geschlossene, absichtliche
Scroll-Container, kein Seiten-Overflow.

Kalender-Tagesdialog bei 375px separat geprüft: zentriert, lesbar, kein
Überlauf.

Stand nach C2: 17 Dateien, 288 Tests, typecheck sauber.

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

### A5 — Compliance an Mehrfach-Eintrags-Tagen, 14.08.2026

**Der Verdacht des Punktes hat gestimmt — echter Fehlalarm, jetzt gefixt.**

Reproduziert vor dem Fix:

```
pruefeCompliance([
  { date: "2026-08-10", typ: "arbeit", von: "08:00", bis: "12:00", pauseMin: 0 },
  { date: "2026-08-10", typ: "arbeit", von: "13:00", bis: "17:00", pauseMin: 0 },
], [])
→ [{ type: "pause_zu_kurz",
     message: "Bei 8.0h Arbeitszeit sind mindestens 30 Min. Pause
               vorgeschrieben (erfasst: 0 Min.)." }]
```

Ursache: `pauseMinutenDesTages` summierte ausschliesslich die `pauseMin`-Felder
der einzelnen Einträge. Die Netto-Arbeitszeit wurde korrekt über alle Einträge
des Tages summiert (8h → Pflichtpause 30 Min.), die 60-minütige **Lücke**
zwischen 12:00 und 13:00 zählte aber nirgends. Wer vormittags für Kunde A und
nachmittags für Kunde B je einen eigenen Eintrag erfasst — das im Punkt
beschriebene, realistische Muster — bekam eine Warnung für eine Pause, die er
tatsächlich gemacht hat.

Fix in `lib/compliance.ts`: neue Funktion `lueckenMinutenDesTages`. Sie sortiert
die Arbeitsintervalle des Tages nach Startzeitpunkt, führt das bisher späteste
Ende mit und summiert die positiven Abstände. Effektive Pause = erfasste
`pauseMin` + Lücken. Wiederverwendet wird das vorhandene `eintragStartEnde`,
das den Mitternachtsübergang bereits korrekt behandelt. Überlappende oder
verschachtelte Einträge können durch das mitgeführte Maximum keine negative
Pause erzeugen.

Die Meldung nennt die Lücke jetzt getrennt, aber nur wenn es eine gibt —
`(erfasst: 20 Min. + 10 Min. zwischen den Einträgen = 30 Min.)`. Bei einem
einzelnen Eintrag ist der Text unverändert; ein Test schreibt das fest.

Acht neue Tests in `lib/compliance.test.ts`: Lücke deckt die Pflichtpause,
Lücke zu kurz (Warnung bleibt), `pauseMin` + Lücke addieren sich,
Array-Reihenfolge egal, überlappende Einträge ohne negative Pause, drei
Einträge mit zwei Lücken, Einzeleintrag unverändert, Absenz zwischen zwei
Arbeitseinträgen erzeugt keine Phantom-Lücke.

Keine UI-Änderung nötig und deshalb keine Browser-Verifikation: der Kalender
übergibt in `app/(app)/calendar/page.tsx:265-270` bereits ALLE Einträge eines
Tages an `pruefeCompliance`, der Fix wirkt dort unmittelbar. Zweiter Aufrufer
`app/api/export/arg-control/route.ts:96` ebenso.

Stand nach A5: 16 Dateien, 227 Tests, typecheck sauber.

### A6 — Monatssperre × Absenzgenehmigung, 14.08.2026

**Geklärt: die dritte Möglichkeit ist implementiert, und sie ist stimmig.**
Der Punkt stellte zwei Alternativen zur Wahl (Sperre respektieren und Tag
überspringen ODER Genehmigung ablehnen). Tatsächlich tut der Code weder das
eine noch das andere: `createAbsenceEntries` wird bei der Genehmigung ohne
`skipDates` aufgerufen (`app/api/absence-requests/route.ts:145-154`), die
Einträge entstehen also im gesperrten Monat. **Kein Fix**, weil das kein
Widerspruch ist, sondern die konsequente Anwendung der Regel aus
MIGRATION.md Punkt 6e.

Die Regel, aufgelöst über drei Aufrufstellen:

- `assertMonthEditable` (`lib/access.ts:89-94`) greift ausschliesslich bei
  `role === "member"`. manager/admin/owner werden von einer Sperre nie
  eingeschränkt.
- Genehmigen dürfen nur manager/admin/owner (`route.ts:119`), und nie den
  eigenen Antrag (`route.ts:130`). Die Genehmigung ist damit immer ein
  Schreibvorgang einer Rolle, die schreiben darf.
- Ein Antrag FÜR einen bereits gesperrten Monat ist gar nicht erst möglich —
  POST prüft `assertMonthEditable` auf `fromDate` und `toDate`
  (`route.ts:96-97`) und liefert 403. Die Situation aus dem Punkt kann also
  ausschliesslich entstehen, wenn zwischen Antrag und Genehmigung gesperrt
  wird.

Entscheidend für die Frage „widersprechen sich Sperre und Genehmigung?" ist
der dritte Test: die so erzeugten Einträge sind für member weiterhin
schreibgeschützt (PUT und DELETE liefern 403). Die Sperre verliert durch die
Genehmigung nichts von ihrer Wirkung — sie regelt, WER schreiben darf, und
die genehmigende Rolle darf es. Drei neue Tests in `lib/month-locks.test.ts`
schreiben die Kette fest.

Nebenbefund ohne Handlungsbedarf: `/api/time-entries` schreibt immer auf die
`userId` aus der Session (`route.ts:96`, `:114`), niemand kann darüber
Einträge für eine andere Person anlegen. Die Absenzgenehmigung ist damit der
einzige Weg, auf dem Einträge im Kalender einer anderen Person entstehen —
weshalb sie den Audit-Trail über `changedBy` auch korrekt mitführt
(`lib/absence-entries.ts:127-134`).

> Vorschlag für eine künftige Datei: bei der Genehmigung eines Antrags, der
> ganz oder teilweise in einem inzwischen gesperrten Monat liegt, einen
> Hinweis in der Antwort mitgeben („3 Tage liegen im abgeschlossenen Dezember
> 2026"). Rein informativ — die Genehmigung soll weiterhin durchgehen, aber
> die genehmigende Person sollte es sehen. Das ist ein Feature, kein Fix.

Stand nach A6: 16 Dateien, 230 Tests, typecheck sauber. **Teil A vollständig.**

### B1 — Coverage-Bestandsaufnahme, 16.08.2026

`@vitest/coverage-v8@2.1.9` fehlte und wurde als devDependency ergänzt
(Version an `vitest@2.1.9` gepinnt). In `vitest.config.ts` ist `all: true`
mit `include: ["lib/**/*.ts", "app/api/**/*.ts"]` gesetzt — ohne das zählt
der Bericht nur Dateien, die ein Test importiert hat, und ungetestete Routen
fehlen komplett statt mit 0% aufzutauchen. Genau die sind hier aber der
Punkt. Neues Skript: `npm run test:coverage`. `coverage/` ist ignoriert.

**Gesamt: 61.29% Statements, 66.74% Branches.**

**Gar nicht getestet (0%)** — nach Zeilenzahl, die grössten zuerst:

| Datei | Zeilen | Einschätzung |
|---|---|---|
| `app/api/analytics/route.ts` | 177 | echte Lücke, rechnet Kennzahlen für die Analytics-Seite |
| `app/api/profile/route.ts` | 138 | echte Lücke, schreibt Arbeitseinstellungen |
| `app/api/projects/route.ts` | 133 | echte Lücke, CRUD inkl. Budget/Satz-Validierung |
| `app/api/admin/team/route.ts` | 131 | echte Lücke, Rollen-/Vorgesetztenzuweisung |
| `app/api/holidays/route.ts` | 123 | echte Lücke |
| `app/api/invitations/accept/route.ts` | 123 | echte Lücke, sicherheitsrelevant (Token-Einlösung) |
| `app/api/signup/route.ts` | 78 | echte Lücke, sicherheitsrelevant |
| `app/api/auth/forgot-password/route.ts` | 69 | echte Lücke, sicherheitsrelevant |
| `app/api/auth/reset-password/route.ts` | 61 | echte Lücke, sicherheitsrelevant |
| `lib/password-policy.ts` | 25 | echte Lücke, reine Funktion — billig nachzuholen |
| `lib/mail.ts` | 53 | Nebenwirkung (SMTP), Test nur mit Mock sinnvoll |
| `lib/common-passwords.ts` | 81 | reine Datenliste, kein Testwert |
| `lib/utils.ts` | 14 | `cn()`-Helfer, kein Testwert |
| `lib/types.ts` | 23 | nur Deklarationen, kein Testwert |
| `app/api/auth/[...nextauth]/route.ts` | 5 | reiner Re-Export, kein Testwert |

**Unter 50% Statements:**

| Datei | Stmts |
|---|---|
| `lib/rate-limit.ts` | 10.25% |
| `app/api/pensum-changes/route.ts` | 21.09% |
| `lib/auth-options.ts` | 31.64% |
| `app/api/overtime-payouts/route.ts` | 36.36% |
| `app/api/customers/route.ts` | 38.20% |
| `app/api/invitations/route.ts` | 45.19% |

**Hohe Statement-, niedrige Branch-Coverage** — der aussagekräftigste
Befund für B2: diese Routen werden im Happy Path durchlaufen, ihre
Fehlerpfade aber kaum.

| Datei | Stmts | Branch |
|---|---|---|
| `app/api/time-entries/bulk-vacation/route.ts` | 78.78% | **29.41%** |
| `app/api/time-entries/bulk-apply/route.ts` | 76.07% | **34.09%** |
| `app/api/admin/organization/export/route.ts` | 86.04% | 52.94% |
| `app/api/export/route.ts` | 92.63% | 53.57% |
| `app/api/time-entries/route.ts` | 83.83% | 54.46% |
| `lib/export-helpers.ts` | 89.15% | 55.55% |
| `app/api/month-locks/route.ts` | 86.51% | 55.17% |

Gut abgedeckt und hier nur zur Einordnung: `lib/calc.ts` 98.83%,
`lib/compliance.ts` 97.72%, `lib/access.ts` 97.01%, `app/api/team` 95.53%,
`app/api/export/arg-control` 96.85%, `lib/holidays.ts`, `lib/org-export.ts`,
`lib/audit.ts`, `lib/billing-rules.ts` je 100%.

Laut Punkt bewusst **nur Bestandsaufnahme, nichts gefixt**. B2 nimmt die
Fehlerpfade der genannten Routen; die 0%-Routen ausserhalb von B2s Fokus
(`analytics`, `profile`, `projects`, `admin/team`, `holidays`, `signup`,
`invitations/accept`, `auth/*`) bleiben offen.

> Vorschlag für eine künftige Datei: die vier sicherheitsrelevanten
> 0%-Routen (`signup`, `invitations/accept`, `forgot-password`,
> `reset-password`) als eigener Testpunkt — Token-Ablauf, Wiederverwendung
> eines Tokens, Passwortrichtlinie, Enumeration von E-Mail-Adressen. Das
> geht über „Testlücken schliessen" hinaus und verdient eigene Sorgfalt.

Stand nach B1: 16 Dateien, 230 Tests (unverändert), typecheck sauber.

### B2 — Fehlerpfade in kritischen Routen, 16.08.2026

48 neue Tests, **ein echter Fehler gefunden und gefixt.**

**Der Fund: fehlerhafte Zeitraum-Parameter lieferten 500 statt 400.**
`parseExportRange` (`lib/export-helpers.ts`) parste `year`/`month` und die
`custom`-Grenzen ohne jede Prüfung. `?type=month&year=abc` ergab
`parseInt("abc") = NaN` → `Date.UTC(NaN, …)` → Invalid Date, das erst in der
Prisma-Query aufschlug: `500 Internal server error`. Dasselbe mit
`?type=custom&from=keinDatum`. Und `?month=99` lieferte still einen um Jahre
verschobenen Zeitraum mit Status 200 — schlimmer als ein Fehler, weil
niemand es merkt.

Betroffen waren alle vier Aufrufer: `/api/export`, `/api/export/arg-control`,
`/api/team` und `/api/absences/calendar`.

Fix: Validierung in einer neuen, exportierten `parseYearMonthFromUrl` mit
denselben Grenzen wie `parseYearMonth` in
`app/api/month-locks/route.ts:7-15` (Jahr 2000–2100, Monat 1–12), plus eine
Datumsprüfung für die `custom`-Grenzen. Geworfen wird `AccessError(400, …)`,
weil alle vier Aufrufer diese Klasse in ihrem `catch` bereits auf den
richtigen Status abbilden — kein Aufrufer musste angefasst werden.
`/api/export/payroll` hatte eine eigene, gröbere Prüfung ohne Jahresgrenzen
und nutzt jetzt denselben Helfer; damit ist "was ist ein gültiger Monat"
nicht mehr an drei Stellen unterschiedlich beantwortet.

**Matrix — was ergänzt wurde:**

| Route | Ergänzte Fälle |
|---|---|
| `time-entries` | fehlendes/unparsbares Datum, unbekannter Typ, leerer Body, PUT/DELETE auf unbekannte ID, PUT ohne ID, unbekannte `projectId` |
| `time-entries/bulk-vacation`, `bulk-apply` | unparsbares Datum, fehlende Daten, leerer Body, Ende vor Start, über 366 Tage, exakt 366 Tage als Grenzfall — je beide Routen |
| `absence-requests` | PATCH/DELETE auf unbekannte ID, unbekannte `action`, ohne ID, Antrag aus fremder Org (404, bleibt „offen"), POST ohne Daten, leerer Body, `scope=team` als member |
| `month-locks` | `month=13`, `year=1999`, ohne `userId`, userId ohne Membership, userId aus fremder Org (404, dort entsteht keine Sperre) |
| `team` | `year=abc`, `month=99`, `custom` mit Müll-`from`, Kontrollfall gültig |
| `export/*` | die fünf Validierungsfälle über alle drei Routen, `scope=person` mit unbekannter und mit org-fremder userId |

Fremde Org-IDs für `time-entries`, `customers`, `overtime-payouts` und
`pensum-changes` deckt `lib/api-isolation.test.ts` bereits ab und wurde nicht
angefasst.

**Branch-Coverage vorher → nachher:**

| Datei | vorher | nachher |
|---|---|---|
| `time-entries/bulk-vacation` | 29.41% | **86.20%** |
| `time-entries/bulk-apply` | 34.09% | **70.00%** |
| `month-locks` | 55.17% | **80.55%** |
| `lib/export-helpers` | 55.55% | **83.33%** |
| `absence-requests` | 71.18% | 80.59% |
| `export/payroll` | 68.42% | 75.00% |
| `export` | 53.57% | 62.90% |
| `time-entries` | 54.46% | 62.69% |
| `export/arg-control` | 63.82% | 65.30% |
| `team` | 79.31% | 79.31% (400-Pfad steigt früh aus) |
| **gesamt** | **66.74%** | **74.23%** |

Stand nach B2: 16 Dateien, 278 Tests, typecheck sauber.

### B3 — Property-Test für sollStundenTag, 16.08.2026

Neue Datei `lib/calc.property.test.ts`. **Kein `fast-check` als
Abhängigkeit** — ein geseedeter mulberry32-PRNG reicht und hält jeden
Fehlschlag exakt reproduzierbar; jede Assertion trägt Seed und Tag in ihrer
Meldung, ein roter Test benennt den Fall also selbst.

25 Zufallsszenarien über 5 Jahre (2024–2028, 1827 Tage), je mit zufälligen
Wochenstunden (20–50), Pensum (10–100), Eintritt, in der Hälfte der Fälle
einem Austritt, 0–5 Pensumsänderungen und 0–12 Feiertagen. Geprüfte
Invarianten:

| Invariante | Umfang |
|---|---|
| endlich, ≥ 0, ≤ 24 | jeder einzelne Tag, alle Szenarien |
| Wochenende immer 0 | jeder Sa/So, unabhängig von Pensum/Feiertag |
| vor Eintritt und nach Austritt 0 | alle Tage ausserhalb der Anstellung |
| deterministisch, reihenfolgeunabhängig | Changes und Feiertage auch umgekehrt übergeben |
| Arbeitstag = `wochenstunden × pensum / 100 / 5` | exakt, `toBeCloseTo(…, 10)` |
| Halbtags-Feiertag halbiert, ganzer setzt auf 0 | jeder Feiertag im Szenario |
| volle Mo–So-Woche = `wochenstunden × pensum / 100` | 20 zufällige Wochen je Seed |
| monoton im Pensum | 0/10/20/40/60/80/100 über 30 Tage |
| additiv über angrenzende Zeiträume | 90 + 90 Tage vs. 180 Tage |
| umgekehrter Zeitraum ergibt 0 | `bis` vor `von` |

Die Wocheninvariante stellt ihre **Vorbedingung ausdrücklich her** (keine
Pensumsänderung, keine Feiertage, Woche vollständig innerhalb der
Anstellung). Ohne diese drei Bedingungen ist sie per Definition verletzt,
weil `sollStundenTag` genau in dieser Reihenfolge prüft — eine Invariante
ohne ihre Vorbedingung zu behaupten hiesse, das Falsche festzuschreiben.

**Kein Fehler gefunden.** Damit die Tests nicht bloss leerlaufen, wurden sie
gegen drei absichtliche Mutationen in `lib/calc.ts` gehalten — alle drei
wurden gefangen, `lib/calc.ts` danach unverändert:

| Mutation | gefangen von |
|---|---|
| Samstag zählt als Arbeitstag | Wochenend-Invariante + Wocheninvariante |
| Halbtags-Feiertag gibt volles Soll | Feiertags-Invariante |
| `exitDate` wird ignoriert | Eintritts-/Austritts-Invariante |

Laufzeit rund 2.9s für 10 Tests — der teure Teil ist die tagweise Iteration
über 25 × 1827 Tage in der ersten Invariante.

Stand nach B3: 17 Dateien, 288 Tests, typecheck sauber.

### B4 — Lasttest Teamsicht und Exporte, 16.08.2026

Neues Skript `scripts/loadtest-seed.ts` (nicht in `scripts/seed.ts` eingebaut,
rein lokal): 60 Mitglieder, **31'320 TimeEntries** über zwei Jahre, 10 Kunden,
30 Projekte, Pensumsänderungen für jede dritte Person, Feiertage. Räumt vor
jedem Lauf auf; `--clean` entfernt alles wieder.

**Klarer N+1 gefunden und gefixt.** Beide Routen luden vier Datensätze **pro
Person** in einer `for`-Schleife (`Promise.all` bündelte nur die vier Queries
einer Person, die Personen liefen nacheinander). Gemessen mit einem
Prisma-Client mit Query-Events, Route-Handler direkt aufgerufen:

| Route | Queries vorher | Queries nachher | Median vorher | Median nachher |
|---|---|---|---|---|
| `/api/team?type=year` | **247** | **11** | 499 ms | 466–483 ms |
| `/api/export?scope=org` | **244** | **8** | 421 ms | 392 ms |

Fix in `app/api/team/route.ts` und `app/api/export/route.ts`: vier Queries mit
`userId: { in: … }` über alle sichtbaren Personen, danach in-memory nach
`userId` gruppiert. Die Gruppierung erhält die Query-Reihenfolge, damit das
`orderBy: { effectiveFrom: "asc" }` weiterhin gilt, auf das sich `pensumAt`
bei zwei Änderungen am selben Tag verlässt (A2). Die Berechnung selbst wurde
nicht angefasst — alle 288 Tests bleiben grün, inklusive der inhaltlichen
Zusicherungen in `lib/team-route.test.ts` und `lib/export-routes.test.ts`.

**Ehrlich zur Wirkung: die Wanduhr bewegt sich lokal kaum** (rund 5–7%). Der
Grund steht in der isolierten Gegenprobe des Skripts, das nur die beiden
Query-Muster vergleicht:

```
Schleife pro Person  :  765 ms, 243 Queries
gebündelt (userId in):  257 ms,   3 Queries
Faktor: 3.0× langsamer, 81.0× mehr Queries
```

Die Queries selbst sind also durchaus 3× teurer, machen an der
Gesamt-Antwortzeit aber nur einen kleinen Teil aus: den Rest verbraucht die
Rechenarbeit in `kennzahlen`/`wochenUebersicht` über 31'320 Einträge. Auf
einer lokalen Datenbank kostet eine Round-Trip fast nichts — der Gewinn von
247 auf 11 Round-Trips zahlt sich erst aus, wenn die Datenbank nicht auf
demselben Host liegt, was beim Docker-/Caddy-Deployment aus MIGRATION.md
Punkt 11 der Normalfall ist. Der Fix ist deshalb richtig, auch wenn die
lokale Messung ihn kleinredet.

**Antwortzeiten im akzeptablen Bereich:** rund 0.4–0.5s für eine
60-Personen-Organisation mit zwei Jahren Daten, ohne Ladezustand-Problematik.
Kein Performance-Feature gebaut, wie im Punkt gefordert.

> Vorschlag für eine künftige Datei: Falls Organisationen deutlich über 60
> Personen wachsen, ist der nächste Hebel nicht die Query-Zahl, sondern die
> Rechenarbeit — `kennzahlen`/`wochenUebersicht` laufen pro Person über alle
> Einträge des Zeitraums. Ein Cache pro (Person, Monat) oder eine
> Vorberechnung beim Schreiben wäre der Ansatz. Ausdrücklich erst bei echtem
> Bedarf, nicht auf Verdacht.

Stand nach B4: 17 Dateien, 288 Tests, typecheck sauber. **Teil A und B
vollständig.** Offen bleibt Teil C (UI/UX-Begehung, C1–C7f).
