# Verifikation der Audit-Funde — durch Ausführung

Gegenprobe zu `REVIEW_LOOP.md`, dessen Funde **rein statisch** hergeleitet waren.
Hier wird Code tatsächlich ausgeführt und das Ergebnis protokolliert.

- Start: 2026-08-30
- Testskripte: `verification/` (eigener Ordner, gefahrlos löschbar)
- Ausführen: `npx vitest run --config verification/vitest.verify.config.ts`
- **Konvention:** Die Tests behaupten das **aktuelle, fehlerhafte** Verhalten und nennen im Testnamen, was korrekt wäre. **Grün = Fehler reproduziert.** Wo möglich steht daneben eine Gegenprobe, die zeigt, dass die intakte Hälfte derselben Funktion funktioniert.
- **Sicherheitsregeln:** bestehende Datenbankinhalte werden ausschliesslich gelesen; schreibende Tests laufen nur in einer eigens angelegten Wegwerf-Organisation, die danach entfernt wird; kein Produktivcode wird geändert.

## Status je Fund

| # | Fund | Schwere | Status |
|---|---|---|---|
| 1 | Jedes Mitglied kann Kunden löschen (Kaskade) | KRITISCH | **BESTÄTIGT** (DB) |
| 2 | Nachtarbeit vor 06:00 wird nicht erkannt | HOCH | **BESTÄTIGT** |
| 3 | `feriensaldo()` ignoriert `exitDate` | HOCH | **BESTÄTIGT** |
| 4 | Nicht-numerische Stundenzahl passiert als NaN | HOCH | **BESTÄTIGT** |
| 5 | Excel-Import kürzt Stunden (`buildArbeitszeit`) | HOCH | **BESTÄTIGT** |
| 6 | Mitternachts-Konvention widersprüchlich | MITTEL | **BESTÄTIGT** |
| 7 | Zukünftige Auszahlung senkt heutige Überstunden | MITTEL | **BESTÄTIGT** |
| 8 | Analytics-Verlauf überspringt Monate | MITTEL | **BESTÄTIGT** |
| 9 | Graduierung verdoppelt Arbeits- und Kundenstunden | HOCH | **BESTÄTIGT** (DB) |
| 10 | Profil schreibt Stammdaten ungeprüft | HOCH | **BESTÄTIGT** (Route) |
| 11 | `member` darf Kunden löschen (Rollenprüfung fehlt) | KRITISCH | **BESTÄTIGT** (Route) |
| 12 | Import: "total"-Zeile stumm verworfen | MITTEL | **BESTÄTIGT** |
| 13 | Import: Formelzellen "[object Object]" | MITTEL | **BESTÄTIGT** |
| 14 | Import: widersprüchliche Von/Bis vs. Stunden | MITTEL | **BESTÄTIGT** |
| 15 | Import: keine Duplikatprüfung in der Datei | MITTEL | **BESTÄTIGT** |
| 16 | Verrechnungsgrad >100% bei Teilmonaten | MITTEL | **BESTÄTIGT** (204%) |
| 17 | Kundenstunden-Korrektur auf 0 verpufft | MITTEL | **BESTÄTIGT** |
| 18 | Ladefehler in der Oberfläche unsichtbar | MITTEL | **BESTÄTIGT** (Browser) |
| 19 | Kunde löschen ohne Rückfrage | KRITISCH | **BESTÄTIGT** (Browser) |

**Bilanz: 19 von 19 geprüften Funden bestätigt, keiner widerlegt.**
Zwei Funde stellten sich in der Messung als **gravierender** heraus als statisch geschätzt
(Verrechnungsgrad 204% statt ~147%; der Kalender wirkt bei einem 500er nicht leer, sondern normal).
Nicht dynamisch geprüft wurden die übrigen 66 Funde des Audits — überwiegend NIEDRIG-Einstufungen,
toter Code und Betriebsthemen, deren Nachweis keinen zusätzlichen Erkenntnisgewinn brächte.

---

## V1 — Kaskade beim Löschen eines Kunden (KRITISCH)

