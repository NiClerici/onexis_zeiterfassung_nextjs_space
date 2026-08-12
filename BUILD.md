# BUILD — Ausbau auf Vision-Spec

Diese Datei ist der Arbeitsplan **und** der Fortschrittsstand. Sie ist die einzige
Quelle der Wahrheit für den Loop.

## Regeln für jede Iteration

1. Nimm den **ersten** Schritt, dessen Box nicht abgehakt ist.
2. Setz ihn **vollständig** um — keine Teilstände, kein Vorgreifen auf spätere Schritte.
3. Danach in dieser Reihenfolge:
   - `npm run typecheck` → muss sauber sein
   - `npm test` → muss grün sein
   - `git add -A && git commit` mit aussagekräftiger Nachricht
4. Erst dann die Box abhaken (`- [ ]` → `- [x]`).
5. **Blockiert?** Schreib den Grund unter den Schritt als `> BLOCKER: …` und hör auf.
   Überspring den Schritt nicht und hak ihn nicht ab.
6. Alle Boxen abgehakt → Loop beenden.

**Kontext:** Next.js 14 + Prisma + lokale PostgreSQL (läuft). Login `John` / Code `1234`.
Stack wird **nicht** getauscht. Deutsch in UI und Feldnamen, Stunden mit einer
Dezimale und „h", Datum dd.mm.yyyy, Locale de-CH.

---

## Referenzwerte (nicht verhandelbar)

Testprofil: **40h Wochenstunden, 60% Pensum, 25 Ferientage, Start 01.04.2026,
Stichtag 12.08.2026**

| Größe | Sollwert |
|---|---|
| Sollstunden pro Tag | **4.8h** |
| Soll August bis 12.08. | **38.4h** |
| Soll August gesamt | **100.8h** |
| Ferienanspruch 2026 | **18.8** |

---

## Fachlogik (verbindlich)

**Pensum an einem Datum:** letzte `PensumChange` mit `effectiveFrom <= Datum`,
sonst die Werte aus dem Profil.

**Sollstunden pro Tag** = `(wochenstunden × pensum / 100) / 5`.
Nur Mo–Fr, sonst 0. Vor `startDate` immer 0.
Der Standard-Wochenplan geht **nicht** ins Soll ein — er ist nur Vorlage zum Vorerfassen.

**Stunden eines Eintrags:**
- `arbeit`: `bis − von − pauseMin`, über Mitternacht erlaubt (dann `+24h`)
- `unbezahlt`: immer 0
- alle übrigen Absenzen: `hours` falls gesetzt, sonst Sollstunden des Tages

**Kennzahlen für [from, to] mit Stichtag heute:**
```
soll             = Σ Sollstunden von from bis min(heute, to)
ist              = Σ Einträge bis min(heute, to)
ueberzeit        = ist − soll − Σ OvertimePayout im Zeitraum
kundenstunden    = ist-Anteil mit typ=arbeit UND billable-Kunde
verrechnungsgrad = kundenstunden / ist × 100
geplantZukunft   = Σ Einträge NACH heute bis to
sollGesamt       = Sollstunden über den ganzen Zeitraum
totalPrognose    = ist + geplantZukunft
prognoseSaldo    = totalPrognose − sollGesamt
```

**Feriensaldo pro Jahr:**
```
anspruch = ferientage × (13 − startMonat) / 12   // nur wenn Startjahr == Jahr
         = ferientage                            // sonst
```
Auf 1 Dezimale runden. **Pensum geht nicht ein.** Der Startmonat zählt mit
(Start 01.04. → April–Dezember = 9 Monate → 25 × 9/12 = 18.8).
`bezogen` = Ferien-Einträge bis heute, `geplant` = danach,
`offen` = anspruch − bezogen − geplant.

---

## Schritte

### - [x] 1. `lib/calc.ts` + Tests

Reine Funktionen, **kein** Prisma-Import, keine DB — alles kommt als Parameter rein.
Signaturen etwa:

```ts
pensumAt(datum, profil, changes) → { pensum, wochenstunden }
sollStundenTag(datum, profil, changes) → number
stundenAusEintrag(eintrag, sollStundenDesTages) → number
kennzahlen({ from, to, heute, eintraege, profil, changes, payouts, kunden }) → {...}
feriensaldo({ jahr, heute, profil, eintraege }) → { anspruch, bezogen, geplant, offen }
```

Tests in `lib/calc.test.ts`. Alle vier Referenzwerte oben müssen grün sein.
Dazu diese Kantenfälle:
- Schicht über Mitternacht (22:00–06:00, 30min Pause → 7.5h)
- Pensumwechsel mitten im Monat (Soll splittet korrekt am `effectiveFrom`)
- Zeitraum komplett vor `startDate` → Soll 0
- Absenz ohne gesetzte `hours` → erbt Sollstunden des Tages
- `unbezahlt` → 0, auch wenn `hours` gesetzt ist
- Zeitraum komplett in der Zukunft → `soll` 0, `sollGesamt` > 0
- `verrechnungsgrad` bei `ist == 0` → 0, kein NaN

> Dieser Schritt blockiert alle folgenden. Erst weiter, wenn er grün ist.

---

### - [x] 2. Schema-Migration

`prisma/schema.prisma`:
- `TimeEntry`: `@@unique([userId, date])` **entfernen** (mehrere Einträge pro Tag)
- `TimeEntry` neue Felder: `von String?`, `bis String?` (als "HH:MM"),
  `pauseMin Int @default(0)`, `projekt String?`, `notiz String?`,
  `customerId String?` (FK, nullable)
- `TimeEntry.hours` → `Float?` (nullable, Absenzen erben sonst das Tagessoll)
- Neues Model `Customer`: `id`, `userId`, `name`, `billable Boolean @default(true)`,
  Relation zu `TimeEntry`, `@@unique([userId, name])`
- Typwerte auf 6: `arbeit | ferien | krank | feiertag | militaer | unbezahlt`
  (als String-Feld beibehalten, Konstante in `lib/calc.ts` exportieren)

Migration muss **Bestandsdaten übernehmen**:
`work → arbeit`, `vacation → ferien`, `holiday → feiertag`.
`hours` bleibt gesetzt, `von`/`bis` bleiben null.

Bestehende `CustomerHour`-Daten nach `Customer` überführen (Namen dedupliziert,
`billable = true`). `CustomerHour` erst in Schritt 5 entfernen, solange die
Analytics noch darauf zugreift.

Danach `npx prisma migrate dev` und `scripts/seed.ts` muss weiter durchlaufen.

---

### - [x] 3. API-Routen auf das neue Modell

- `app/api/time-entries/route.ts`: mehrere Einträge pro Tag, `von`/`bis`/`pauseMin`/
  `projekt`/`notiz`/`customerId` durchreichen. Der `upsert` auf `userId_date`
  funktioniert nicht mehr — auf `create`/`update` per `id` umbauen.
  Die Typ-Whitelist auf die 6 neuen Werte erweitern.
- `app/api/time-entries/bulk-apply/route.ts`: erzeugt jetzt `von`/`bis` —
  Start 08:00, 30min Pause ab 6h Tagessoll.
- `app/api/analytics/route.ts` **und** `app/api/export/route.ts`: eigene
  Inline-Rechenlogik raus, stattdessen `lib/calc.ts` aufrufen. Damit verschwindet
  die Duplikation der Ferien-/Pensumlogik zwischen den beiden Dateien.
- Neu: `app/api/customers/route.ts` — GET/POST/PUT/DELETE, `billable` togglebar.

---

### - [x] 4. Kalender + Tagesdialog

`app/(app)/calendar/page.tsx`:
- Woche startet **Montag**
- Pro Tag: Summe der Stunden, Farbcode nach Typ
- Arbeitstage ohne Eintrag: fehlende Sollstunden in **Rot**
- Tagesdialog: **mehrere** Einträge, je Von/Bis/Pause/Typ/Kunde/Projekt/Notiz,
  Einträge einzeln löschbar
- Bei Absenztypen (`ferien`/`krank`/`feiertag`/`militaer`/`unbezahlt`):
  Von/Bis ausblenden, Stunden defaulten auf das Tagessoll
- „Standard-Wochenplan anwenden" auf wählbaren Zeitraum: überspringt Tage mit 0h
  und Tage mit bestehenden Einträgen

Die Datei ist ~880 Zeilen. Beim Umbau den Tagesdialog in eine eigene Komponente
unter `components/` ziehen.

---

### - [ ] 5. Analytics

`app/(app)/analytics/page.tsx` + zugehörige Route:
- Karten: Sollarbeitszeit, Geleistete Stunden (mit Delta), Überzeit,
  Verrechnungsgrad, Kundenstunden
- Block „Prognose (inkl. geplante Zukunft)": Geplante Stunden, Sollstunden gesamt,
  Total, Prognose Saldo + Hinweistext „Rein informativ — berücksichtigt
  vorerfasste zukünftige Einträge im gewählten Zeitraum."
- Block „Feriensaldo <Jahr>": Gesamtanspruch / Bezogen / Geplant / Noch zu planen
- Zwei Charts (recharts, ist vorhanden): Balken Soll vs. Ist,
  monatlicher Verlauf Arbeitsstunden vs. Kundenstunden
- Verrechnungsgrad kommt jetzt aus echten billable-Einträgen, nicht mehr aus
  `CustomerHour`. Danach `CustomerHour` aus Schema und Code entfernen.