**Methode:** Lesende Abfrage der tatsächlichen Fremdschlüsselregeln in der laufenden Entwicklungsdatenbank (`information_schema.referential_constraints`) plus Zählung der real betroffenen Zeilen. Kein Schreibzugriff.

**Beleg** (`verification/01-fk-rules.ts`):

```
┌─────────────────┬──────────────┬────────────┬─────────────┐
│ child           │ col          │ parent     │ delete_rule │
├─────────────────┼──────────────┼────────────┼─────────────┤
│ 'CustomerMonth' │ 'customerId' │ 'Customer' │ 'CASCADE'   │
│ 'Project'       │ 'customerId' │ 'Customer' │ 'CASCADE'   │
│ 'TimeEntry'     │ 'customerId' │ 'Customer' │ 'SET NULL'  │
└─────────────────┴──────────────┴────────────┴─────────────┘

Reale Datenmengen: { customers: 2, projects: 3,
                     customermonths: 36, entries_with_customer: 183 }
```

**Ergebnis: BESTÄTIGT.** Die im Audit aus dem Prisma-Schema abgeleiteten Regeln gelten so auch in der echten Datenbank. Bei **zwei** existierenden Kunden bedeutet ein Klick auf den Papierkorb konkret: bis zu **36 `CustomerMonth`-Zeilen** und **3 Projekte** werden gelöscht, bei bis zu **183 Zeiteinträgen** fällt die Kundenzuordnung auf `NULL`. Das ist keine Modellrechnung mehr, sondern der Bestand dieser Datenbank.

---

## V2 — Rechenkern (7 Funde)

**Methode:** Reine Funktionsaufrufe ohne Datenbank (`verification/01-rechenkern.verify.ts`, 11 Tests).
**Ergebnis: 11 von 11 grün — alle sieben Funde reproduziert.**

### Fund 2 — Nachtarbeit vor 06:00 · BESTÄTIGT
`pruefeCompliance` für eine Schicht **04:00–08:00** meldet **keine** Nachtarbeit, obwohl zwei Stunden in der gesetzlichen Nachtzeit liegen.
Die Gegenprobe **22:00–02:00** wird korrekt gemeldet — der Fehler betrifft also genau die Hälfte, die der bestehende Testfall in `lib/compliance.test.ts` nicht abdeckt. Damit ist auch die These aus dem Audit belegt, dass die vorhandenen Tests hier falsche Sicherheit geben.

### Fund 3 — `feriensaldo()` ignoriert `exitDate` · BESTÄTIGT
Profil mit Austritt **31.03.2026** → `anspruch = 25` volle Ferientage (anteilig wären es rund 6.25).
Gegenprobe: Ein *Eintritt* im selben Jahr wird korrekt anteilig gerechnet — die Pro-rata-Logik existiert also und wurde nur nicht auf den Austritt angewandt.

### Fund 4 — NaN passiert die Validierung · BESTÄTIGT
Zwei Stufen einzeln nachgewiesen:
1. Der Klemm-Ausdruck der Route ergibt für `hours: "acht"` tatsächlich `NaN`, und `NaN != null` ist `true` — der Wert passiert `arbeitszeitIstGueltig`.
2. Ein Eintrag mit `hours: NaN` macht `kennzahlen().ist` zu `NaN`, die Monatssumme ist damit unbrauchbar.

### Fund 5 — `buildArbeitszeit` kürzt Stunden · BESTÄTIGT
`buildArbeitszeit(16)` liefert `bis = "23:59"` und `geklemmt = true`. Rechnet man die gespeicherten Werte über `stundenAusEintrag` zurück, ergeben sich **14.98h statt 16h** — die im Audit genannte Zahl stimmt auf zwei Nachkommastellen.

### Fund 6 — Mitternachts-Konvention · BESTÄTIGT
Derselbe Eintrag **08:00–08:00** ergibt in `lib/calc.ts` **0h**, während `lib/compliance.ts` ihn mit **24.0h** in der Warnung "Tagesarbeitszeit überschreitet die Höchstgrenze" ausweist. Zusätzlich meldet `pruefeEintragKonflikte` eine Überlappung mit einem völlig separaten Eintrag von 14:00–15:00 — die 24-Stunden-Spanne kollidiert mit allem.