---

### - [ ] 6. Profil + Export

`app/(app)/profile/page.tsx`:
- Kundenverwaltung: Liste, anlegen, umbenennen, `billable` togglen, löschen
- Excel-Export (Monat / Jahr / freier Zeitraum) über das bereits installierte
  `exceljs` — alle Einträge plus **Summenzeile**
- Bestehende Blöcke (Pensumsänderung, Auszahlungen, Wochenplan, Sicherheitsfragen,
  Passwort) bleiben, nur an die neuen Feldnamen angleichen

---

## Notizen des Loops

_(Hier trägt der Loop Blocker, Entscheidungen und Auffälligkeiten ein.)_

- Schritt 1: `npm run typecheck` schlug vor Beginn bereits fehl wegen zweier
  vorbestehender Prisma-`$transaction`-Typfehler in `bulk-apply/route.ts` und
  `bulk-vacation/route.ts` (Typ `Promise<any>[]` statt `Prisma.PrismaPromise<any>[]`).
  Minimal per Typannotation gefixt, damit das Gate sauber ist — keine
  Verhaltensänderung, keine Vorwegnahme von Schritt 3.
- Schritt 2: Das Entfernen von `@@unique([userId, date])` bricht den
  `upsert`-Aufruf auf `userId_date` in `app/api/time-entries/route.ts`
  (bereits in Schritt 3 als bekannt dokumentiert). Minimal auf
  `findFirst` + `update`/`create` umgestellt, um das bisherige
  Ein-Eintrag-pro-Tag-Verhalten unverändert zu erhalten — von/bis/pauseMin/
  projekt/notiz/customerId, Typ-Whitelist-Erweiterung und Mehrfacheinträge
  pro Tag bleiben bewusst Schritt 3 vorbehalten.
- Schritt 1 (Korrektur während Schritt 3 entdeckt): feriensaldo() hat bezogen/geplant
  faelschlich in Stunden statt in Tagen summiert (Einheiten-Mismatch mit anspruch, das in
  Tagen ist). Behoben: Umrechnung ueber das Tagessoll des jeweiligen Eintragsdatums
  (stunden / sollStundenTag), damit auch Halbtage korrekt anteilig zaehlen. Tests angepasst.
- Schritt 3: time-entries/route.ts (GET), analytics/route.ts und export/route.ts bauten
  Perioden-Grenzen bisher mit lokalen new Date(jahr, monat, tag)-Konstruktoren. Da der
  Server nicht in UTC laeuft (hier: Europe/Zurich) und @db.Date-Werte anhand des
  UTC-Kalendertags gespeichert/verglichen werden, fiel dadurch systematisch der letzte Tag
  jeder Periode aus Monats-/Jahres-/Quartalsauswertungen heraus (verifiziert: ein Eintrag
  am 31.08. wurde von der August-Abfrage nicht gefunden). In diesen drei Dateien auf
  Date.UTC(...) bzw. UTC-Getter/Setter umgestellt und den Fix verifiziert. lib/calc.ts war
  davon nicht betroffen (arbeitet intern bereits UTC-safe).
  > HINWEIS (kein Blocker für diesen Schritt, Gates sind grün): bewusst nicht mitgefixt -
  > time-entries/bulk-apply/route.ts und bulk-vacation/route.ts (parseDateYMD,
  > Tagesschleifen-Iteration) haben denselben Konstruktionsfehler, sowohl beim Schreiben
  > (dbDate) als auch beim Lesen bestehender Eintraege im Zeitraum. Nicht mitgefixt, da es
  > eine invasivere Umstellung der Schleifenlogik auf UTC-Iteration erfordert
  > (Regressionsrisiko) und der Bug bereits vor diesem Umbau bestand. Sollte vor
  > Produktivbetrieb separat behoben werden.
- Schritt 4: Tagesdialog nach components/day-entry-dialog.tsx ausgelagert. Im Browser
  end-to-end getestet (Playwright, lokal installiert): Login, Tag öffnen, arbeit-Eintrag
  mit von/bis/pause/kunde anlegen, Absenz-Eintrag anlegen (Von/Bis ausgeblendet, Stunden
  defaultet korrekt auf Tagessoll), Eintrag löschen, Kalendergitter zeigt Summe+Farbcode
  pro Tag und fehlende Sollstunden in Rot für leere Arbeitstage — keine Konsolenfehler.
  Dabei Bug gefunden und gefixt: neue arbeit-Einträge schickten fälschlich einen
  hours-Wert mit (Default-Vorbelegung des ausgeblendeten Felds) statt null; harmlos
  für die Berechnung (stundenAusEintrag ignoriert hours bei arbeit, wenn von/bis
  gesetzt sind), aber unsaubere Daten — behoben.