### Fund 7 — Zukünftige Auszahlung · BESTÄTIGT
Zeitraum 01.01.–31.12.2026, Stichtag 30.08. Eine Auszahlung mit Datum **15.12.2026** senkt den heute ausgewiesenen Überstundensaldo um exakt **20.0h**.

### Fund 8 — Analytics-Monatsschleife · BESTÄTIGT
Die Iteration aus `app/api/analytics/route.ts` liefert für den Zeitraum 31.01.–30.04.2026 die Monatsfolge **[1, 3, 4]** — der **Februar fehlt vollständig**.


---

## V3 — Doppelzählung beim Graduieren einer migrierten Zeile (HOCH)

**Methode:** Wegwerf-Organisation in der echten Datenbank (`verification/02-graduierung.ts`). Aufbau exakt wie im Audit beschrieben: eine Legacy-Zeile (`countsAsWorktime = false`, 8h, Kunde X, April 2026) **und** ein `CustomerMonth`-Wert von 102.8h für denselben Monat und Kunden. Dann wird genau die eine Änderung ausgeführt, die `PUT /api/time-entries` beim Speichern vornimmt: `countsAsWorktime → true`.

**Beleg:**

```
--- Kundenstunden April 2026 ---
  vor  Graduierung: 102.8 h
  nach Graduierung: 110.8 h
  Differenz:         8 h
--- Arbeitszeit (kennzahlen().ist) ---
  vor  Graduierung: 0 h
  nach Graduierung: 8 h

ERGEBNIS: DOPPELZAEHLUNG BESTAETIGT
Aufraeumen: Wegwerf-Orgs verblieben = 0
```

**Ergebnis: BESTÄTIGT — und zwar numerisch exakt so, wie im Audit vorhergesagt** (dort stand "102.8h + 8h = 110.8h"). Beide Seiten des Fundes treten gleichzeitig ein: Die Kundenstunden steigen um 8h, **und** dieselben 8h erscheinen zusätzlich in der Arbeitszeit (`ist` springt von 0 auf 8), weil `kennzahlen()` die Zeile jetzt nicht mehr überspringt. Ein Nutzer, der an einem migrierten Tag nur die Notiz ändert, löst das aus.

---

## V4 — Route-Ebene: Profil-Validierung und Kunden-Löschung

**Methode:** Aufruf der **echten** Route-Handler mit gemockter Session (`verification/03-routen.verify.ts`), nach dem im Projekt bereits etablierten Muster aus `lib/api-isolation.test.ts`. Rolle der Session: `member`. Alles in einer Wegwerf-Organisation.

### Fund — Profil schreibt Stammdaten ungeprüft · BESTÄTIGT

```
  -> gespeichertes Pensum: -100%
  -> Soll bei 100%: 184.8h | bei -100%: -184.8h
  -> Überstunden bei 100%: -184.8h | bei -100%: 184.8h
  -> gespeichertes startDate: 2026-08-01
```

`PUT /api/profile` antwortet auf `{ "pensum": -100 }` mit **200**, und der Wert steht anschliessend so in der `Membership`. Die Folge ist messbar: Das Monatssoll kippt von +184.8h auf **−184.8h**, und daraus werden **+184.8 Überstunden**, die nie geleistet wurden — bei null erfassten Einträgen. Ebenso akzeptiert die Route `{ "startDate": "2026-08-01" }` von einem `member` für sich selbst, obwohl der Code das Gegenstück `exitDate` ausdrücklich als "nur über /admin/team" kennzeichnet.

> **Anmerkung zur Sorgfalt dieser Verifikation:** Der erste Durchlauf schlug fehl, weil **meine Zusicherung** falsch war (`ueberstunden > |soll|` statt `= −soll`) — nicht der geprüfte Code. Korrigiert und erneut ausgeführt. Der Fund selbst war davon nicht berührt.

### Fund — `member` darf Kunden löschen · BESTÄTIGT (jetzt end-to-end)

```
  -> Projekte:          1 -> 0
  -> CustomerMonths:    1 -> 0
  -> Einträge m. Kunde: 1 -> 0
  -> Eintrag existiert noch: true, customerId=null, projectId=null
```

`DELETE /api/customers` liefert für die Rolle **`member`** den Status **200**. Die Kaskade läuft vollständig durch: Projekt und `CustomerMonth`-Zeile sind **gelöscht**, der Zeiteintrag **überlebt**, verliert aber `customerId` **und** `projectId`. Damit ist der kritische Fund nicht mehr nur über die Fremdschlüsselregeln belegt (V1), sondern durch den tatsächlichen Aufruf des ausgelieferten Endpunkts — inklusive der Feststellung, dass die Rollenprüfung fehlt.


---

## V5 — Excel-Import (5 Funde)

**Methode:** Eine echte `.xlsx` wird mit ExcelJS im Speicher gebaut, über einen Puffer geschrieben und neu geladen (also kein Kurzschluss über das In-Memory-Objekt), dann läuft der ausgelieferte `parseTimesheetWorkbook` darüber. Keine Datenbank, keine Dateien auf der Platte. **Alle 5 Tests grün.**

### "total" in irgendeiner Zelle verwirft die Zeile stumm · BESTÄTIGT
```
  -> geparste Zeilen: 1, Fehler: 0
  -> importierte Daten: 2026-08-11
```
Zwei reguläre Arbeitszeilen, die zweite trägt in der **Notiz**-Spalte das Wort `Total`. Importiert wird nur die erste. Weder `rows` noch `errors` erwähnt die verschwundene Zeile — der Nutzer bekommt "1 Zeile importiert" und keinen Hinweis.

### Formelzellen ergeben "[object Object]" · BESTÄTIGT
```
  -> Fehlermeldung: Ungültige Stundenzahl: "[object Object]".
```
Die Stundenspalte als Excel-Formel (`=4*2`, Ergebnis 8) lässt die Zeile scheitern. Die Meldung ist wörtlich die im Audit vorhergesagte und für den Nutzer nicht deutbar — in Excel sieht die Zelle wie eine ganz normale 8 aus.

### Widersprüchliche Von/Bis vs. Stunden · BESTÄTIGT
```
  -> Datei sagt: 6h | gespeichert wird: 4h | Pause: 0 | Fehler: 0
```
Die Datei nennt 6 Stunden bei 08:00–12:00. Der Parser errechnet die Pause als Differenz, landet bei 0, und die tatsächlich zählende Zeit ist **4h**. Die 6 aus der Datei ist wirkungslos, eine Warnung gibt es nicht.

### Keine Duplikatprüfung innerhalb der Datei · BESTÄTIGT
```
  -> Zeilen: 2 (beide fuer 2024-03-12), Fehler: 0
```
Zwei identische Zeilen für denselben Tag werden beide übernommen. Über den Tagesdialog wäre die zweite mit **409 "identischer Eintrag"** abgelehnt worden.

### Import kürzt lange Tage · BESTÄTIGT
```
  -> abgeleitet: 08:00-23:59, Pause 60 -> 14.98h statt 16h
```
Bestätigt am Parser, was V2 bereits an `buildArbeitszeit` gezeigt hatte.

---

## V6 — Verrechnungsgrad und die nicht speicherbare Null

### Verrechnungsgrad kann über 100% steigen · BESTÄTIGT — **deutlicher als vorhergesagt**
```
  -> Arbeitsstunden im Teilzeitraum: 50.4h
  -> Kundenstunden (voller Monat):   102.8h
  -> Verrechnungsgrad:              204%
```
Im Audit war für einen Teilmonat ein Wert von rund 147% geschätzt worden. Tatsächlich sind es bei sechs erfassten Arbeitstagen im Zeitraum 10.–20.04. **204%** — der Zähler stammt aus dem vollen Monat, der Nenner nur aus dem gewählten Ausschnitt.

### Bewusste Korrektur auf 0 verpufft · BESTÄTIGT
```
  -> Admin traegt 0 ein, Legacy hat 96.75 -> wirksam: 96.75h
```
Die Auflösungsregel `cm > 0 ? cm : legacy` lässt jeden Wert ausser der Null gewinnen. Ergänzend bestätigt: `combineCustomerHours({fromEntries: 8, fromMigration: 102.8})` ergibt **110.8** — die Addition, die der Doppelzählung aus V3 zugrunde liegt.


---

## V7 — Browser (Playwright, Wegwerf-Konto)

**Methode:** Dev-Server lokal gestartet, eigenes Konto `zzz-verify-browser` in einer Wegwerf-Organisation (mit eigenem Kunden, Projekt und Zeiteintrag), Chromium via Playwright. Kein Zugriff auf echte Konten oder Daten.

### Fehlgeschlagene Ladevorgänge sind in der Oberfläche unsichtbar · BESTÄTIGT

`GET /api/time-entries` wurde per Route-Interception auf **HTTP 500** gezwungen, dann die Seite neu geladen. Ergebnis:

```
A/ Sonner-Toasts:      []
A/ role=status|alert:  [""]        (leerer Toast-Container, keine Meldung)
A/ Seitentext: "Kalender Absenzen Analytics Profil ... Hallo, Verify
   August 2026 Heute Ferien eintragen Standardwoche anwenden
   Mo Di Mi Do Fr Sa So 1 2 3 8.4h 4 8.4h 5 8.4h ..."
```

**Kein Toast, kein Fehlertext, kein Wiederholen-Knopf.** Der Befund ist sogar schärfer als im Audit beschrieben: Die Seite wirkt nicht einmal "leer". Sie rendert einen vollständig normal aussehenden Monatskalender mit **Sollstunden (8.4h) an jedem Werktag** — nur die tatsächlich erfassten Einträge fehlen. Eine Nutzerin hat damit **keinerlei Anhaltspunkt**, dass etwas fehlgeschlagen ist; sie sieht einen Monat, in dem ihre Zeiten verschwunden zu sein scheinen. Screenshot: `verification/shot-a-500.png`.

### Kunde löschen ohne jede Rückfrage · BESTÄTIGT (end-to-end durch die Oberfläche)

Angemeldet als Rolle **`member`**, Profilseite, Abschnitt "Kundenverwaltung". Die Zeile enthält genau zwei Knöpfe:

```
DOM: { schritt: "geklickt", buttons: 2,
       svgKlassen: ["lucide lucide-pencil ...", "lucide lucide-trash2 ..."] }
Modal nach Klick: 0 | nativer confirm(): false
Toast: ["Kunde gelöscht"]
Kunden in DB: 1 -> 0
ERGEBNIS: GELOESCHT OHNE JEDE RUECKFRAGE
```

Ein einzelner Klick auf das Papierkorb-Symbol — **direkt neben dem Bearbeiten-Stift** — löscht den Kunden. Es erscheint weder ein `AlertDialog` noch ein natives `confirm()`. Die einzige Rückmeldung ist ein Erfolgs-Toast **nach** der Löschung. Zusammen mit V1 (Kaskadenregeln) und V4 (Route liefert 200 für `member`) ist der kritische Fund damit auf allen drei Ebenen belegt: Datenbank, Endpunkt und Oberfläche.

> **Aufwand ehrlich vermerkt:** Dieser Nachweis brauchte fünf Anläufe. Ursachen waren durchweg auf meiner Seite — zu frühe Eingabe vor der React-Hydration (der Anmelde-Knopf blieb `disabled`), ein zu teurer Locator-Ausdruck, der in den Timeout lief, und ein falscher Icon-Klassenname (`lucide-trash-2` statt `lucide-trash2`). Am geprüften Code lag keiner dieser Fehlschläge.

---

## Aufräumen und Unversehrtheit der echten Daten

Nach Abschluss aller schreibenden Tests:

```
CLEAN verbleibende Wegwerf-Orgs: 0

Reale Datenmengen: { customers: 2, projects: 3,
                     customermonths: 36, entries_with_customer: 183 }
```

Identisch zum Stand vor Beginn der Verifikation (siehe V1). Es wurde kein einziger produktiver Datensatz verändert oder gelöscht, und kein Produktivcode angefasst — geschrieben wurde ausschliesslich in `verification/` sowie in `VERIFY_LOOP.md` und `VERIFY_LOOP_STATE.md`.

