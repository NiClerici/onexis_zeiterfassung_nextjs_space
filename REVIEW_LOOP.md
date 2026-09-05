# Code-Audit — ONEXIS Zeiterfassung

Vollständiger, batchweiser Audit der App. Erzeugt von einem `/loop`-Durchlauf.
**Es wurde kein Code geändert** — dies ist reine Dokumentation.

- Start: 2026-08-30
- Umfang: 162 Dateien (`app/`, `components/`, `lib/`, `hooks/`, `prisma/`, `scripts/`, `middleware.ts`), Testdateien ausgenommen
- Baseline: `typecheck` sauber, 460/460 Tests grün

---

## Ergebnis in Zahlen

| Schwere | Anzahl |
|---|---|
| KRITISCH | 1 |
| HOCH | 11 |
| MITTEL | 50 |
| NIEDRIG | 24 |
| **Gesamt** | **86** |

Geprüft wurden alle 162 Dateien in 16 Batches. Vier Funde wurden im Verlauf des Audits nach genauerer Prüfung **korrigiert oder entschärft** (siehe Abschnitt "Was sich im Verlauf als falsch erwies") — diese Korrekturen sind an den betroffenen Funden selbst vermerkt. Ein weiterer Fund (Kundenerfassung als Sackgasse für `member`, Batch 5) wurde **nach Abschluss des Audits** aus einer Beobachtung im laufenden Betrieb nachgetragen.

---

## Top-Prioritäten

Sortiert nach Schwere. Die Reihenfolge innerhalb einer Stufe folgt dem geschätzten Schaden.

### Sofort (KRITISCH)
1. **Jedes Mitglied kann Kunden löschen** — ein Klick auf einen Papierkorb ohne Rückfrage in der Profilseite löscht kaskadierend alle Projekte des Kunden, alle `CustomerMonth`-Migrationswerte und die Kundenzuordnung sämtlicher Zeiteinträge der Organisation. Kein Soft-Delete, kein Audit, keine Rollenprüfung. *Einzeiler als Sofortmassnahme: `requireRole(role, ["owner","admin"])` in `DELETE /api/customers` und `DELETE /api/projects`.*

### Zeitnah (HOCH)
2. **Speichern eines migrierten Eintrags verdoppelt Arbeits- und Kundenstunden** — betrifft direkt die Monate April–Juli, für die sowohl Legacy-Zeilen als auch `CustomerMonth`-Werte existieren.
3. **Mitglieder können die Grundlage ihrer eigenen Sollstunden verändern** — `pensum`, `startDate` u.a. gehen ungeprüft und ohne Rollenprüfung in die Datenbank; wirkt direkt auf den Überstundensaldo.
4. **Rollenentzug und Deaktivierung wirken bis zu 24 Stunden nicht** — der Mechanismus zur Behebung existiert bereits im `jwt`-Callback, ihm fehlen nur die Felder.
5. **`feriensaldo()` ignoriert `exitDate`** — falscher Ferienanspruch in jeder Schlussabrechnung.
6. **Nachtarbeit vor 06:00 wird nicht erkannt** — der ArG-Kontrollexport verfehlt genau den Zweck, für den er gebaut wurde.
7. **Nicht-numerische Stundenzahl passiert die Validierung als NaN** — vergiftet Monatssummen dauerhaft.
8. **Excel-Import kürzt Stunden endgültig** — betrifft die Migration der Altdaten, wo Fehler am längsten unentdeckt bleiben.
9. **IP-Rate-Limit per Header aushebelbar** — Credential-Spraying über viele Konten ist ungebremst.
10. **Registrierung ohne Rate-Limit** — einziger öffentlicher Auth-Endpunkt ohne Begrenzung.
11. **Race Condition beim Bulk-Anlegen von Absenzen** — Doppelklick auf "Ferien eintragen" kann Ferientage doppelt zählen.
12. **Ein Mitglied kann Kunden anlegen, aber nicht sehen** — der angelegte Kunde verschwindet sofort aus der Liste und lässt sich danach weder bebuchen noch mit einem Projekt versehen; ein zweiter Versuch scheitert mit "Kunde existiert bereits". *Der Fix existiert im Projekt bereits als `Project.createdBy` und wurde nie auf `Customer` übertragen.*

### Danach (MITTEL, thematisch gebündelt)
- **Rechenkern:** widersprüchliche Mitternachts-Konvention zwischen drei Modulen · zukünftige Auszahlung senkt heutige Überstunden · Verrechnungsgrad >100% bei Teilmonaten · Analytics-Verlauf überspringt Monate bei Start am 29.–31.
- **Datenpflege:** Absenzstunden werden nur bei Pensum-Änderungen neu berechnet, nicht bei Feiertags- oder Stammdatenänderungen · Kundenstunden-Korrektur auf 0 ist an zwei Stellen unmöglich · Standardwoche überschreibt Krankheitstage.
- **Sicherheit/Nachvollziehbarkeit:** Passwortänderung beendet Sitzungen nicht · Mitgliedschaftsänderungen ohne Audit · Überstunden-Auszahlungen ohne Rollenprüfung und ohne Audit · Nutzerlimit greift beim Einladen statt beim Beitreten.
- **Betrieb:** SMTP-Ausfall schreibt Reset-Links ins Log und meldet Erfolg · Organisationsexport und Datei-Upload ohne Speichergrenze · Lasttest-Seed mit 14 `deleteMany` ist ungeschützt · die Schutzprüfung vor dem Seeden verschluckt eigene Fehler.
- **Bedienbarkeit:** fehlgeschlagene Ladevorgänge sind unsichtbar (app-weit) · Analytics zeigt alte Zahlen unter neuer Beschriftung · Rollenwechsel feuert ohne Rückfrage.

---

## Querschnittliche Muster

Diese vier Muster erklären zusammen den Grossteil der 85 Funde. Wer sie an der Wurzel behebt, erledigt jeweils mehrere Einzelfunde.

**1. Die Bibliothek verlässt sich auf die Disziplin ihrer Aufrufer.**
Mehrfach hält eine Funktion ihre dokumentierte Zusage nicht und ist nur deshalb sicher, weil jeder heutige Aufrufer zusätzlich selbst prüft: `canSeeUser()` prüft die Organisation nicht (alle vier Aufrufer scopen selbst), `PLAN_LIMITS[plan] ?? null` bedeutet "unbegrenzt" (beide Schreibwege validieren selbst), `createAbsenceEntries()` hat keine Zeitraumgrenze (zwei von drei Aufrufern begrenzen). Jedes Mal ist der Standardwert bei Unkenntnis der **offene**, nicht der geschlossene. Der nächste Aufrufer, der die Zusatzprüfung vergisst, öffnet eine echte Lücke.

**2. Dieselbe Regel ist mehrfach implementiert und läuft auseinander.**
Die Mitternachts-Konvention steht dreimal im Code, zweimal als `<=` und einmal als `<` — mit Kommentaren, die behaupten, es sei dieselbe. `parseDateYMD` existiert in fünf Fassungen, von denen nur eine den Kalendertag validiert. Die Monatsiteration gibt es zweimal, eine davon überspringt Monate. Der Rollenschutz der Seiten ist viermal einzeln ausformuliert. Das Projekt weiss um die Gefahr — `lib/arbeitszeit.ts` und `lib/project-visibility.ts` wurden ausdrücklich als gemeinsame Quelle angelegt —, hat sie aber nicht überall angewandt. Dasselbe Muster zeigt sich beim Henne-Ei-Problem frisch angelegter Entitäten: Für `Project` wurde es ausdrücklich gelöst (`createdBy`, dokumentiert in `lib/project-visibility.ts`), für `Customer` nie übertragen — mit der Folge, dass die vorhandene Reparatur im Tagesdialog wieder wirkungslos wird, sobald ein Kunde fehlt (siehe Batch 5, "Kundenerfassung ist für die Rolle \"member\" eine Sackgasse").

**3. Lesepfade schweigen, Schreibpfade sprechen.**
Ausnahmslos jede Ladefunktion der Produktseiten folgt `if (res.ok) { setState(...) }` **ohne** `else`. Fällt eine Anfrage aus, erscheint keine Meldung — die Seite zeigt leere oder veraltete Daten. Die Schreibpfade derselben Dateien behandeln Fehler dagegen sauber mit Toasts, und die `/dev`-Komponenten sind durchweg vorbildlich. Für eine Zeiterfassung ist ausgerechnet der stille Lesefehler der teuerste: Der Nutzer sieht seine Stunden verschwinden und muss annehmen, dass Daten verloren gingen.

**4. Die Testabdeckung ist breit, aber sie endet vor den Rändern.**
460 Tests sind grün, und die betroffenen Module sind fast alle getestet — die Fehler sitzen trotzdem drin, weil die Tests jeweils den *Normalfall* des Konzepts abdecken und nicht den Aufrufer, bei dem es bricht:
- `compliance.test.ts` prüft Nachtarbeit — aber nur Schichten, die 23:00 **überschreiten**. Der Fall "Schicht beginnt um 04:00" fehlt, und genau dort liegt der Fehler. Der Test *"meldet KEINE Nachtarbeit bei einer Tagschicht"* besteht aus dem falschen Grund.
- `calc.test.ts` hat einen ganzen `describe`-Block zu `exitDate` — aber nur für `sollStundenTag`/`kennzahlen`. Dass `feriensaldo()` dasselbe Feld ignoriert, fällt durch.
- `lib/rate-limit.ts` hat **keinen** Test, und beide dortigen Funde sind sicherheitsrelevant.

Empfehlung: keine "mehr Tests"-Kampagne, sondern gezielt für jedes geprüfte Konzept die Liste seiner Aufrufer durchgehen und je einen Randfall ergänzen.

---

## Was sich im Verlauf als falsch erwies

Ein Audit, der nur Belastendes berichtet, ist nicht vertrauenswürdig. Vier Einschätzungen aus frühen Batches haben spätere Prüfungen widerlegt oder relativiert; sie sind an den Funden selbst vermerkt:

1. **"Ein `member` kann `/admin/team` öffnen und die volle Oberfläche sehen"** (Batch 2) — **falsch**. Alle vier geschützten Seiten sichern sich selbst ab. Der Fund wurde auf NIEDRIG umgeschrieben (vierfache Duplizierung, greift nicht bei `role === null`).
2. **"Kein Aufrufer wertet `geklemmt` aus"** (Batch 4) — **falsch**. Der Tagesdialog zeigt den Hinweis an. Der Fund gilt nur noch für die beiden Massenpfade.
3. **"Die Graduierung migrierter Zeilen ist eine stille Umdeutung"** (Batch 4) — **ungenau**. Sie ist beabsichtigt und dem Nutzer angekündigt. Der Fund betrifft ihre unangekündigte Doppelzählungs-Folge, nicht die Graduierung selbst.
4. **"Wachsende `LoginAttempt`-Tabelle verursacht Full Scans"** (Batch 2) — **entkräftet**. Die passenden Indizes existieren. Übrig bleibt Speicherwachstum ohne Löschfrist.

Ausserdem bestätigte sich ein befürchtetes **Mandanten-Leck ausdrücklich nicht**: Alle Routen führen `orgId` im `where` mit, `export?scope=person` bricht zusätzlich mit 404 ab. Und ein Fund wurde in die andere Richtung korrigiert — der kritische Kunden-Löschpfad erwies sich als **schlimmer** als zunächst angenommen (per Klick erreichbar statt nur über die API).

---

## Gesamteinschätzung: Ist die App produktiv brauchbar?

**Ja — mit einer Einschränkung, die zuerst behoben werden muss.**

Der Rechenkern ist die Stärke dieser Anwendung. Er ist Prisma-frei gehalten, konsequent auf UTC gerechnet, ausführlich begründet und mit 460 Tests abgesichert. Die Kommentare erklären durchgehend nicht nur *was*, sondern *warum* — inklusive früherer Fehlentscheidungen und ihrer Korrektur. Die Mandantentrennung hält an jeder geprüften Stelle. Der Tagesdialog, die Auth-Routen, das Datenmodell und die Betriebsoberfläche sind sauber gebaut. Das ist deutlich mehr Sorgfalt, als man in einer internen Zeiterfassung üblicherweise findet.

**Vor dem produktiven Einsatz zwingend:** Der kritische Fund. Ein versehentlicher Klick auf ein Papierkorb-Symbol in der Profilseite — erreichbar für jede Rolle, ohne Rückfrage — vernichtet unwiederbringlich die Kundenzuordnung sämtlicher Zeiteinträge und die von Hand rekonstruierten Migrationswerte. Das ist kein hypothetisches Angriffsszenario, sondern ein plausibler Fehlgriff neben dem Bearbeiten-Stift. Die Sofortmassnahme kostet zwei Zeilen.

**Danach zügig:** Die drei HOCH-Funde, die *Zahlen* verfälschen, statt nur Zugriff zu regeln — die Doppelzählung beim Speichern migrierter Einträge, der fehlende `exitDate`-Anteil im Feriensaldo und die ungeprüften Profilfelder. Sie wirken alle auf Werte, die in den Lohnexport gehen, und keiner von ihnen macht sich in der Oberfläche bemerkbar. Falsche Zahlen, die plausibel aussehen, sind in einer Zeiterfassung teurer als ein Absturz.

Davon zu unterscheiden ist ein weiterer HOCH-Fund (Batch 5), der keine Zahl verfälscht, sondern die *Eingabe* verhindert: Ein Mitglied kann Kunden anlegen, aber nie sehen — die Kundenerfassung ist für jede Rolle ausser Admin/Owner faktisch unbenutzbar, sobald keine Buchungshistorie existiert. Für eine Organisation, die neue Mitarbeitende aufnimmt, ist das vor dem produktiven Einsatz ebenso relevant wie die drei oben genannten.

**Einschränkend zur Aussagekraft dieses Audits:** Er ist rein statisch. Es wurde kein Code ausgeführt, nichts im Browser geprüft und keine Last erzeugt. Die Aussagen zu Speicherverbrauch und Laufzeiten sind aus dem Code abgeleitet, nicht gemessen. Vier Fehleinschätzungen wurden im Verlauf selbst entdeckt und korrigiert — es ist realistisch, dass unter den verbleibenden 86 Funden weitere sind, die einer Prüfung am laufenden System nicht standhalten. Jeder Fund nennt Datei und Zeile, damit das nachprüfbar bleibt.

---

## Funde

## Batch 1 — Rechenkern (`lib/calc.ts`, `arbeitszeit`, `billing`, `holidays`, `absence-*`, `entry-overlap`, `compliance`, `customer-months`)

### [SCHWERE: HOCH] Nachtarbeit vor 06:00 wird nicht erkannt
- Datei: lib/compliance.ts:127-136 (`ueberschneidetNachtzeit`)
- Problem: Die Funktion prüft nur zwei Nachtfenster — `[23:00, 24:00)` und `[24:00, 30:00)` (also die Nacht am *Ende* der Schicht). Das Fenster `[00:00, 06:00)` des Tages selbst fehlt. Eine Schicht, die morgens vor 06:00 beginnt und nicht über Mitternacht geht, berührt keines der beiden Fenster.
- Konkretes Fehlerszenario: Eintrag Dienstag `04:00–08:00`. → `vonMin=240`, `bisMin=480`. Fenster 1: `240 < 1440 && 480 > 1380` → false. Fenster 2: `240 < 1800 && 480 > 1440` → false. Ergebnis: `hatNachtarbeit = false`. Tatsächlich liegen 2h (04:00–06:00) in der Nachtzeit nach Art. 16 ArG. Der ArG-Kontrollexport (`app/api/export/arg-control/route.ts`) meldet diese Nachtarbeit damit nicht — genau der Fall, für den der Export existiert.
- Vorschlag: Drittes Fenster `[0, NACHT_ENDE_MIN]` ergänzen, oder das Nachtfenster generell als `[-1440+…]`-Modulo-Prüfung über die Spanne rechnen. Testfall `04:00–08:00` und `05:00–13:00` ergänzen.

### [SCHWERE: HOCH] `feriensaldo()` ignoriert `exitDate` — voller Jahresanspruch bei Austritt
**BEHOBEN (04.09.2026):** `feriensaldo()` rechnet den Anspruch jetzt über die Monatsspanne von Ein- UND Austritt in einem Ausdruck (`lib/calc.ts`). Tests in `lib/calc.test.ts` ("Ferienanspruch am Jahresrand") decken Austritt allein, Ein- und Austritt im selben Jahr sowie den Datenfehler-Randfall ab.

- Datei: lib/calc.ts:499-506
- Problem: Der Ferienanspruch wird nur beim EINTRITT anteilig gerechnet (`startDate.getUTCFullYear() === jahr`). Ein Austritt mitten im Jahr wird nicht berücksichtigt, obwohl `Profil.exitDate` vorhanden ist und `sollStundenTag()` (calc.ts:204) es korrekt auswertet.
- Konkretes Fehlerszenario: Person mit 25 Ferientagen, Eintritt 2020, Austritt 31.03.2026. Abfrage `feriensaldo({jahr: 2026, …})` → `anspruch = 25` statt der anteiligen 6.25 Tage. Hat die Person bis März 5 Tage bezogen, zeigt die App `offen = 20` — bei der Schlussabrechnung wird eine Ferienauszahlung von 20 Tagen ausgewiesen, die nicht besteht.
- Vorschlag: Analog zur Eintrittsregel kürzen, wenn `exitDate` im abgefragten Jahr liegt (`anspruch * austrittsMonat / 12`), und beide Kürzungen kombinierbar machen (Ein- UND Austritt im selben Jahr).

### [SCHWERE: HOCH] Race Condition: doppelte Absenz-Einträge bei parallelem Bulk-Anlegen
- Datei: lib/absence-entries.ts:82-97 (Lesen) vs. 158-186 (Schreiben); prisma/schema.prisma (TimeEntry ohne `@@unique`)
- Problem: `existing` wird VOR der Transaktion gelesen, die `create`-Aufrufe laufen danach in der Transaktion. Zwischen Lesen und Schreiben liegt ein Fenster. Auf DB-Ebene gibt es keinen Schutz: `model TimeEntry` hat nur `@@index([userId, date])` und `@@index([orgId, date])`, keinen Unique-Constraint über `(userId, date, type)`.
- Konkretes Fehlerszenario: Nutzer klickt "Ferien eintragen" für 13.–17.07. doppelt (Doppelklick oder zweiter Tab). Beide Requests lesen `existing = []`, beide legen je 5 Einträge an → 10 `ferien`-Zeilen. `feriensaldo()` (lib/calc.ts:515-524) summiert alle → 10 statt 5 bezogene Ferientage. `pruefeEintragKonflikte()` greift hier nicht, weil `createAbsenceEntries` es gar nicht aufruft.
- Vorschlag: `@@unique([userId, date, type])` (partiell, wo `deletedAt IS NULL`) in der DB, oder das `findMany` in dieselbe Transaktion ziehen und mit `SELECT … FOR UPDATE`/Serializable-Isolation absichern. Zusätzlich: Idempotenzschlüssel pro Bulk-Request.

### [SCHWERE: MITTEL] Mitternachts-Konvention widerspricht sich zwischen drei Modulen
- Datei: lib/calc.ts:225 (`<`) vs. lib/compliance.ts:69,82 (`<=`) vs. lib/entry-overlap.ts:51 (`<=`)
- Problem: `stundenAusEintrag()` verlängert nur bei `bisMin < vonMin` um 24h, `compliance.ts` und `entry-overlap.ts` bei `bisMin <= vonMin`. Beide Dateien behaupten im Kommentar ausdrücklich, "dieselbe Konvention" zu verwenden. Für `von === bis` laufen sie auseinander.
- Konkretes Fehlerszenario: Eintrag `08:00–08:00` (Tippfehler oder bewusst leere Zeile). `stundenAusEintrag` → **0h**, fliesst also mit 0 in `ist`. `nettoArbeitsstunden` in compliance.ts → **24h** → Warnung *"Tagesarbeitszeit von 24.0h überschreitet die Höchstgrenze von 12.5h"* für einen Eintrag, den die App selbst mit 0h bewertet. `spanne()` in entry-overlap.ts → Spanne 08:00–32:00, kollidiert damit mit *jedem* anderen Eintrag des Tages → falsche Überlappungswarnung.
- Vorschlag: Eine gemeinsame, exportierte Hilfsfunktion (z.B. `spanneInMinuten(von, bis)`) in `lib/calc.ts`, die alle drei Module importieren. Entscheidung für `<` oder `<=` explizit dokumentieren und testen.

### [SCHWERE: MITTEL] Zukünftige Auszahlung senkt die heutigen Überstunden
- Datei: lib/calc.ts:316-323
- Problem: `soll` und `ist` werden nur bis `bisHeute` gerechnet (Zeile 269-271), `payoutSum` dagegen über den vollen Zeitraum `[from, to]`. Die Subtraktion `ueberstunden = ist - soll - payoutSum` mischt damit zwei verschiedene Zeithorizonte.
- Konkretes Fehlerszenario: Zeitraum 01.01.–31.12.2026, heute 30.08.2026, Überstunden-Auszahlung von 20h mit Datum 15.12.2026 bereits erfasst. → `ist`/`soll` bis 30.08., aber `payoutSum = 20`. Der angezeigte Überstundensaldo ist heute um 20h zu niedrig; die Person sieht z.B. 5h statt 25h und glaubt, ihre Überstunden seien weg.
- Vorschlag: `payoutSum` auf `[from, bisHeute]` filtern (konsistent mit `ist`/`soll`), oder zukünftige Payouts separat als `payoutGeplant` ausweisen und nur in `prognoseSaldo` verrechnen.

### [SCHWERE: MITTEL] `feriensaldo()` zählt migrierte Zeilen mit, `kennzahlen()` nicht
- Datei: lib/calc.ts:515-524 vs. lib/calc.ts:299
- Problem: `kennzahlen()` überspringt Einträge mit `countsAsWorktime === false` explizit. `feriensaldo()` filtert nur auf `typ === "ferien"` und kennt dieses Feld nicht.
- Konkretes Fehlerszenario: Ein migrierter Altdatensatz mit `type="ferien"` und `countsAsWorktime=false` (das Feld ist laut `prisma/schema.prisma` auf jeder TimeEntry-Zeile setzbar, nicht auf `arbeit` beschränkt) zählt in `bezogen` mit, ist aber in `ist`/`soll` unsichtbar. Feriensaldo und Stundensaldo widersprechen sich für dieselbe Person.
- Vorschlag: Dieselbe `countsAsWorktime === false`-Ausnahme in `feriensaldo()` ergänzen — oder, falls das fachlich nicht gewollt ist, den Unterschied im Doc-Kommentar von `FeriensaldoInput` festhalten und per Test fixieren.

### [SCHWERE: MITTEL] Eine bewusst auf 0 korrigierte Migrationszahl wird von Legacy-Daten überschrieben
- Datei: lib/customer-months.ts:161
- Problem: `fromMigration += cm > 0 ? cm : legacy` — es wird auf den WERT geprüft, nicht auf die EXISTENZ der `CustomerMonth`-Zeile. Der dokumentierte Vorrang "CustomerMonth gewinnt über Legacy" gilt damit für jeden Wert ausser 0.
- Konkretes Fehlerszenario: Admin stellt fest, dass die Legacy-Zeilen für Kunde X im April 2026 komplett falsch sind, und trägt `CustomerMonth(April, Kunde X) = 0` ein, um sie zu neutralisieren. → `cm = 0`, also `cm > 0` false, also wird `legacy` (z.B. 96.75h) genommen. Die Korrektur hat keinerlei Wirkung; die App zeigt weiter die falschen 96.75h, und der Admin hat keine Möglichkeit, das über die Oberfläche zu beheben.
- Vorschlag: Auf Existenz prüfen — `customerMonthByCustomer.has(customerId) ? cm : legacy`.

### [SCHWERE: MITTEL] Verrechnungsgrad kann >100% erreichen bei Teilmonats-Zeiträumen
- Datei: lib/customer-months.ts:30-34 (Zähler) i.V.m. lib/calc.ts:332 (Nenner)
- Problem: Die Kundenstunden werden monatsweise ermittelt, überlappende Monate zählen laut Modulkommentar VOLL. Die `arbeitsstunden` im Nenner werden dagegen tagesgenau auf `[from, bisHeute]` gerechnet. Bei einem Zeitraum, der keinen vollen Monat umfasst, sind Zähler und Nenner nicht mehr derselbe Zeitraum.
- Konkretes Fehlerszenario: Custom-Auswertung 10.04.–20.04.2026. Nenner: ~11 Arbeitstage ≈ 70h. Zähler: Kundenstunden des GESAMTEN April, z.B. 102.8h. → `verrechnungsgrad = 146.9%`. Ein Prozentwert über 100 ist für den Nutzer nicht als Artefakt erkennbar, sondern sieht nach einem Datenfehler aus.
- Vorschlag: Entweder den Wert bei unvollständigen Monaten unterdrücken (`null` statt einer Zahl) und in der UI "nur für volle Monate verfügbar" anzeigen, oder auf 100% kappen und kennzeichnen. Die Modulkommentar-Warnung "Aufrufer sollten das kennzeichnen" reicht nicht — sie ist nicht erzwungen.

### [SCHWERE: MITTEL] Absenzstunden werden nur bei Pensum-Änderungen neu berechnet
- Datei: lib/absence-entries.ts:196-233 (`recomputeAbsenceHours`), einziger Aufrufer app/api/pensum-changes/route.ts:126,199
- Problem: Der gespeicherte Stundenwert einer Absenz hängt laut `sollStundenTag()` von DREI Dingen ab: Pensum-Änderungen, Feiertagen und den Membership-Feldern (`basePensum`, `baseWeeklyHours`, `startDate`, `exitDate`). Nachgezogen wird er nur bei Pensum-Änderungen.
- Konkretes Fehlerszenario: Person trägt Ferien für den 02.01.2027 ein (8.4h gespeichert). Danach legt der Admin unter *Admin → Feiertage* nachträglich den Berchtoldstag (02.01.) als Feiertag an. `sollStundenTag` liefert für diesen Tag jetzt 0, der TimeEntry steht aber weiter auf 8.4h. Die Person hat einen Ferientag "verbraucht", der keiner ist — und `ist` enthält 8.4h auf einem Tag mit Soll 0. Gleiches gilt beim nachträglichen Ändern von `startDate`/`exitDate` in der Teamverwaltung.
- Vorschlag: `recomputeAbsenceHours` (bzw. eine Variante mit `previousHolidays`/`currentHolidays`) auch aus der Feiertags-Route und aus der Membership-Aktualisierung aufrufen.

### [SCHWERE: MITTEL] Unbegrenzte Einzel-Inserts in einer Transaktion mit 30s-Timeout
- Datei: lib/absence-entries.ts:158-186 und 239-259
- Problem: `createAbsenceEntries` erzeugt pro Tag einen einzelnen `tx.timeEntry.create()`-Roundtrip in einer Schleife innerhalb der Transaktion; der Zeitraum ist in der Funktion nicht begrenzt. `recomputeAbsenceHours` lädt zusätzlich ALLE Absenz-Einträge des Nutzers ohne Datumsfilter (Zeile 230-233) und aktualisiert sie einzeln.
- Konkretes Fehlerszenario: Unbezahlter Urlaub 01.01.2027–31.12.2027 → ~260 Werktage → 260 sequenzielle `INSERT`-Roundtrips in einer Transaktion. Auf einer nicht-lokalen DB (Latenz ~50ms) sind das ~13s allein an Roundtrips; bei zwei Jahren reisst der `timeout: 30000` und die gesamte Erfassung schlägt fehl — nach mehreren Sekunden Wartezeit und ohne Teilergebnis. Bei `recomputeAbsenceHours` wächst das Problem mit jedem Betriebsjahr, ohne dass sich am Auslöser etwas ändert.
- Vorschlag: `tx.timeEntry.createMany()` für die Creates. Für `recomputeAbsenceHours` das `findMany` auf den betroffenen Zeitraum ab dem frühesten `effectiveFrom` der geänderten PensumChange filtern. Zusätzlich einen harten Maximalzeitraum (z.B. 366 Tage) in `createAbsenceEntries` prüfen und sonst 400 zurückgeben.

### [SCHWERE: MITTEL] Unbekannter Plan-Wert öffnet das Nutzerlimit statt es zu schliessen
- Datei: lib/billing.ts:40,49
- Problem: `org.plan as Plan` ist ein reiner TypeScript-Cast ohne Laufzeitprüfung — `Organization.plan` ist im Schema ein freier String. `PLAN_LIMITS[info.plan]?.maxUsers ?? null` liefert für jeden unbekannten Wert `null`, und `null` bedeutet in `checkUserLimit` (Zeile 53) **unbegrenzt**. Ebenso liefert `isTrialExpired` (billing-rules.ts:27) für alles ausser `"trial"` sofort `false`.
- Konkretes Fehlerszenario: Über die Dev-Route wird `plan = "enterprise"` (Tippfehler oder neuer Plan ohne Eintrag in `PLAN_LIMITS`) gesetzt. → `maxUsers = null` → `withinLimit` immer `true` → unbegrenzt Einladungen; gleichzeitig nie read-only. Der Fehler fällt nicht auf, weil er sich als "funktioniert" äussert.
- Vorschlag: Fail-closed — unbekannte Plan-Werte auf `"trial"` abbilden oder einen Fehler werfen, und `plan` beim Schreiben gegen `PLAN_LIMITS` validieren statt nur zu casten.
- **Nachtrag nach Prüfung aller Schreibwege (Batch 6 und 12):** Es gibt **keinen** Pfad, der einen unbekannten Plan-Wert schreibt. `lib/dev-actions.ts:41` validiert gegen `VALID_PLANS`, `scripts/set-plan.ts:33` ebenso, und eine andere Schreibstelle für `Organization.plan` existiert nicht (ausser direktem SQL, das der Kopfkommentar des Skripts ausdrücklich als den einzigen weiteren Weg nennt). Der Fund bleibt als **latente Falle** bestehen — die Sicherheit ruht allein auf der Disziplin der beiden Aufrufer, während der Standardwert der Auswertung "unbegrenzt" lautet. Die Einstufung MITTEL bezieht sich darauf, nicht auf eine offene Lücke.

### [SCHWERE: MITTEL] Nachtschichten lassen sich im Stunden-Modus nicht erfassen
- Datei: lib/arbeitszeit.ts:47-55
- Problem: `buildArbeitszeit()` klemmt das berechnete Ende hart auf 23:59, obwohl `stundenAusEintrag()` (lib/calc.ts:225) Schichten über Mitternacht ausdrücklich unterstützt. Das `geklemmt`-Flag meldet es zwar, verhindert den Datenverlust aber nicht.
- Konkretes Fehlerszenario: Startzeit `22:00`, 6 Stunden eingetragen. → `rawEndMinutes = 1320 + 360 + 15 = 1695`, geklemmt auf `23:59`. Gespeichert wird `22:00–23:59`, also 1.98h statt 6h — vier Stunden Arbeitszeit verschwinden. Wäre das Ende als `04:15` gespeichert worden, hätte `stundenAusEintrag` korrekt 6h gerechnet.
- Vorschlag: Statt zu klemmen `endMinutes % 1440` verwenden und das Ende als Uhrzeit des Folgetags schreiben — die Auswertung kommt damit bereits zurecht. `geklemmt` dann nur noch für Eingaben > 24h.

### [SCHWERE: NIEDRIG] `checkUserLimit` ist check-then-act ohne Sperre
- Datei: lib/billing.ts:47-53
- Problem: Zählen und anschliessendes Anlegen der Mitgliedschaft laufen in getrennten Operationen ohne Transaktion oder Sperre.
- Konkretes Fehlerszenario: Trial-Org mit `maxUsers: 5` und 4 aktiven Mitgliedern. Zwei Einladungen werden gleichzeitig angenommen; beide lesen `currentCount = 4`, beide bestehen `4 < 5` → 6 aktive Mitglieder in einem Plan mit Limit 5.
- Vorschlag: Zählen und Anlegen in einer Transaktion mit Serializable-Isolation, oder das Limit als DB-Constraint/Trigger abbilden. Praktische Relevanz gering (kleine Teams), aber der Fix ist billig.

### [SCHWERE: NIEDRIG] Ferien-Pro-Rata rechnet auf Monatsebene und rundet zugunsten des Eintritts
- Datei: lib/calc.ts:502
- Problem: `(ferientage * (13 - startMonat)) / 12` zählt den Eintrittsmonat immer voll, unabhängig vom Tag.
- Konkretes Fehlerszenario: Eintritt am 31.03.2026 → `startMonat = 3` → `anspruch = 25 * 10 / 12 = 20.8` Tage. Tatsächlich gearbeitet werden 9 Monate + 1 Tag, anteilig wären es 18.8 Tage. Zwei Tage zu viel pro Person.
- Vorschlag: Bewusste Entscheidung — entweder taggenau (`verbleibendeTage / 365`) rechnen oder die Monatsregel im Doc-Kommentar als bewusste Kulanz festhalten, damit sie nicht später als Bug "korrigiert" wird.

### [SCHWERE: NIEDRIG] 1. Mai fehlt in den kantonalen Feiertagen
- Datei: lib/holidays.ts:68-83
- Problem: `kantonaleFeiertage()` kennt Berchtoldstag, Fronleichnam, Mariä Himmelfahrt, Allerheiligen und den Jura-Kantonsfeiertag — der Tag der Arbeit (1. Mai) fehlt vollständig, obwohl er u.a. in ZH, BS, BL, SH, TG und AG arbeitsfrei ist.
- Konkretes Fehlerszenario: Organisation mit `canton = "ZH"`, Seed für 2026. Der 01.05.2026 (Freitag) bekommt kein Holiday. `sollStundenTag()` liefert volles Tagessoll, obwohl niemand arbeitet — der Monatssaldo Mai ist für jede Person in Zürich um ein Tagessoll zu negativ.
- Vorschlag: `{ date: 1. Mai, canton, halfDay: false }` für die betroffenen Kantone ergänzen. (Feiertage sind laut Kommentar auch ohne Codeänderung als Holiday-Zeilen nachpflegbar — das ist aber Handarbeit pro Organisation und Jahr.)

### [SCHWERE: NIEDRIG] Absenz-Einträge mit 0h werden auf Feiertagen und ausserhalb der Anstellung angelegt
- Datei: lib/absence-entries.ts:126-130
- Problem: Die Tagesschleife überspringt nur Wochenenden und `skipDates`. Für Feiertage, für Tage vor `startDate` und nach `exitDate` liefert `getDailyRateForDate()` zwar korrekt 0, es wird aber trotzdem ein `TimeEntry` mit `hours: 0` erzeugt.
- Konkretes Fehlerszenario: Ferienantrag 23.12.–31.12.2026 wird genehmigt. Für den 25. und 26.12. (Feiertage) entstehen zusätzliche `ferien`-Zeilen mit 0h. Im Kalender erscheinen sie als Ferientage neben dem Feiertag; `groupAbsenceRanges` zählt sie in `days` mit, sodass die Absenzübersicht "7 Tage" statt der tatsächlich bezogenen 5 anzeigt.
- Vorschlag: Tage mit `hours === 0` überspringen und als `skipped` zählen.

### [SCHWERE: NIEDRIG] Ungültige Zeitangabe schaltet alle ArG-Warnungen stumm
- Datei: lib/compliance.ts:44-47
- Problem: `parseZeitInMinuten` in dieser Datei validiert nicht (anders als die gleichnamige Funktion in lib/entry-overlap.ts:34-41, die bei ungültigem Format `null` liefert). Bei unparsbarem Wert entsteht `NaN`, und jeder anschliessende Vergleich (`NaN > 12.5`, `NaN < 30`) ist `false`.
- Konkretes Fehlerszenario: Eine Zeile mit `von = ""` oder `bis = "9.30"` gelangt aus einem Import in die DB. `pruefeCompliance` liefert für diesen Tag **keine einzige Warnung** — nicht einmal die Pausen- oder Höchstarbeitszeitprüfung schlägt an. Der Nutzer liest das als "alles in Ordnung".
- Vorschlag: Die validierende Variante aus `entry-overlap.ts` gemeinsam nutzen und bei `null` entweder den Eintrag überspringen oder eine eigene Warnung "Zeitangabe unlesbar" ausgeben.

### [SCHWERE: NIEDRIG] `teamKennzahlen().totals` enthält keine Überzeit
- Datei: lib/calc.ts:441-451, 484-491
- Problem: Jedes `TeamMemberResult` hat `ueberzeit`, das `totals`-Objekt nicht. Eine Teamsicht kann die gesetzliche Überzeit deshalb nur pro Person, nie als Summe zeigen.
- Konkretes Fehlerszenario: Kein Rechenfehler — aber die Kennzahl, die für den Arbeitgeber haftungsrelevant ist (Überschreitung der wöchentlichen Höchstarbeitszeit im gesamten Team), lässt sich aus dem Rückgabewert nicht ablesen, ohne über `members` selbst zu summieren.
- Vorschlag: `ueberzeit: round1(members.reduce(…))` in `totals` ergänzen — additiv, bricht keinen Aufrufer.

### [SCHWERE: NIEDRIG] Feiertagssuche läuft linear in der Tagesschleife
- Datei: lib/calc.ts:212 i.V.m. 258-261
- Problem: `sollStundenTag()` sucht den Feiertag mit `holidays.find()` (O(n)), und `summeSollstunden()` ruft es für jeden Kalendertag auf. `teamKennzahlen()` wiederholt das je Person.
- Konkretes Fehlerszenario: Teamsicht über ein Jahr, 20 Personen, 12 Feiertage → 365 × 12 × 20 ≈ 88 000 Vergleiche pro Aufruf, dazu je Tag ein neues `Date`-Objekt in `toUTCDate`. Kein Fehler, aber messbare Latenz auf der Teamseite, die mit Teamgrösse × Zeitraum wächst.
- Vorschlag: Die Feiertage einmal in eine `Map<number, HolidayInput>` (Key: `getTime()`) vorberechnen und an `sollStundenTag` durchreichen, oder `summeSollstunden` die Map intern aufbauen lassen.

## Batch 2 — Auth & Zugriffskontrolle (`access`, `auth-options`, `dev-access`, `token`, `password-policy`, `rate-limit`, `audit`, `error-log`, `db`, `middleware`)

### [SCHWERE: HOCH] Rollenentzug und Deaktivierung wirken bis zu 24 Stunden nicht
- Datei: lib/access.ts:49-56 i.V.m. lib/auth-options.ts:70-105
- Problem: `requireOrg()` — der Helfer, über den laut Modulkommentar *jede* API-Route ihre Berechtigung bezieht — liest `orgId` und `role` ausschliesslich aus dem JWT. Der `jwt`-Callback validiert nach dem Login nur noch `plan` und `trialEndsAt` stündlich gegen die DB (Zeile 93-104). `role`, `orgId` und der Mitgliedschafts-`status` werden **nie** erneut geprüft. Die Session läuft 24h (`maxAge`, Zeile 66).
- Konkretes Fehlerszenario: Ein Mitarbeiter verlässt die Firma. Die Admin setzt seine Membership in `/admin/team` auf `status: "inaktiv"`. Der Mitarbeiter ist noch eingeloggt → sein Token trägt weiter `role: "manager"`, `orgId: "…"`. Er kann bis zu 24 Stunden lang Zeiteinträge anlegen, ändern, löschen und Teamdaten exportieren. Beim nächsten Login greift die Sperre (auth-options.ts:38-42) — vorher nicht. Dasselbe gilt für eine Rückstufung `admin → member`: die Person behält Admin-Rechte bis zum Token-Ablauf.
- Vorschlag: Im `jwt`-Callback dieselbe TTL-Prüfung, die es für `plan` bereits gibt, auf die Membership ausweiten — `role`, `orgId` und `status` mitladen und die Session bei `status !== "aktiv"` verwerfen (`return null`). Der Mechanismus ist vorhanden, ihm fehlen nur die Felder.

### [SCHWERE: HOCH] IP-Rate-Limit lässt sich per Header aushebeln — Credential-Spraying ungebremst
- Datei: lib/rate-limit.ts:37-41 (`getClientIp`)
- Problem: Die Client-IP wird ungeprüft aus `x-forwarded-for` übernommen, und zwar der **erste** Eintrag der Liste. Genau dieser Eintrag stammt vom Client und ist frei wählbar; ein Reverse Proxy wie Caddy hängt seinen Wert hinten an, statt die Liste zu ersetzen. Es gibt keine Liste vertrauenswürdiger Proxy-IPs und kein Abschneiden auf die letzten n Einträge.
- Konkretes Fehlerszenario: Ein Angreifer schickt bei jedem Loginversuch einen anderen Wert im Header, z.B. `X-Forwarded-For: 10.0.0.<zufall>`. Damit landet jeder Versuch in einem eigenen IP-Bucket, der Zähler erreicht nie `MAX_ATTEMPTS = 10`. Übrig bleibt nur der E-Mail-Bucket — der schützt ein einzelnes Konto, aber nicht gegen Spraying: ein Passwort (`Sommer2026!`) gegen 5000 bekannte E-Mail-Adressen ist je Adresse nur 1 Versuch und wird von keinem der beiden Zähler gebremst.
- Vorschlag: Die Client-IP aus dem Verbindungs-Peer bzw. dem letzten (proxy-nächsten) XFF-Eintrag ableiten und die Anzahl vertrauenswürdiger Proxy-Hops konfigurierbar machen. Zusätzlich einen dritten Zähler pro `action` global (z.B. max. 100 Fehlversuche/Minute organisationsweit), der Spraying auch ohne verlässliche IP erkennt.

### [SCHWERE: MITTEL] Passwortänderung beendet bestehende Sitzungen nicht
- Datei: lib/auth-options.ts:64-105 i.V.m. app/api/auth/reset-password/route.ts:42, app/api/profile/route.ts:141
- Problem: Die Session-Strategie ist `jwt` — es gibt keine serverseitige Sitzungstabelle. Im Token existiert kein `tokenVersion`/`passwordChangedAt`-Feld, und der `jwt`-Callback prüft auch keines. Ein einmal ausgestelltes Token bleibt damit bis `maxAge` (24h) gültig, egal was mit dem Passwort passiert.
- Konkretes Fehlerszenario: Eine Nutzerin merkt, dass jemand Zugriff auf ihr Konto hat, und setzt über "Passwort vergessen" ein neues Passwort. Die Sitzung des Angreifers läuft unverändert weiter — bis zu 24 Stunden lang, mit vollem Schreibzugriff. Die Handlung, die das Problem beheben soll, behebt es nicht.
- Vorschlag: `passwordChangedAt` auf `User` speichern, beim Login in den Token schreiben und im `jwt`-Callback (in derselben TTL-Prüfung wie `plan`) gegen die DB abgleichen — bei Abweichung `return null`. Deckt Reset, Profiländerung und ein späteres "überall abmelden" mit ab.

### [SCHWERE: MITTEL] Middleware schützt nur 5 von 9 App-Seiten
- Datei: middleware.ts:17 (`PROTECTED_PAGE_PREFIXES`) und middleware.ts:65 (`config.matcher`)
- Problem: Matcher und Prefix-Liste nennen `/calendar`, `/analytics`, `/profile`, `/set-password`, `/dev`. Die App hat unter `app/(app)/` zusätzlich `/team`, `/absences`, `/admin/holidays`, `/admin/legal` und `/admin/team` — für diese Pfade läuft die Middleware gar nicht erst an. Der Schutz beruht dort allein auf `app/(app)/layout.tsx:58-70`, einer `"use client"`-Komponente, die erst nach dem Laden des JS-Bundles per `useEffect` umleitet.
- Konkretes Fehlerszenario: Ein nicht eingeloggter Besucher öffnet `/admin/team`. Statt einer sofortigen 307-Umleitung auf `/login` (wie bei `/calendar`) lädt der Browser das komplette App-Bundle, rendert kurz die Shell und springt erst dann zurück. Auf einer langsamen Verbindung ist das ein mehrere Sekunden sichtbarer Zustand. Die Inkonsistenz ist ausserdem eine Falle für künftige Seiten: wer eine neue Route unter `(app)/` anlegt, bekommt keinen Middleware-Schutz, ohne es zu merken.
- Vorschlag: Matcher und Prefix-Liste auf die Routengruppe umstellen statt Pfade einzeln zu pflegen (z.B. alle Pfade ausser `/login`, `/register`, `/invite`, `/forgot-password`, `/reset-password`, `/api/auth` schützen). Datenlecks entstehen hierdurch nicht — die API-Routen prüfen eigenständig —, es geht um Verlässlichkeit und Erweiterbarkeit.

### [SCHWERE: NIEDRIG] Rollenschutz der Seiten ist vierfach dupliziert und greift bei fehlender Rolle nicht
- Datei: app/(app)/admin/team/page.tsx:96,304 · app/(app)/admin/holidays/page.tsx:55-58,131 · app/(app)/admin/legal/page.tsx:35-38,121 · app/(app)/team/page.tsx:80-83,142
- **Diese Bewertung wurde in Batch 8 nach Prüfung der Seiten korrigiert.** Ursprünglich stand hier, das Layout gebe nur die Tabs rollenabhängig aus und die Seiten selbst seien ungeschützt — ein `member` könne `/admin/team` direkt öffnen und die vollständige Teamverwaltung sehen. **Das trifft nicht zu:** Jede der vier geschützten Seiten bringt ihre eigene Absicherung mit, jeweils als `router.replace("/calendar")` im Effect **und** einem `return null` im Render-Pfad. Die Seite wird also nicht angezeigt.
- Problem (was bleibt): Dieselbe Schutzlogik ist in vier Dateien einzeln ausformuliert, jedes Mal leicht anders geschrieben, und alle vier Varianten prüfen `role && role !== …` — bei **falsy** `role` greift der Schutz nicht. Genau dieser Fall ist erreichbar: Wer keine aktive Mitgliedschaft hat, bekommt laut `lib/auth-options.ts:49-50` `role: null` in die Session (siehe Fund "Login ohne aktive Mitgliedschaft führt in eine Sackgasse").
- Konkretes Fehlerszenario: Ein deaktiviertes Mitglied meldet sich an und ruft `/admin/team` auf. `role` ist `null`, also ist `role && role !== "owner" && role !== "admin"` insgesamt `null` — kein Redirect, kein `return null`. Die vollständige Teamverwaltungs-Oberfläche wird gerendert. Daten fliessen nicht ab (`requireRole` in der API greift korrekt), aber die Person sieht eine Verwaltungsmaske, die ihr nicht zusteht, in einer Organisation, aus der sie entfernt wurde.
- Vorschlag: Die Prüfung einmal zentral im Layout aus einer Zuordnung `pfad → erlaubte Rollen` ableiten (die Liste existiert dort bereits für die Tabs) und dabei fail-closed formulieren: bei fehlender oder unbekannter Rolle sperren statt durchlassen.

### [SCHWERE: MITTEL] Login ohne aktive Mitgliedschaft führt in eine Sackgasse ohne Erklärung
- Datei: lib/auth-options.ts:38-50 i.V.m. lib/access.ts:54
- Problem: `authorize()` gibt auch dann einen Nutzer zurück, wenn `findFirst({ status: "aktiv" })` nichts findet — `orgId` und `role` sind dann `null`. Der Login ist erfolgreich. Jede anschliessende API-Anfrage scheitert in `requireOrg()` mit 403 *"Keine Organisation zugeordnet"*.
- Konkretes Fehlerszenario: Ein deaktiviertes Mitglied meldet sich am nächsten Tag an. Der Login funktioniert (kein Hinweis, dass etwas nicht stimmt), die App lädt, und dann schlägt jede Kachel mit einem Fehler fehl. Die Person weiss nicht, ob die App kaputt ist oder ihr Zugang entzogen wurde, und meldet einen vermeintlichen Bug.
- Vorschlag: In `authorize()` `return null` liefern, wenn keine aktive Mitgliedschaft existiert, und auf der Login-Seite eine eigene Meldung anzeigen ("Dein Zugang wurde deaktiviert — bitte wende dich an deine Administratorin").

### [SCHWERE: MITTEL] `canSeeUser`/`listVisibleUserIds` prüfen weder Organisation noch Status der Zielperson
- Datei: lib/access.ts:99-110 und 120-128
- Problem: Für `admin`/`owner` gibt `canSeeUser()` bedingungslos `true` zurück — ohne zu prüfen, ob `targetUserId` überhaupt zur Organisation des Aufrufers gehört. Der Modulkommentar (Zeile 1-4) beschreibt diese Helfer aber als "der einzige Weg" zur Mandantentrennung. Auch der Mitgliedschafts-`status` wird nirgends berücksichtigt: `listVisibleUserIds()` liefert für einen Manager alle `managerId`-Zuordnungen inklusive deaktivierter Personen.
- Konkretes Fehlerszenario: Eine Route, die dem dokumentierten Muster folgt (`if (!(await canSeeUser(ctx, targetUserId))) return 403;` und danach `prisma.timeEntry.findMany({ where: { userId: targetUserId } })` **ohne** `scopeToOrg`), gibt einem Admin die Zeiteinträge einer Person aus einer FREMDEN Organisation zurück. Die Prüfung sagt "ja", obwohl sie die Mandantengrenze gar nicht betrachtet hat. Ob eine solche Route existiert, ist in Batch 4-7 zu verifizieren — der Helfer selbst hält seine dokumentierte Zusage jedenfalls nicht.
- Vorschlag: In `canSeeUser()` für alle Rollen zuerst prüfen, dass eine `Membership(orgId: ctx.orgId, userId: targetUserId)` mit `status: "aktiv"` existiert, und erst danach die Rollenhierarchie auswerten.
- **Nachtrag nach Batch 4-6 (vollständige Prüfung aller Aufrufer):** Es gibt derzeit **kein** ausnutzbares Mandanten-Leck. Alle vier Aufrufer von `canSeeUser()` (`month-locks`, `absence-requests`, `export?scope=person`, `time-entries`) führen `orgId` im anschliessenden `where` mit; `export?scope=person` bricht zusätzlich mit 404 ab, wenn keine `Membership(orgId, userId)` existiert (app/api/export/route.ts:158). Der Fund bleibt bestehen, aber als **latente Falle**: Der Helfer hält seine dokumentierte Zusage nicht, und die Sicherheit hängt allein daran, dass jeder heutige und künftige Aufrufer zusätzlich selbst scopet. Die Einstufung MITTEL bezieht sich auf dieses Risiko, nicht auf eine bestehende Lücke.

### [SCHWERE: MITTEL] `LoginAttempt` und `ErrorLog` wachsen unbegrenzt
- Datei: lib/rate-limit.ts:68-70, lib/error-log.ts:34-42 — kein Aufräumjob im Repo (`grep` über `scripts/` und `app/api/` findet keinen Löschpfad)
- Problem: Beide Tabellen werden nur beschrieben, nie beschnitten. `isRateLimited()` zählt über `createdAt >= since`, liest also mit wachsender Tabelle immer mehr Zeilen, die für das 15-Minuten-Fenster längst irrelevant sind.
- Konkretes Fehlerszenario: Ein anhaltender Bot-Angriff erzeugt über Wochen Millionen `LoginAttempt`- und `ErrorLog`-Zeilen, die nie wieder gelesen werden. Das Datenvolumen wächst monoton, Backups (deploy/backup.sh) werden entsprechend grösser und langsamer, und `LoginAttempt` speichert dabei dauerhaft E-Mail-Adressen und IP-Adressen — personenbezogene Daten ohne Löschfrist.
- **Nachtrag aus Batch 7 — teilweise entwarnt:** Die befürchteten Full Scans treten **nicht** auf: `prisma/schema.prisma:267-268` definiert genau die passenden Indizes `@@index([action, email, createdAt])` und `@@index([action, ip, createdAt])`, `ErrorLog` hat `@@index([createdAt])` und `@@index([source, createdAt])`. Der Fund reduziert sich damit auf Speicherwachstum und die fehlende Aufbewahrungsfrist — die Einstufung MITTEL bezieht sich darauf, nicht mehr auf ein Performanceproblem.
- Vorschlag: Einen Aufräum-Job (Cron oder ein `deleteMany` mit 1% Wahrscheinlichkeit in `recordAttempt`) für Zeilen älter als 24h ergänzen; `ErrorLog` z.B. nach 90 Tagen. Passende Indizes im Schema prüfen (siehe Batch 7, `prisma/schema.prisma`).

### [SCHWERE: NIEDRIG] Benutzerkonten sind über Antwortzeiten unterscheidbar
- Datei: lib/auth-options.ts:29
- Problem: `const isValid = user ? await bcrypt.compare(…) : false;` — existiert die E-Mail nicht, wird `bcrypt.compare` übersprungen und die Antwort kommt sofort. Existiert sie, kostet der Hash-Vergleich typischerweise 50-150ms.
- Konkretes Fehlerszenario: Ein Angreifer prüft eine Liste von E-Mail-Adressen mit einem beliebigen Passwort und misst die Antwortzeit. Adressen mit ~100ms Verzögerung sind registrierte Konten. Das Ergebnis ist die Zielliste für das oben beschriebene Spraying.
- Vorschlag: Bei unbekannter E-Mail gegen einen fest hinterlegten Dummy-Hash vergleichen, damit beide Pfade dieselbe Arbeit leisten.

### [SCHWERE: NIEDRIG] Gesperrter Login ist von einem falschen Passwort nicht unterscheidbar
- Datei: lib/auth-options.ts:24-26
- Problem: Bei aktiver Sperre liefert `authorize()` `null` — dasselbe Ergebnis wie bei falschem Passwort. Die Login-Seite kann deshalb nur "E-Mail oder Passwort falsch" anzeigen.
- Konkretes Fehlerszenario: Jemand vertippt sich zehnmal, gibt danach das richtige Passwort ein und bekommt weiterhin "E-Mail oder Passwort falsch". Die Person hält ihr Konto für gelöscht oder ihr Passwort für geändert und startet einen Passwort-Reset, der das eigentliche Problem (15 Minuten warten) nicht löst.
- Vorschlag: Bei aktiver Sperre eine unterscheidbare Meldung ausgeben ("Zu viele Versuche — bitte in einigen Minuten erneut probieren"). Das verrät nichts über die Existenz des Kontos, wenn die Sperre auch für unbekannte E-Mails greift.

### [SCHWERE: NIEDRIG] Fehlerprotokoll speichert Stacktraces und Rohmeldungen unbefristet
- Datei: lib/error-log.ts:30-42
- Problem: `message` und `stack` werden unverändert gespeichert und in `/dev` angezeigt. Prisma-Fehlermeldungen enthalten je nach Fehlerart Ausschnitte der Query-Parameter.
- Konkretes Fehlerszenario: Ein Constraint-Verstoss beim Anlegen eines Nutzers erzeugt eine Prisma-Meldung, die die betroffene E-Mail-Adresse enthält. Diese landet dauerhaft in `ErrorLog` und ist in der Developer-Übersicht lesbar — ausserhalb der Mandantengrenze, da `/dev` bewusst org-übergreifend ist.
- Vorschlag: Aufbewahrungsfrist setzen (siehe Fund oben) und die gespeicherte `message` auf eine Maximallänge kürzen bzw. bekannte PII-Muster (E-Mail-Adressen) vor dem Schreiben maskieren.

## Batch 3 — Import/Export & restliche Lib-Module (`import-timesheet`, `export-helpers`, `org-export`, `dev-actions`, `dev-metrics`, `project-visibility`, `mail`, `types`, `utils`, `i18n`)

### [SCHWERE: HOCH] Excel-Import überschreibt die importierte Stundenzahl stillschweigend
- Datei: lib/import-timesheet.ts:304-307 i.V.m. lib/calc.ts:219-228
- Problem: Für `arbeit`-Zeilen ohne Von/Bis in der Datei leitet der Parser die Zeiten über `buildArbeitszeit(hours)` ab. Das `geklemmt`-Flag, das `buildArbeitszeit()` genau für diesen Fall zurückgibt, wird beim Destrukturieren in Zeile 305 weggeworfen. Die schreibende Route verwirft anschliessend die originale Stundenzahl: `hours: r.type === "arbeit" ? null : r.hours` (app/api/import/timesheet/route.ts:101). Gespeichert bleiben damit **ausschliesslich** die abgeleiteten, möglicherweise gekürzten Zeiten — der Ausgangswert aus der Datei existiert danach nirgends mehr, auch nicht als Korrekturgrundlage.
- *(Korrigiert nach Prüfung der Route in Batch 6: ursprünglich war hier notiert, `hours` werde zusätzlich gespeichert und von `stundenAusEintrag()` nur ignoriert. Tatsächlich wird der Wert gar nicht erst geschrieben — der Datenverlust ist damit endgültig statt nur verdeckt.)*
- Konkretes Fehlerszenario: Eine Altdatei enthält für den 12.03.2024 die Zeile `16.0 Stunden, Typ "Arbeitszeit"`, ohne Von/Bis-Spalten (das Alt-Format hat sie laut Modulkommentar gar nicht). `buildArbeitszeit(16)` rechnet: Start 480 Min. + 960 Min. + 60 Min. Pause = 1500 → über 23:59, also geklemmt auf `"23:59"`. Gespeichert wird `von=08:00, bis=23:59, pauseMin=60, hours=16`. Die App zeigt danach **14.98h** statt 16h. Über eine Jahresdatei summieren sich diese stillen Kürzungen zu einem falschen Überstundensaldo, ohne dass der Import auch nur eine Warnung ausgibt. Betroffen ist jede Zeile über ca. 15h.
- Vorschlag: `geklemmt` auswerten und die Zeile als `ImportRowError` melden statt sie zu kürzen. Grundsätzlicher: für Zeilen ohne Von/Bis in der Quelle gar kein Von/Bis erfinden, sondern nur `hours` speichern — `stundenAusEintrag()` kommt mit reinen `hours`-Zeilen zurecht (das ist laut `app/api/time-entries/route.ts:186` ausdrücklich ein unterstütztes Format).

### [SCHWERE: MITTEL] Import verwirft jede Zeile, die irgendwo das Wort "total" enthält
- Datei: lib/import-timesheet.ts:186-191 (`isTotalRow`), aufgerufen in 270 und 146
- Problem: `isTotalRow` durchsucht **alle** Spalten der Zeile und liefert `true`, sobald der getrimmte, kleingeschriebene Zellinhalt exakt `"total"` ist. Die Zeile wird dann ohne Fehlermeldung und ohne Zählung übersprungen. Gedacht ist das für die Summenzeile des Exports — die Prüfung unterscheidet aber nicht zwischen "Summenzeile" und "Zelle mit diesem Inhalt".
- Konkretes Fehlerszenario: Jemand hat in der Notiz-Spalte einer regulären Arbeitszeile schlicht `Total` stehen (etwa als Kürzel oder Kundenname). Die Zeile verschwindet beim Import spurlos: sie erscheint weder in `rows` noch in `errors`. Der Nutzer sieht die Erfolgsmeldung "X Zeilen importiert" und hat keine Möglichkeit zu bemerken, dass eine Zeile fehlt — bei einer Migration alter Jahresdaten fällt das erst Monate später über einen falschen Saldo auf.
- Vorschlag: Summenzeilen nur an der ersten Spalte (`datumCol`) erkennen, oder nur dann, wenn die Datumszelle leer und die Stundenzelle gefüllt ist. Übersprungene Zeilen zusätzlich in der Import-Zusammenfassung ausweisen.

### [SCHWERE: MITTEL] Formel- und Rich-Text-Zellen werden zu "[object Object]"
- Datei: lib/import-timesheet.ts:180-184 (`cellText`)
- Problem: `cellText` behandelt nur den ExcelJS-Zelltyp mit `.text` (Hyperlink). Formelzellen liefert ExcelJS als `{ formula, result }`, Rich-Text als `{ richText: [...] }` — beide haben kein `text`-Feld, fallen also in `String(v)` und ergeben `"[object Object]"`.
- Konkretes Fehlerszenario: In der Altdatei steht die Stundenspalte als Formel, z.B. `=(C2-B2)*24` — in einer selbstgebauten Excel-Zeiterfassung der Normalfall. Beim Import scheitert **jede** Zeile mit `Ungültige Stundenzahl: "[object Object]"`. Der Nutzer sieht eine Fehlerliste, aus der nicht hervorgeht, was er tun soll (die Zelle sieht in Excel ja nach einer Zahl aus). Steht die Formel in der Typ-Spalte, lautet die Meldung `Unbekannter Typ: "[object Object]"`.
- Vorschlag: In `cellText` zusätzlich `result` (Formelzellen) und `richText` (zusammengesetzter Text) auflösen. ExcelJS bietet dafür `cell.text` als bereits normalisierte Variante — die statt `cell.value` zu lesen, löst beide Fälle auf einmal.

### [SCHWERE: MITTEL] Widersprüchliche Import-Daten werden stumm zugunsten der Zeiten aufgelöst
- Datei: lib/import-timesheet.ts:296-303
- Problem: Sind Von/Bis **und** Stunden in der Datei vorhanden, wird die Pause als Differenz berechnet: `pauseMin = max(0, span - hours*60)`. Ist `hours` grösser als die Spanne, wird die Differenz negativ, `max(0, …)` macht daraus 0 — und die Stundenzahl aus der Datei ist damit wirkungslos, weil `stundenAusEintrag()` anschliessend aus Von/Bis rechnet.
- Konkretes Fehlerszenario: Zeile mit `Von 08:00, Bis 12:00, Stunden 6.0` (eine typische Inkonsistenz in handgepflegten Altdaten, z.B. weil nachmittags nachgetragen und die Zeit nie korrigiert wurde). Der Import meldet Erfolg, speichert 08:00–12:00 mit 0 Min. Pause, und die App rechnet mit **4h** statt der in der Datei stehenden 6h. Es gibt weder Fehler noch Warnung.
- Vorschlag: Wenn `hours * 60 > span`, die Zeile als `ImportRowError` melden ("Stundenzahl passt nicht zu Von/Bis") statt sie stillschweigend umzudeuten.

### [SCHWERE: MITTEL] `fmtDate` rechnet in lokaler Zeit, obwohl die App durchgehend UTC verwendet
- Datei: lib/export-helpers.ts:101-106
- Problem: `fmtDate` nutzt `getDate()`, `getMonth()`, `getFullYear()` — also die **lokalen** Getter. Zwei Funktionen weiter oben (Zeile 85-86) begründet dieselbe Datei ausdrücklich, warum überall UTC verwendet werden muss: `@db.Date`-Werte kommen als UTC-Mitternacht zurück. `fmtDate` formatiert die Datumsspalte des Hauptexports (`app/api/export/route.ts:256,325`). Eine `TZ`-Vorgabe gibt es weder im `Dockerfile` noch in `docker-compose.yml` noch in `.env.example` — die Korrektheit hängt allein am UTC-Default des Container-Images.
- Konkretes Fehlerszenario: Setzt jemand im Deployment `TZ` auf eine Zone westlich von UTC (z.B. `America/New_York` für einen Standort), wird aus dem gespeicherten `2026-04-10T00:00:00Z` lokal der **09.04.2026**. Jede Zeile des Excel-Exports trägt dann ein um einen Tag zu frühes Datum, inklusive der Zeitraum-Angabe im Kopf. Der Export bleibt in sich plausibel und ist deshalb schwer als falsch zu erkennen. Bei `Europe/Zurich` (östlich von UTC) tritt der Fehler nicht auf — die App funktioniert heute also nur, weil niemand `TZ` gesetzt hat.
- Vorschlag: `fmtDate` auf `getUTCDate()`/`getUTCMonth()`/`getUTCFullYear()` umstellen und zusätzlich `TZ=UTC` im `Dockerfile` bzw. in `docker-compose.yml` festschreiben, damit die Annahme explizit ist.

### [SCHWERE: MITTEL] Export-Zeitraum ohne Plausibilitäts- und Obergrenze
- Datei: lib/export-helpers.ts:81-99 (`parseExportRange`, Zweig `custom`)
- Problem: Für `type=custom` werden `from` und `to` übernommen, sobald sie ein gültiges Datum ergeben. Es wird weder geprüft, ob `from <= to` gilt, noch gibt es eine maximale Zeitraumlänge.
- Konkretes Fehlerszenario 1: `?type=custom&from=2026-12-31&to=2026-01-01`. `summeSollstunden()` (lib/calc.ts:255) liefert für `to < from` sofort 0, alle Kennzahlen werden 0. Der Nutzer bekommt eine vollständig aufgebaute, leere Excel-Datei ohne jeden Hinweis, dass sein Zeitraum verdreht war.
- Konkretes Fehlerszenario 2: `?type=custom&from=1900-01-01&to=2100-01-01`. `summeSollstunden()` iteriert dann rund 73 000 Kalendertage **pro Person**; beim Organisationsexport multipliziert sich das mit der Teamgrösse. Ein einzelner authentifizierter Nutzer kann damit den Node-Prozess minutenlang blockieren — und der Prozess bedient alle Mandanten.
- Vorschlag: In `parseExportRange` `from <= to` erzwingen (sonst `AccessError(400)`) und die Spanne auf einen sinnvollen Maximalwert begrenzen (z.B. 3 Jahre), analog zu den bereits vorhandenen Grenzen in `parseYearMonthFromUrl`.

### [SCHWERE: MITTEL] Ohne SMTP landet der Passwort-Reset-Link im Log und der Nutzer bekommt eine Erfolgsmeldung
- Datei: lib/mail.ts:41-47
- Problem: `sendMail()` prüft `isSmtpConfigured()` zur **Laufzeit** und schreibt bei fehlender Konfiguration den kompletten Nachrichtentext — inklusive des Reset-Links mit Klartext-Token — per `console.warn` ins Server-Log. Danach kehrt die Funktion **erfolgreich** zurück; für den Aufrufer ist der Versand nicht von einem echten Versand zu unterscheiden. Der Modulkommentar begründet das mit lokaler Entwicklung, der Code unterscheidet Entwicklung und Produktion aber nicht.
- Konkretes Fehlerszenario: In der Produktion fehlt `SMTP_PASSWORD` (Tippfehler in der `.env`, oder Secret nicht durchgereicht). Nutzer klicken "Passwort vergessen", sehen die Bestätigung *"Falls ein Konto existiert, wurde ein Link verschickt"* und warten auf eine Mail, die nie kommt. Gleichzeitig steht jeder gültige Reset-Token im Klartext in den Container-Logs — wer Logzugriff hat (Logaggregation, Monitoring, Backup), kann jedes Konto übernehmen. Der Fehler ist von aussen unsichtbar; entdeckt wird er erst über Nutzerbeschwerden.
- Vorschlag: In `NODE_ENV === "production"` bei fehlender SMTP-Konfiguration werfen statt zu loggen, damit der Aufrufer einen echten Fehler zurückgeben kann. Im Log-Fallback den Token nicht ausgeben, sondern nur den Pfad ohne Query-Parameter (die Dev-Variante über `/dev` liefert bereits einen Link — dieser Weg wird lokal also nicht gebraucht).

### [SCHWERE: MITTEL] Organisationsexport lädt alle Daten gleichzeitig in den Speicher
- Datei: lib/org-export.ts:9-55
- Problem: 14 Queries laufen parallel, jede ohne `take`, `skip` oder Streaming. Insbesondere `timeEntry.findMany({ where: { orgId } })` (bewusst inklusive soft-gelöschter Zeilen) und `timeEntryAudit.findMany({ where: { orgId } })` sind unbegrenzt. Anschliessend wird das gesamte Objekt zu JSON serialisiert — Objektgraph und String liegen währenddessen gleichzeitig im Speicher.
- Konkretes Fehlerszenario: Organisation mit 20 Personen nach 5 Jahren Betrieb ≈ 25 000 `TimeEntry`-Zeilen plus ein Mehrfaches an `TimeEntryAudit`-Zeilen (jede Feldänderung ist eine eigene Zeile). Ein Admin klickt "Organisationsdaten exportieren"; der Node-Prozess zieht mehrere hundert MB und läuft in einem typisch dimensionierten Container (512 MB–1 GB) ins OOM. Der Prozess bedient **alle** Mandanten — der Export einer Organisation nimmt damit sämtliche anderen mit offline.
- Vorschlag: Den Export als Stream ausliefern (`ReadableStream` mit chunkweisem JSON) und die grossen Tabellen in Seiten von z.B. 5 000 Zeilen über einen Cursor lesen, statt sie vollständig zu materialisieren.

### [SCHWERE: MITTEL] Organisationsexport beansprucht Vollständigkeit, lässt aber drei Tabellen aus
- Datei: lib/org-export.ts:1-5 (Zusage) vs. 25-55 (Umsetzung)
- Problem: Der Modulkommentar sagt, der Export sammle "wirklich ALLE Daten einer Organisation … damit der JSON-Export echte Datenportabilität/DSGVO-Auskunft abdeckt". Nicht enthalten sind `ErrorLog` (hat laut `lib/error-log.ts:39-40` eigene `orgId`- und `userId`-Spalten), `LoginAttempt` (E-Mail-Adresse, IP-Adresse, Zeitstempel je Anmeldeversuch) und `DevAction` (Betreiber-Eingriffe in genau diese Organisation, `lib/dev-actions.ts:27`).
- Konkretes Fehlerszenario: Eine Mitarbeiterin stellt ein Auskunftsersuchen nach DSG/DSGVO. Die Organisation liefert den Export aus — darin fehlen ihre gespeicherten Anmeldeversuche samt IP-Adressen und die Fehlerprotokolle, die ihre `userId` tragen. Die Auskunft ist damit unvollständig, und die Zusage im Code hat den Bearbeiter in Sicherheit gewiegt.
- Vorschlag: Die drei Tabellen ergänzen (bei `LoginAttempt` nach E-Mail statt nach `orgId` filtern, da sie keine `orgId` führt) — oder den Modulkommentar auf das ehrliche Mass zurücknehmen und die Auslassungen dort benennen.

### [SCHWERE: MITTEL] Rückwechsel auf "trial" erzeugt einen unbefristeten Testzeitraum
- Datei: lib/dev-actions.ts:49
- Problem: `data: { plan: newPlan, trialEndsAt: newPlan === "trial" ? org.trialEndsAt : null }` — beim Wechsel auf einen bezahlten Plan wird `trialEndsAt` auf `null` gesetzt. Wechselt man später zurück auf `trial`, wird das bereits genullte `org.trialEndsAt` übernommen, bleibt also `null`. `isTrialExpired()` (lib/billing-rules.ts:28) gibt bei `!trialEndsAt` sofort `false` zurück.
- Konkretes Fehlerszenario: Der Betreiber setzt eine Organisation versehentlich auf `pro`, bemerkt es und stellt über `/dev` auf `trial` zurück. Ergebnis: `plan = "trial"`, `trialEndsAt = null` → der Trial läuft **nie** ab, die Organisation bleibt dauerhaft schreibfähig, und die Kachel "Trials, die bald ablaufen" in `/dev` listet sie nie auf. Der Fehler ist unsichtbar, weil er sich als "funktioniert weiterhin" äussert.
- **Zweiter Fundort (Batch 12):** `scripts/set-plan.ts:51` enthält denselben Ausdruck (`trialEndsAt: plan === "trial" ? org.trialEndsAt : null`) und damit denselben Fehler. Eine Korrektur muss beide Stellen erfassen.
- Vorschlag: Beim Wechsel **auf** `trial` ein frisches `trialEndsAt` setzen (z.B. jetzt + Standard-Trialdauer), wenn das bisherige `null` oder abgelaufen ist — dieselbe Logik, die `extendOrgTrial()` in Zeile 74 bereits korrekt formuliert.

### [SCHWERE: MITTEL] `getOrgDetail` bricht als einzige Funktion die Fehlerkonvention des Moduls
- Datei: lib/dev-metrics.ts:273-352, Interface 243-271
- Problem: Der Modulkommentar (Zeile 2-4) legt fest: *"Jede Funktion fängt ihre eigenen Fehler und liefert `{ error }` statt zu werfen — eine kaputte Kachel darf nie die ganze Seite reissen."* `getPlatformSummary`, `getOrgOverview`, `getSystemHealth` und `getAuthHealth` halten sich daran. `getOrgDetail` hat weder ein `try`/`catch` noch ein `error`-Feld im Rückgabetyp.
- Konkretes Fehlerszenario: Bei einem DB-Problem (Verbindungsabbruch, Timeout auf der `$transaction` mit sieben Queries) wirft `getOrgDetail` durch. Die Seite `/dev/orgs/[slug]` liefert eine Server-Exception statt der Übersicht mit einer einzelnen Fehlerkachel — also genau das Verhalten, das der Modulkommentar ausschliessen wollte. Besonders unglücklich, weil `/dev` das Werkzeug ist, mit dem man Störungen untersuchen soll.
- Vorschlag: `getOrgDetail` in dasselbe `try`/`catch`-Muster überführen und `error?: string` im `OrgDetail`-Interface ergänzen.

### [SCHWERE: MITTEL] Developer-Übersicht summiert `hours` roh und untertreibt die Nutzung
- Datei: lib/dev-metrics.ts:300 (`bucket.hours += entry.hours ?? 0`)
- Problem: `TimeEntry.hours` ist laut `prisma/schema.prisma` nullable (`Float?`). Für Arbeitszeit-Einträge, die über Von/Bis erfasst wurden, ist die Stundenzahl **nicht** in dieser Spalte hinterlegt — sie wird überall sonst in der App über `stundenAusEintrag()` (lib/calc.ts:217) aus `von`/`bis`/`pauseMin` berechnet. `getOrgDetail` ist die einzige Stelle, die stattdessen die Rohspalte summiert und fehlende Werte mit `?? 0` ersetzt.
- Konkretes Fehlerszenario: Eine Organisation erfasst konsequent mit Von/Bis (der Normalweg im Tagesdialog). In `/dev/orgs/[slug]` zeigt die Spalte "Stunden" der Monatsnutzung dann nur die Absenzstunden — bei durchgehender Von/Bis-Erfassung nahe **0**, während "Einträge" korrekt in die Hunderte geht. Der Betreiber liest daraus "Organisation legt Einträge an, erfasst aber keine Zeit" und untersucht ein Problem, das nicht existiert.
- Vorschlag: `von`, `bis`, `pauseMin` und `type` mitselektieren und `stundenAusEintrag()` verwenden — dieselbe Funktion, die `lib/customer-months.ts:127` an vergleichbarer Stelle bereits korrekt aufruft.

### [SCHWERE: MITTEL] Fehlender Übersetzungsschlüssel erscheint als sichtbarer Text in der Oberfläche
- Datei: lib/i18n.tsx:506 (`translations?.[key] ?? key`)
- Problem: `translations` ist als `Record<string, string>` typisiert, `t()` nimmt `key: string`. Es gibt damit weder Typprüfung noch Laufzeitwarnung bei einem unbekannten Schlüssel — zurückgegeben wird der Schlüssel selbst.
- Konkretes Fehlerszenario: Jemand schreibt `t("calendar.typ.ferien")` statt `t("calendar.type.ferien")`. Die Oberfläche zeigt an dieser Stelle wörtlich `calendar.typ.ferien`. TypeScript meldet nichts, Tests bemerken es nicht, und da die Zeichenkette wie ein Platzhalter aussieht, fällt sie in der Entwicklung leicht durch — bis eine Nutzerin sie meldet.
- Vorschlag: `translations` mit `as const` deklarieren und den Schlüsseltyp daraus ableiten (`keyof typeof translations`), damit ein Tippfehler ein Compilerfehler wird. Ergänzend in der Entwicklung ein `console.warn` bei unbekanntem Schlüssel.

### [SCHWERE: NIEDRIG] Platzhalter werden nur beim ersten Vorkommen ersetzt
- Datei: lib/i18n.tsx:509
- Problem: `str.replace("{k}", v)` ersetzt bei einem String-Suchmuster nur das **erste** Vorkommen.
- Konkretes Fehlerszenario: Ein künftiger Text wie `"{name} hat {name} eingeladen"` wird zu `"Anna hat {name} eingeladen"`. Aktuell nutzt kein Eintrag im Katalog denselben Platzhalter doppelt — der Fehler wartet also auf den ersten, der es tut, und äussert sich dann als sichtbarer Platzhalter in der Oberfläche.
- Vorschlag: `replaceAll` verwenden oder auf ein globales `RegExp` umstellen.

### [SCHWERE: NIEDRIG] Toter Code aus der Projektvorlage
- Datei: lib/types.ts:1-23 (`Expense`, `ExpenseFormData`, `EXPENSE_CATEGORIES`), lib/utils.ts:8-14 (`formatDuration`)
- Problem: Diese Symbole stammen aus einer Ausgaben-Tracker-Vorlage und haben mit Zeiterfassung nichts zu tun. Eine Suche über `app/`, `components/`, `lib/` und `hooks/` findet ausserhalb ihrer Definitionsdatei **keinen** Verwender. Genutzt aus `lib/types.ts` wird nur `DateRange` (in `components/ui/date-range-picker.tsx`).
- Konkretes Fehlerszenario: Kein Laufzeitfehler. Der Schaden ist Orientierung: wer `lib/types.ts` öffnet, um die Domänentypen der App zu verstehen, findet dort Kategorien wie `"Food"` und `"Entertainment"` und muss erst herausfinden, dass das Fremdkörper sind. Bei einer späteren Erweiterung besteht die Gefahr, dass jemand darauf aufbaut.
- Vorschlag: `Expense`, `ExpenseFormData`, `EXPENSE_CATEGORIES` und `formatDuration` löschen; `DateRange` behalten.

### [SCHWERE: NIEDRIG] Zukünftig datierte Einträge gelten als Aktivität
- Datei: lib/dev-metrics.ts:25-31 (`activityStatus`), gespeist aus `_max: { date: true }` (Zeile 169)
- Problem: Als "letzte Aktivität" einer Organisation gilt das grösste `TimeEntry.date` — das ist ein **fachliches** Datum, das in der Zukunft liegen darf (geplante Ferien, Feiertage). `activityStatus` rechnet `now - lastActivity`; bei einem Zukunftsdatum wird `ageDays` negativ und fällt damit in `"aktiv"`.
- Konkretes Fehlerszenario: Eine Organisation trägt im Januar die Feiertage und Betriebsferien des ganzen Jahres ein und nutzt die App danach nicht mehr. In `/dev` steht sie bis Dezember auf "aktiv", obwohl seit elf Monaten niemand mehr etwas erfasst hat — genau die Kundensituation, die die Ampel sichtbar machen soll, wird verdeckt.
- Vorschlag: Auf `createdAt`/`updatedAt` der Einträge abstellen (Zeitpunkt der Erfassung statt des erfassten Tages), oder `_max: { date }` zusätzlich auf `date <= now` filtern.

## Batch 4 — Zeiterfassungs-API (`time-entries` + `bulk-apply`/`bulk-vacation`, `month-locks`, `pensum-changes`, `overtime-payouts`, `absence-requests`, `absences/calendar`, `holidays`, `customer-months`)

> **Positivbefund vorab:** Die gezielte Suche nach einem Mandanten-Leck (`canSeeUser()` ohne `orgId` im `where`, offener Punkt aus Batch 2) verläuft für diesen Batch **negativ** — `month-locks`, `absence-requests`, `absences/calendar`, `pensum-changes` und `customer-months` führen `orgId` ausnahmslos im `where` mit. Bleibt offen für Batch 5-7.

### [SCHWERE: HOCH] Speichern eines migrierten Eintrags verdoppelt Arbeits- und Kundenstunden
- Datei: app/api/time-entries/route.ts:316 (`countsAsWorktime: true` im `nextState`) i.V.m. prisma/schema.prisma (Kommentar zu `TimeEntry.countsAsWorktime`) und lib/customer-months.ts:71,128
- Problem: `PUT` setzt `countsAsWorktime` bei jedem Speichern auf `true` ("Graduierung"). Das ist **beabsichtigt und dem Nutzer angekündigt** — `components/day-entry-dialog.tsx:461-463` blendet für solche Zeilen den Hinweis ein: *"Nur Projektzeit aus dem Import — zählt erst zur Arbeitszeit, sobald diese Zeile hier gespeichert wird."* Nicht angekündigt und nicht abgefangen ist die **Nebenwirkung**: `lib/customer-months.ts` verteilt Einträge anhand dieses Flags auf zwei Töpfe (`fromEntriesSums` vs. `legacySums`), und `combineCustomerHours()` **addiert** `fromEntries + fromMigration`. Der Schutz "CustomerMonth gewinnt über Legacy" wirkt nur innerhalb von `fromMigration`; sobald eine Legacy-Zeile nach `fromEntries` wandert, greift er nicht mehr. Parallel gilt für die Arbeitszeit, was das Schema zu `countsAsWorktime` festhält: `false` existiert, *"damit migrierte Alt-Zuordnungen die parallel schon erfasste, echte Arbeitszeit desselben Tages nicht verdoppeln"* — die Graduierung hebt genau diesen Schutz auf.
- *(In Batch 9 präzisiert: ursprünglich als stillschweigende, sich widersprechende Umdeutung beschrieben. Die Graduierung selbst ist bewusst gewählt und wird angezeigt — der Fund betrifft ihre unangekündigte Doppelzählungs-Folge.)*
- Konkretes Fehlerszenario: Ein migrierter April-Tag trägt eine Legacy-Zeile (`countsAsWorktime=false`, Kunde Swissgrid, 8h); für den April existiert zusätzlich ein `CustomerMonth`-Wert von 102.8h, der dieselben Stunden abbildet. Der Nutzer öffnet diesen Tag im Kalender, korrigiert nur die Notiz und speichert. Die Zeile wird graduiert. Ab sofort gilt: **Kundenstunden April = 102.8h (CustomerMonth) + 8h (jetzt `fromEntries`) = 110.8h**, und dieselben 8h zählen zusätzlich in `ist`/`arbeitsstunden` (lib/calc.ts:299 überspringt nur noch `false`). Verrechnungsgrad, Monatssaldo und Überstunden springen — ausgelöst durch eine Notizänderung. Der Modulkommentar in `customer-months.ts` beschreibt exakt diesen Doppelzählungs-Bug als *"das war der Bug: April–Juli hatten beides, wurden also verdoppelt"* — die Graduierung stellt ihn eintragsweise wieder her.
- Vorschlag: `countsAsWorktime` beim Graduieren nur dann auf `true` setzen, wenn für denselben (userId, Jahr, Monat, Kunde) **kein** `CustomerMonth`-Wert existiert — andernfalls diesen beim Graduieren im selben Vorgang um die graduierten Stunden reduzieren oder löschen. Den Hinweistext im Dialog entsprechend ergänzen, solange für den Monat noch ein Migrationswert existiert.

### [SCHWERE: HOCH] Nicht-numerische Stundenzahl passiert die Validierung als NaN
**BEHOBEN (04.09.2026):** `parseHours()` in `app/api/time-entries/route.ts` prüft jetzt mit `Number.isFinite`, für POST und PUT und für jeden Eintragstyp. Tests in `lib/time-entries-conflict-route.test.ts`.

- Datei: app/api/time-entries/route.ts:173 (POST) und 272-273 (PUT)
- Problem: `clampedHours = Math.max(0, Math.min(24, Number(hours)))`. Für einen nicht-numerischen Wert ist `Number(hours)` gleich `NaN`, und sowohl `Math.min(24, NaN)` als auch `Math.max(0, NaN)` ergeben wieder `NaN`. Die anschliessende Prüfung `arbeitszeitIstGueltig(von, bis, hours)` (Zeile 32-36) testet nur `hours != null` — und `NaN != null` ist `true`. `NaN` passiert damit **beide** Zweige der Gültigkeitsprüfung. Für alle Nicht-Arbeitszeit-Typen (`ferien`, `krank`, …) findet ohnehin keinerlei Prüfung von `hours` statt.
- Konkretes Fehlerszenario: `POST /api/time-entries` mit `{ date: "2026-04-10", type: "ferien", hours: "acht" }`. `clampedHours` wird `NaN`, keine Prüfung greift, der Wert geht an Prisma. Entweder landet `NaN` als Float in der Datenbank — dann liefert `stundenAusEintrag()` (lib/calc.ts:229) `NaN`, und `ist`, `ueberstunden`, `feriensaldo` sowie jeder Export für diesen Monat sind dauerhaft `NaN`, ohne dass die Oberfläche eine Ursache anzeigt — oder Prisma lehnt den Wert ab und der Nutzer bekommt einen 500er auf eine reine Eingabevalidierung. Der Kommentar in Zeile 15-18 beschreibt exakt diese Fehlerklasse als für `von`/`bis` behoben; für `hours` besteht sie fort.
- Vorschlag: `Number.isFinite()` prüfen, bevor geklemmt wird, und bei Fehlschlag mit 400 antworten — für **alle** Typen, nicht nur `arbeit`.

### [SCHWERE: MITTEL] Standardwoche überschreibt Krankheits-, Militär- und Unbezahlt-Tage
- Datei: app/api/time-entries/bulk-apply/route.ts:177-180
- Problem: Beim Anwenden der Standardwoche mit `overwriteExisting` schützt die Route ausdrücklich nur zwei Typen: `if (ex.type === "ferien" || ex.type === "feiertag")`. `krank`, `militaer` und `unbezahlt` fallen in den `else`-Zweig und werden in `type: "arbeit"` umgeschrieben (Zeile 185-190).
- Konkretes Fehlerszenario: Jemand war im März eine Woche krank (5 Einträge `krank`). Anfang April füllt er den März über "Standardwoche anwenden" mit `overwriteExisting` auf, weil einzelne Tage fehlten. Die fünf Krankheitstage werden zu Arbeitszeit-Einträgen à 8.4h. Die Krankheitsabwesenheit ist aus den Daten verschwunden — relevant für Lohnfortzahlung und Krankentaggeld —, die Rückmeldung nennt nur `updated: 5`, und rückgängig machen lässt sich das nur über den Audit-Trail. Dass `ferien` geschützt ist und `krank` nicht, ist für den Nutzer nicht erkennbar.
- Vorschlag: Alle Absenztypen schützen (`ex.type !== "arbeit"`) statt einer Positivliste aus zwei Werten — dann wirkt `overwriteExisting` nur noch auf Arbeitszeit, was der Erwartung entspricht.

### [SCHWERE: MITTEL] Auch `bulk-apply` verwirft die Kürzungswarnung von `buildArbeitszeit()`
- Datei: app/api/time-entries/bulk-apply/route.ts:186 und 191
- Problem: Beide Aufrufe destrukturieren `const { von, bis, pauseMin } = buildArbeitszeit(hours)` und lassen `geklemmt` fallen. Die Stundenwerte stammen hier aus `membership.stdHoursMon`…`stdHoursSun`.
- **Korrigiert in Batch 9:** Ursprünglich stand hier, **kein** Aufrufer werte das Flag aus. Das ist falsch — `components/day-entry-dialog.tsx:546` zeigt bei `geklemmt` den Hinweis *"Das Ende wurde auf 23:59 begrenzt."* an. Der interaktive Weg meldet die Kürzung also korrekt. Ohne Auswertung bleiben die **beiden Massenpfade**: `bulk-apply` (hier) und der Excel-Import (Batch 3) — also genau die Wege, bei denen der Nutzer die einzelnen Werte nicht zu Gesicht bekommt und die Kürzung deshalb am ehesten unbemerkt bleibt.
- Konkretes Fehlerszenario: Jemand trägt in der Standardwoche versehentlich `16` statt `1.6` Stunden für Montag ein und wendet sie auf ein Quartal an. `buildArbeitszeit(16)` klemmt auf `23:59`; gespeichert werden 14.98h statt 16h — pro Montag rund eine Stunde zu wenig, über 13 Wochen also ein ganzer Arbeitstag. Die Rückmeldung meldet `created: 13` und keinen Hinweis.
- Vorschlag: `geklemmt` in beiden Aufrufen prüfen und die betroffenen Tage in der Antwort als eigenen Zähler (`skippedTooLong` o.ä.) ausweisen, statt sie gekürzt zu schreiben. Zusätzlich `stdHours*` beim Speichern auf ≤ 24 begrenzen.

### [SCHWERE: MITTEL] Absenzantrag ohne Zeitraumbegrenzung
- Datei: app/api/absence-requests/route.ts:88-93 (POST) vs. bulk-apply/route.ts:58-62 und bulk-vacation/route.ts:40-43
- Problem: `bulk-apply` und `bulk-vacation` begrenzen den Zeitraum beide auf 366 Tage. `POST /api/absence-requests` prüft nur `toDate >= fromDate` — keine Obergrenze. Die Genehmigung (Zeile 148-157) reicht den Zeitraum unverändert an `createAbsenceEntries()` weiter, das pro Werktag einen einzelnen `INSERT` in einer Transaktion mit 30s-Timeout absetzt (siehe Fund in Batch 1).
- Konkretes Fehlerszenario: Ein Antrag über `fromDate: 2026-01-01, toDate: 2099-12-31` wird angelegt — über die API trivial, und die Prüfung `assertMonthEditable` greift nur für `member` und nur bei gesperrten Monaten. Ein Manager sieht in der Warteschlange einen scheinbar normalen Ferienantrag und klickt "Genehmigen". `createAbsenceEntries` beginnt rund 19 000 sequenzielle Inserts, die Transaktion läuft in den Timeout, der Manager bekommt nach 30 Sekunden einen 500er — und der Antrag steht weiterhin auf "offen", sodass der nächste Versuch dasselbe tut.
- Vorschlag: Dieselbe 366-Tage-Grenze in `POST /api/absence-requests` ziehen, die die beiden Bulk-Routen bereits haben, und zusätzlich in `createAbsenceEntries()` selbst absichern (die Bibliothek sollte sich nicht auf die Disziplin ihrer drei Aufrufer verlassen).

### [SCHWERE: MITTEL] Überstunden-Auszahlungen: keine Rollenprüfung, kein Audit-Trail, harte Löschung
- Datei: app/api/overtime-payouts/route.ts:27-53 (POST) und 55-76 (DELETE)
- Problem: `OvertimePayout` geht direkt in die Überstundenberechnung ein (`ueberstunden = ist - soll - payoutSum`, lib/calc.ts:323) und ist damit lohnrelevant. Trotzdem: `POST` und `DELETE` prüfen nur `requireOrg()`, keine Rolle — jedes Mitglied legt eigene Auszahlungen an und löscht sie wieder. Es wird `prisma.overtimePayout.delete` verwendet (hart), es entsteht **kein** Audit-Eintrag, und `assertMonthEditable` wird nicht aufgerufen. Vergleichbare Datensätze der App haben durchweg Schutz: `TimeEntry` hat Soft-Delete plus `TimeEntryAudit`, `MonthLock` hat `MonthLockAudit`.
- Konkretes Fehlerszenario: Die Personalabteilung erfasst eine Auszahlung von 40 Überstunden per 31.03. Der Mitarbeiter löscht diese Zeile über `DELETE /api/overtime-payouts` — sein eigener Datensatz, die Prüfung `{ id, userId, orgId }` lässt es zu. Sein Überstundensaldo steigt sofort wieder um 40 Stunden, und es existiert **keine Spur**, dass die Zeile je da war: kein Soft-Delete, kein Audit, kein Eintrag im Organisationsexport. Selbst bei gesperrtem März funktioniert es.
- Vorschlag: Anlegen und Löschen auf `owner`/`admin` beschränken (oder zumindest das Löschen), `assertMonthEditable` aufrufen, auf Soft-Delete umstellen und die Änderungen analog zu `MonthLockAudit` protokollieren.

### [SCHWERE: MITTEL] `overtime-payouts` parst das Datum ungeprüft
- Datei: app/api/overtime-payouts/route.ts:41
- Problem: `date: new Date(date)` — als einzige Route dieses Batches ohne `parseDateYMD()`. Alle Nachbarrouten (`time-entries`, `bulk-apply`, `bulk-vacation`, `absence-requests`, `holidays`, `month-locks`) validieren das Datum, teils mit ausführlicher Begründung im Kommentar.
- Konkretes Fehlerszenario: Ein Client schickt `date: "31.03.2026"` (Schweizer Schreibweise). `new Date("31.03.2026")` ergibt `Invalid Date`; die Prüfung in Zeile 36 betrachtet `date` nur auf Wahrheitswert und lässt es passieren. Prisma wirft beim Schreiben, der `catch`-Block liefert **500 "Interner Serverfehler"** auf einen reinen Eingabefehler. Der Nutzer sieht eine Serverstörung statt "ungültiges Datum" und meldet einen Ausfall.
- Vorschlag: Dieselbe `parseDateYMD`-Prüfung wie in den Nachbarrouten verwenden und bei Fehlschlag mit 400 antworten.

### [SCHWERE: MITTEL] Bestätigt: Feiertagsänderungen lösen keine Neuberechnung aus
- Datei: app/api/holidays/route.ts (POST Zeile 55-104, DELETE Zeile 106-127) — kein Aufruf von `recomputeAbsenceHours`
- Problem: Der in Batch 1 als Verdacht notierte Punkt ist damit bestätigt. `recomputeAbsenceHours` wird ausschliesslich aus `app/api/pensum-changes/route.ts:126,199` aufgerufen. Weder das Anlegen eines einzelnen Feiertags noch das Generieren eines ganzen Jahres (`generateYear`) noch das Löschen zieht bestehende Absenz-Einträge nach.
- Konkretes Fehlerszenario: Eine Organisation erfasst im Januar Ferien für das ganze Jahr (jeder Tag mit dem vollen Tagessoll, z.B. 8.4h). Im Februar generiert die Administratorin über "Feiertage generieren" den Schweizer Basissatz für dasselbe Jahr. Der Ostermontag liegt mitten in einer eingetragenen Ferienwoche: `sollStundenTag()` liefert für diesen Tag jetzt 0, der Ferien-Eintrag steht aber weiter auf 8.4h. Ergebnis: ein Ferientag zu viel verbraucht (`feriensaldo`), und `ist` enthält 8.4h an einem Tag mit Soll 0 — der Monatssaldo ist um ein Tagessoll zu positiv. Beim Löschen eines Feiertags tritt der umgekehrte Fall ein (Eintrag steht auf 0h, obwohl der Tag jetzt zählt).
- Vorschlag: In beiden Handlern nach der Änderung eine Neuberechnung für alle betroffenen Mitglieder anstossen — `recomputeAbsenceHours` braucht dafür eine Variante, die `previousHolidays`/`currentHolidays` statt der Pensum-Stände vergleicht.

### [SCHWERE: MITTEL] Bestätigt und verschärft: eine Kundenstunden-Korrektur auf 0 ist gar nicht speicherbar
- Datei: app/api/customer-months/route.ts:110 (`if (hours === 0) continue;`) i.V.m. lib/customer-months.ts:161 (`cm > 0 ? cm : legacy`)
- Problem: In Batch 1 wurde bemängelt, dass ein `CustomerMonth`-Wert von 0 in der Auswertung von den Legacy-Zeilen überschrieben wird. Die Route schliesst den Kreis: eine 0-Zeile wird bereits beim Speichern verworfen ("Nullzeilen nicht speichern"), und der vorangehende `deleteMany` (Zeile 120) entfernt zusätzlich eine eventuell vorhandene alte Zeile. Es gibt damit **zwei** unabhängige Stellen, die eine bewusste Null unmöglich machen.
- Konkretes Fehlerszenario: Ein Admin stellt fest, dass die Legacy-Zeilen für Kunde X im April falsch sind, und setzt den Wert im Profil auf 0, um sie zu neutralisieren. Die Route löscht die bestehende `CustomerMonth`-Zeile und legt keine neue an; `billableHoursByUserAndMonth` findet nichts und nimmt wieder die Legacy-Stunden. Die Oberfläche zeigt nach dem Neuladen den alten Wert. Für den Admin sieht es aus, als sei sein Speichern wirkungslos verpufft — er hat über die Oberfläche keinen Weg, die Korrektur durchzusetzen.
- Vorschlag: 0 als gültigen Wert speichern und in `lib/customer-months.ts` auf Existenz statt auf `> 0` prüfen (`customerMonthByCustomer.has(customerId)`). Beide Änderungen sind nötig — einzeln behebt keine das Problem.

### [SCHWERE: NIEDRIG] Vier Routen akzeptieren nicht existierende Kalendertage
- Datei: bulk-apply/route.ts:27-37, bulk-vacation/route.ts:9-20, absence-requests/route.ts:15-20, holidays/route.ts:9-14
- Problem: Diese vier `parseDateYMD`-Varianten bauen das Datum direkt aus den Regex-Gruppen, ohne zu prüfen, ob der Kalendertag existiert. Die Variante in `time-entries/route.ts:52-62` macht genau diese Rückprüfung (`date.getUTCDate() !== d → null`) — die Kopien haben sie nicht übernommen.
- Konkretes Fehlerszenario: `fromDate: "2026-02-31"` (per API oder aus einem Client mit freiem Texteingabefeld). `Date.UTC(2026, 1, 31)` ergibt den **3. März 2026**. Der Ferienzeitraum beginnt stillschweigend an einem anderen Tag als angegeben; in `absence-requests` wird der verschobene Wert gespeichert und dem Genehmiger als Antragszeitraum angezeigt.
- Vorschlag: Die validierende Variante aus `time-entries/route.ts` in `lib/` ziehen und in allen fünf Routen importieren, statt sie ein sechstes Mal zu kopieren.

### [SCHWERE: NIEDRIG] Zurückgezogene Absenzanträge werden hart gelöscht
- Datei: app/api/absence-requests/route.ts:186 (`prisma.absenceRequest.delete`)
- Problem: Die App verfolgt sonst konsequent Soft-Delete mit Audit-Trail (`TimeEntry`, `MonthLock`), begründet mit der fünfjährigen Aufbewahrungspflicht. `AbsenceRequest` wird beim Zurückziehen physisch entfernt, obwohl `lib/org-export.ts:49` die Tabelle als Teil der DSGVO-Auskunft exportiert.
- Konkretes Fehlerszenario: Eine Mitarbeiterin stellt einen Ferienantrag, die Vorgesetzte äussert sich mündlich ablehnend, die Mitarbeiterin zieht ihn zurück. Später entsteht Streit darüber, ob und wann der Antrag gestellt wurde — es gibt keinerlei Aufzeichnung mehr. Da nur `offen`-Anträge löschbar sind, ist der Schaden begrenzt, die Inkonsistenz zur sonstigen Aufbewahrungslinie bleibt.
- Vorschlag: Status `zurueckgezogen` setzen statt zu löschen; die Liste filtert diesen Status in der Standardansicht aus.

## Batch 5 — Admin-, Team- und Profil-API (`admin/organization` + `export`, `admin/team`, `team`, `projects`, `customers`, `profile`, `invitations` + `accept`, `signup`)

> **Positivbefund:** Auch in diesem Batch scopen alle Routen korrekt auf `orgId` — das in Batch 2 vermutete Mandanten-Leck über `canSeeUser()` bleibt unbestätigt. `DELETE /api/admin/organization` ist sauber abgesichert (`requireRole(["owner"])` **plus** Bestätigung des Organisationsnamens im Body).
> **Entkräftet:** `PUT /api/profile` erlaubt **keine** Änderung der E-Mail-Adresse — der in Batch 2 vermutete Weg zur `DEVELOPER_EMAILS`-Allowlist existiert nicht. Ebenso: `invitations` baut den Link aus `process.env.NEXTAUTH_URL`, nicht aus dem `Host`-Header.
> **Nachtrag (nach Audit-Abschluss):** Ein Fund in diesem Batch stammt nicht aus der Batch-Durchsicht selbst, sondern aus einer Beobachtung im laufenden Betrieb ("member kann keine Kunden anlegen") und wurde danach im Code bestätigt — siehe "Kundenerfassung ist für die Rolle \"member\" eine Sackgasse" unten.

### [SCHWERE: KRITISCH] Jedes Mitglied kann Kunden löschen und damit organisationsweit Abrechnungsdaten vernichten
**BEHOBEN (04.09.2026):** `lib/entity-deletion.ts` sperrt DELETE für `/api/customers` und `/api/projects` jetzt zweifach: `assertMayDelete()` erlaubt nur owner/admin oder die erstellende Person (`createdBy`), und unabhängig von der Rolle greift ein 409, sobald Zeiteinträge, CustomerMonth- oder Projekt-Zeilen referenzieren. `CustomerMonth.customer` ist zusätzlich von `Cascade` auf `Restrict` umgestellt. Die Profilseite zeigt vor dem Löschen einen Bestätigungsdialog (`AlertDialog`) und die tatsächliche Fehlermeldung statt eines generischen Toasts. Tests in `lib/customers-route.test.ts` und `lib/projects-route.test.ts`.

- Datei: app/api/customers/route.ts:133-145 (`DELETE`, nur `requireOrg()`, **keine** `requireRole`) i.V.m. prisma/schema.prisma:369 (`Project.customer … onDelete: Cascade`), :406 (`CustomerMonth.customer … onDelete: Cascade`), :300-301 (`TimeEntry.customerId/projectId … onDelete: SetNull`)
- Problem: Der Handler prüft ausschliesslich, dass eine Session mit Organisation existiert. Es gibt keine Rollenprüfung, keine Soft-Delete-Variante, keinen Audit-Eintrag und keine Rückfrage. `prisma.customer.delete()` löst dann drei Kaskaden gleichzeitig aus. Dieselbe Lücke besteht in `app/api/projects/route.ts:138-151`; dort ist im Kommentar immerhin die `SetNull`-Folge für `TimeEntry` festgehalten — die beiden `Cascade`-Regeln beim Kunden sind nirgends dokumentiert.
- Konkretes Fehlerszenario: Ein `member` ruft `DELETE /api/customers` mit der ID von "Swissgrid" auf (über die Oberfläche oder direkt). Folgen in einer einzigen Transaktion: **(1)** alle Projekte dieses Kunden werden gelöscht (Cascade), **(2)** alle `CustomerMonth`-Zeilen dieses Kunden werden gelöscht (Cascade) — also genau die manuell nacherfassten Migrationswerte, die `lib/customer-months.ts` als *"die massgebliche Quelle"* bezeichnet und die per Hand aus den alten Stundenrapporten rekonstruiert wurden, **(3)** bei jedem `TimeEntry` dieses Kunden werden `customerId` und `projectId` auf `NULL` gesetzt. Da `billableHoursByUserAndMonth` (lib/customer-months.ts:119) auf `customerId: { not: null }` filtert, fallen diese Stunden vollständig aus den Kundenstunden heraus: Verrechnungsgrad und Kundenstunden brechen für **jede Person der Organisation** und für **jeden betroffenen Monat** zusammen. Nichts davon ist wiederherstellbar — es gibt kein `deletedAt`, keinen Audit-Eintrag, und die betroffenen Zeilen stehen anschliessend auch nicht mehr im Organisationsexport.
- **Nachtrag aus Batch 7 — deutlich schlimmer als zunächst angenommen:** Der Vorgang ist nicht nur über die API auslösbar, sondern über **einen einzigen Klick in der Oberfläche**. `app/(app)/profile/page.tsx:930` rendert einen Papierkorb-Knopf, der `deleteCustomer(c.id)` **ohne jede Rückfrage** aufruft (kein `AlertDialog`, kein `confirm()`); Zeile 1063 dasselbe für Projekte. Die Profilseite liegt in `baseTabs` (app/(app)/layout.tsx:46) und ist damit für **jede** Rolle erreichbar. Ein versehentlicher Klick neben dem Bearbeiten-Stift genügt, um die oben beschriebene Kaskade auszulösen. Eine Rückmeldung gibt es nur als Erfolgs-Toast.
- Vorschlag: Sofort `requireRole(role, ["owner", "admin"])` in beiden DELETE-Handlern ergänzen; unabhängig davon einen Bestätigungsdialog vorschalten, der die Zahl der betroffenen Zeiteinträge und Monatswerte nennt. Mittelfristig auf Soft-Delete umstellen (`Customer.deletedAt`, wie bei `TimeEntry`) und das Löschen blockieren, solange `TimeEntry`- oder `CustomerMonth`-Zeilen darauf verweisen — mit einer Fehlermeldung, die die Anzahl betroffener Datensätze nennt. Die `Cascade`-Regel auf `CustomerMonth` gehört unabhängig davon auf `Restrict` umgestellt.

### [SCHWERE: HOCH] Kundenerfassung ist für die Rolle "member" eine Sackgasse — anlegen gelingt, sehen nicht
**BEHOBEN (04.09.2026):** `Customer.createdBy` (Migration `20260904091030_customer_created_by_and_restrict`) plus `ownCustomersWhere()` in `lib/visibility.ts` (vormals `lib/project-visibility.ts`, umbenannt weil jetzt geteilt) — exakt das für `Project` bereits bestehende Muster. Ein selbst angelegter Kunde ist sofort sichtbar und für die erstellende Person auch wieder löschbar. Die Portfoliotrennung für Bestandskunden ohne eigene Buchung bleibt bewusst bestehen. Tests in `lib/customers-route.test.ts`.

- **Herkunft:** Dieser Fund stammt aus einer Beobachtung im laufenden Betrieb ("ich kann als Rolle member keine Kunden hinzufügen"), nicht aus der ursprünglichen Batch-Durchsicht, und wurde danach im Code bestätigt. Der übrige Audit ist laut Gesamteinschätzung rein statisch — hier lag stattdessen ein tatsächlich beobachtetes Verhalten am Anfang.
- Datei: app/api/customers/route.ts:28-48 (Sichtbarkeitsfilter des `GET`) und :59-79 (`POST` ohne Rollenprüfung) i.V.m. prisma/schema.prisma:331-344 (`Customer` ohne `createdBy`) vs. prisma/schema.prisma:361-366 (`Project.createdBy`) und lib/project-visibility.ts:34-39
- Problem: `POST /api/customers` prüft nur `requireOrg()` — das Anlegen gelingt für jede Rolle, inklusive `member`. Der neue Kunde ist danach aber unsichtbar: `GET /api/customers` liefert einem `member` ausschliesslich Kunden, auf die er bereits über einen `TimeEntry` oder eine `CustomerMonth`-Zeile gebucht hat (Zeile 28-42) — ein frisch angelegter Kunde erfüllt das nie. Das Projekt kennt dieses Henne-Ei-Problem und hat es für `Project` bereits gelöst: `lib/project-visibility.ts:34-39` hält wörtlich fest, "Ohne den createdBy-Zweig wäre ein frisch erstelltes Projekt für die erstellende Person unsichtbar, bis sie zum ersten Mal Stunden darauf gebucht hat — Henne-Ei-Problem", und `Project.createdBy` (prisma/schema.prisma:361-366) trägt genau deshalb die erstellende `userId`. `model Customer` hat kein solches Feld — der Fix wurde nie übertragen. Der Kommentar in `GET /api/customers` (Zeile 17-19) benennt die Folge zwar als "Bekannte Einschränkung", unterschätzt sie aber: er nimmt an, der Kunde tauche "nach dem ersten Eintrag" auf — dieser erste Eintrag ist gar nicht möglich, weil sämtliche Auswahl-Dropdowns der App aus derselben gefilterten Liste gespeist werden.
- Konkretes Fehlerszenario: Ein `member` legt im Profil den Kunden "X" an (app/(app)/profile/page.tsx:434-451) → `POST` gelingt, Erfolgs-Toast. `fetchCustomers()` lädt neu (Zeile 228-236) → X fehlt in der Liste, es sieht aus, als sei nichts passiert. **Kein Projekt anlegbar:** Das Kunden-Dropdown im Projektformular mappt über dieselbe Liste (profile/page.tsx:947-956) → X nicht wählbar. **Keine Stunden buchbar:** Das Projekt-Dropdown im Tagesdialog gruppiert per `customers.map()` (components/day-entry-dialog.tsx:606-615), gespeist aus derselben gefilterten `GET` (app/(app)/calendar/page.tsx:130-138) — selbst ein Projekt, das der `createdBy`-Zweig für `Project` korrekt zurückliefert, wird hier nicht gerendert, weil sein Kunde in `customers` fehlt; die vorhandene Projekt-Lösung wird eine Ebene höher wieder ausgehebelt. **Keine Kundenstunden erfassbar:** Die Monatskarte iteriert ebenfalls `customers` (profile/page.tsx:1086) → X taucht nicht auf. **Zweiter Versuch scheitert:** Erneutes Anlegen mit demselben Namen ergibt 409 "Kunde existiert bereits" (route.ts:69-70) — für einen Kunden, den das Mitglied nirgends sehen kann. Verschärfend, über den gemeldeten Fall hinaus: Die Filterung trifft nicht nur selbst angelegte Kunden — ein **neu eingetretenes Mitglied ohne jede Buchungshistorie sieht null Kunden**, auch nicht die vom Admin gepflegten, und kann folglich nie Sichtbarkeit "erarbeiten". Einziger existierender Ausweg ist, dass ein `owner`/`admin` stellvertretend per `POST /api/customer-months` mit `userId`-Parameter (app/api/customer-months/route.ts:15) eine `CustomerMonth`-Zeile für das Mitglied anlegt — ein Weg, den niemand ohne Codekenntnis findet; über `time-entries` geht es nicht, die Route ist strikt auf die eigene `userId` beschränkt.
- Vorschlag: `Customer.createdBy String?` analog zu `Project.createdBy` ergänzen, in `POST /api/customers` mit der `userId` befüllen und den Sichtbarkeitszweig in `GET` um `OR: [{ id: { in: visibleIds } }, { createdBy: userId }]` erweitern — exakt das Muster aus `ownProjectsWhere()` (lib/project-visibility.ts:22-39), das dafür bereits existiert. Am besten als gemeinsamer Helfer `ownCustomersWhere()` neben `ownProjectsWhere()`, damit beide Regeln nicht erneut auseinanderlaufen (siehe Querschnittliches Muster 2). Bewusst nicht empfohlen: den Sichtbarkeitsfilter ganz zu entfernen — die Trennung der Kundenportfolios ist gewollt ("Gabriel sieht nicht Nicos Kundenportfolio"), ein Mitglied soll weiterhin nur seine selbst angelegten und selbst bebuchten Kunden sehen. Das bedeutet zugleich: vom Admin vorangelegte Kunden bleiben für ein Mitglied ohne eigene Buchung weiterhin unsichtbar — für den Fall "neues Mitglied ohne Historie" ist `createdBy` keine Lösung, dort bleibt der vorgesehene Weg, dass das Mitglied seine Kunden selbst anlegt. Unabhängig davon bleiben `PUT`/`DELETE` weiterhin nicht auf eigene Kunden eingeschränkt und über eine geratene ID für jede Rolle erreichbar (siehe den KRITISCH-Fund oben) — die Sichtbarkeitsregel im `GET` ersetzt keine Rollenprüfung.

### [SCHWERE: HOCH] Mitglieder können die Grundlage ihrer eigenen Sollstunden ungeprüft verändern
**BEHOBEN (04.09.2026):** `lib/membership-validation.ts` prüft pensum/weeklyHours/vacationDays jetzt mit Bereichs- und Typprüfung (400 statt stillem Durchreichen oder 500er) in `PUT /api/profile` und `PUT /api/admin/team`. `startDate` wird vom Profil-Endpunkt nicht mehr entgegengenommen und ist wie `exitDate` nur noch über `/admin/team` änderbar; die Profilseite zeigt es nur noch lesend. `admin/team` validiert Datumsfelder zusätzlich über den geteilten `parseDateYMD` aus `lib/dates.ts` statt eines ungeprüften `new Date(...)`. Tests in `lib/profile-route.test.ts`.

- Datei: app/api/profile/route.ts:76-79
- Problem: `weeklyHours`, `pensum`, `vacationDays` und `startDate` werden unverändert aus dem Request-Body in die `Membership` geschrieben — ohne Typ-, Bereichs- oder Rollenprüfung. Nur die Standardwoche wird geklemmt (Zeile 83). Der Kommentar in Zeile 40-41 hält ausdrücklich fest, dass `exitDate` *"ausschliesslich über /admin/team"* gesetzt wird und für die Person selbst nur lesbar ist — `startDate` wirkt in `sollStundenTag()` (lib/calc.ts:201 vs. 204) jedoch exakt spiegelbildlich und ist frei schreibbar.
- Konkretes Fehlerszenario 1: `PUT /api/profile` mit `{"pensum": -100}`. `tagessollBasis(42, -100)` (lib/calc.ts:191) ergibt −8.4h Tagessoll; `summeSollstunden` liefert für einen Monat rund −168h. `ueberstunden = ist - soll - payoutSum` (calc.ts:323) weist damit rund 168 Überstunden mehr aus, als geleistet wurden — auf einem Wert, der in den Lohnexport eingeht.
- Konkretes Fehlerszenario 2: `{"startDate": "2026-08-01"}` bei einer Person, die seit 2020 dabei ist. `sollStundenTag()` liefert für jeden Tag davor 0. Sämtliche Vormonate haben ab sofort Soll 0 bei unverändertem Ist — der Überstundensaldo explodiert, und im Kalender sieht alles normal aus.
- Konkretes Fehlerszenario 3: `{"weeklyHours": "vierzig"}` — Prisma lehnt den Typ ab, der Nutzer bekommt **500 "Interner Serverfehler"** auf einen reinen Eingabefehler.
- **Nachtrag aus Batch 8 — Einordnung der Ausnutzbarkeit:** Über die Oberfläche sind diese Werte nicht erzeugbar: `app/(app)/profile/page.tsx:701-703` begrenzt alle drei Felder per `clampNumInput` und `min`/`max` (Pensum 0-200, Wochenstunden 0-100, Ferientage 0-100). Die Lücke erfordert also einen direkten API-Aufruf. Das senkt die Wahrscheinlichkeit eines versehentlichen Auftretens deutlich — an der Einstufung ändert es nichts, da clientseitige Begrenzung keine Zugriffskontrolle ist und der Endpunkt ohne Rollenprüfung auf lohnrelevante Felder schreibt.
- Vorschlag: Bereichs- und Typprüfung für alle vier Felder (`pensum` 0–100, `weeklyHours` 0–80, `vacationDays` 0–60, `startDate` als `parseDateYMD`), und `startDate` konsequent wie `exitDate` behandeln: nur über `/admin/team` änderbar. Wer sein Pensum ändert, soll dafür den vorgesehenen Weg über `PensumChange` nehmen — der rechnet über `recomputeAbsenceHours` auch die Absenzstunden nach.

### [SCHWERE: HOCH] Registrierung ohne jede Begrenzung
- Datei: app/api/signup/route.ts (kein Import von `lib/rate-limit`), Slug-Schleife Zeile 36-41
- Problem: `POST /api/signup` ist der einzige öffentliche Auth-Endpunkt **ohne** Rate-Limiting. `login` (lib/auth-options.ts:24), `forgot-password`, `reset-password` und `invitations/accept` (Zeile 55) rufen alle `isRateLimited()` auf — Signup nicht. Jeder Aufruf legt eine `Organization` mit 30-Tage-Trial, einen `User` und eine `Membership` an. Zusätzlich sucht die Slug-Vergabe in einer `while`-Schleife mit je einer eigenen Query nach dem nächsten freien Suffix.
- Konkretes Fehlerszenario: Ein Skript schickt fortlaufend Signups mit demselben Firmennamen. Nach 10 000 Durchläufen existieren 10 000 Organisationen mit aktivem Trial — und der 10 001. Aufruf durchläuft die Slug-Schleife 10 000 Mal mit je einer sequenziellen `findUnique`-Query, bevor er einen freien Slug findet. Der Aufwand wächst quadratisch mit der Anzahl der Angriffe. Parallel wird `/dev` (`getOrgOverview` lädt **alle** Organisationen ohne `take`, lib/dev-metrics.ts:150) unbrauchbar, und `getPlatformSummary` meldet Tausende "trials expiring soon".
- Vorschlag: `isRateLimited("signup", email, ip, { onlyFailures: false })` analog zu den übrigen öffentlichen Routen ergänzen. Den Slug mit einem Zufallssuffix statt einer Zählschleife eindeutig machen (`slugBase-<6 Zeichen>`), damit die Vergabe konstant teuer bleibt.

### [SCHWERE: MITTEL] Nutzerlimit wird beim Einladen geprüft, nicht beim Beitreten
- Datei: app/api/invitations/route.ts:83 (`billing.checkUserLimit`) vs. app/api/invitations/accept/route.ts (kein Aufruf)
- Problem: Die Prüfung zählt aktive `Membership`-Zeilen (lib/billing.ts:52). Offene Einladungen zählen nicht mit, und beim Annehmen — dem Moment, in dem tatsächlich ein Platz belegt wird — findet keine Prüfung statt. Das Limit lässt sich damit nicht nur durch ein Wettrennen (Batch-2-Fund), sondern völlig regulär und beliebig weit überschreiten.
- Konkretes Fehlerszenario: Trial-Organisation, `maxUsers: 5`, aktuell 4 aktive Mitglieder. Die Administratorin lädt nacheinander zehn Personen ein. Jede einzelne Einladung besteht die Prüfung, weil weiterhin nur 4 Mitgliedschaften existieren. Nehmen alle zehn an, hat die Organisation 14 aktive Mitglieder auf einem 5-Platz-Plan — ohne dass irgendwo eine Grenze gemeldet wurde. Der Plan setzt seine eigene Limite faktisch nicht durch.
- Vorschlag: `checkUserLimit()` zusätzlich in `invitations/accept` unmittelbar vor dem Anlegen der Membership aufrufen, innerhalb derselben Transaktion. Beim Einladen die Prüfung beibehalten, dabei aber offene, noch gültige Einladungen mitzählen, damit die Rückmeldung an die Administratorin ehrlich bleibt.

### [SCHWERE: MITTEL] Beitritt zu einer zweiten Organisation führt in eine unerreichbare Mitgliedschaft
- Datei: app/api/invitations/accept/route.ts:69-90 i.V.m. lib/auth-options.ts:38-42
- Problem: Der Zweig für bereits existierende Nutzer legt eine zusätzliche `Membership` an und meldet Erfolg. Beim Login wählt `authorize()` jedoch `findFirst({ status: "aktiv" }, orderBy: { createdAt: "asc" })` — also **die zuerst beigetretene** Organisation. Eine Umschaltmöglichkeit existiert nicht; der Kommentar dort hält das als bekannte Lücke fest ("bis eine Org-Wechsel-UI existiert").
- Konkretes Fehlerszenario: Eine Treuhänderin ist bereits Mitglied der Organisation A. Sie erhält eine Einladung von Organisation B und nimmt sie an. Die Oberfläche bestätigt: *"Du bist der Organisation beigetreten. Melde dich mit deinem bestehenden Passwort an."* (`invite.successExisting`, lib/i18n.tsx). Sie meldet sich an — und landet wieder in Organisation A. Es gibt keinen Weg zu B, keine Fehlermeldung und keinen Hinweis. Für sie ist der Beitritt fehlgeschlagen; für die einladende Administratorin sieht die Einladung als "angenommen" aus.
- Vorschlag: Solange kein Organisationswechsel existiert, diesen Zweig ehrlich machen: entweder die Einladung mit einer klaren Meldung ablehnen ("Diese E-Mail gehört bereits zu einer anderen Organisation") oder die Erfolgsmeldung um den Hinweis ergänzen, dass die neue Organisation erst mit dem Org-Wechsel erreichbar wird. Die eigentliche Lösung ist die Auswahl beim Login, sobald mehrere aktive Mitgliedschaften bestehen.

### [SCHWERE: MITTEL] Einladungslimit greift pro Büro statt pro Angreifer
- Datei: app/api/invitations/accept/route.ts:55-58
- Problem: `isRateLimited("invitation-accept", "", ip, { onlyFailures: false })` übergibt eine **leere** E-Mail — der E-Mail-Zähler entfällt damit (lib/rate-limit.ts:59-61 zählt bei leerem Wert 0), und es wirkt allein der IP-Zähler. `onlyFailures: false` bewirkt zusätzlich, dass **erfolgreiche** Annahmen mitzählen; `recordAttempt(..., true)` wird in Zeile 58 vor jeder Verarbeitung geschrieben.
- Konkretes Fehlerszenario: Eine Firma onboardet 15 neue Mitarbeitende. Alle sitzen im selben Büro hinter derselben ausgehenden IP-Adresse und klicken ihre Einladungslinks am ersten Arbeitstag. Ab der 10. Annahme innerhalb von 15 Minuten bekommen die übrigen *"Zu viele Versuche. Bitte später erneut versuchen."* — obwohl jede Annahme legitim und mit gültigem Token erfolgte. Der Schutz kostet hier echte Onboardings, während er gegen Token-Raten ohnehin kaum etwas beiträgt (die Tokens sind 32 Byte Zufall, lib/token.ts:12).
- Vorschlag: Nur Fehlversuche zählen (`onlyFailures: true`) und den Zähler zusätzlich an den Token-Hash bzw. die eingeladene E-Mail binden statt allein an die IP.

### [SCHWERE: MITTEL] Änderungen an Mitgliedschaften werden nirgends protokolliert
- Datei: app/api/admin/team/route.ts:125 (`prisma.membership.update`) und app/api/profile/route.ts:100
- Problem: Rollenwechsel, Deaktivierungen, Vorgesetzten-Zuordnungen, Ein-/Austrittsdaten, Pensum, Wochenstunden und Ferienanspruch werden ohne jeden Audit-Eintrag überschrieben. Die App führt sonst konsequent Protokoll: `TimeEntryAudit` für jede Feldänderung eines Zeiteintrags, `MonthLockAudit` für Sperren, `DevAction` für Betreiber-Eingriffe. Für die Stammdaten, aus denen sich das gesamte Sollstunden- und Feriengerüst ableitet, gibt es nichts.
- Konkretes Fehlerszenario: Der Ferienanspruch einer Person steht im Dezember auf 20 statt 25 Tagen. Niemand weiss, ob er so vereinbart war, wann er geändert wurde und von wem — `Membership` trägt nur den aktuellen Wert. Dasselbe gilt für ein nachträglich verschobenes `entryDate`, das rückwirkend alle Sollstunden verändert. Bei einer Lohnabrechnungsprüfung ist der Vorgang nicht rekonstruierbar, obwohl die App genau dafür an anderer Stelle einen Audit-Trail führt.
- Vorschlag: Ein `MembershipAudit` nach dem Muster von `TimeEntryAudit` ergänzen und aus beiden Routen mit `diffTimeEntryFields`-ähnlicher Logik befüllen (lib/audit.ts ist bereits generisch genug, um mit einer zweiten Feldliste weiterverwendet zu werden).

### [SCHWERE: MITTEL] Pensum-Änderung im Profil bleibt ohne Wirkung, sobald eine Pensum-Historie existiert
- Datei: app/api/profile/route.ts:76-77 i.V.m. lib/export-helpers.ts:19-20 und lib/absence-entries.ts:33-34
- Problem: Alle Berechnungen bauen ihr `Profil` über `basePensum ?? pensum` bzw. `baseWeeklyHours ?? weeklyHours` auf — die Basiswerte haben also Vorrang. `PUT /api/profile` schreibt aber ausschliesslich `pensum` und `weeklyHours` und lässt `basePensum`/`baseWeeklyHours` unangetastet. Sobald einmal eine `PensumChange` angelegt wurde (wodurch die Basisfelder gesetzt sind), ist das Feld im Profil wirkungslos.
- Konkretes Fehlerszenario: Eine Person reduziert im Profil ihr Pensum von 100% auf 80% und speichert. Die Oberfläche zeigt nach dem Neuladen 80% (die `GET`-Route liefert `membership.pensum`, Zeile 25). Die Sollstunden bleiben aber auf 100% stehen, weil `pensumAt()` über `basePensum` rechnet. Die Person sieht Monat für Monat ein zu hohes Soll und einen zu negativen Saldo, während ihr Profil das korrekte Pensum anzeigt — ein Widerspruch, der ohne Kenntnis des Codes nicht auflösbar ist.
- Vorschlag: Die Felder im Profil schreibgeschützt anzeigen, sobald eine `PensumChange` existiert, und auf den vorgesehenen Weg verweisen. Alternativ das Profil-`PUT` eine `PensumChange` anlegen lassen, statt direkt zu schreiben — dann greift auch `recomputeAbsenceHours`.

### [SCHWERE: MITTEL] Ungültige Datumsangaben ergeben 500 statt 400
- Datei: app/api/admin/team/route.ts:107, 108, 112 und app/api/profile/route.ts:79
- Problem: `new Date(entryDate)`, `new Date(exitDate)`, `new Date(startDate)` ohne jede Prüfung. Die Nachbarrouten dieses Projekts verwenden durchweg `parseDateYMD()` mit Formatprüfung; die Membership-Routen nicht.
- Konkretes Fehlerszenario: In der Teamverwaltung wird das Austrittsdatum über ein Feld gesetzt, dessen Wert bei bestimmten Browser-/Locale-Kombinationen als `"31.12.2026"` ankommt. `new Date("31.12.2026")` ergibt `Invalid Date`, Prisma wirft, und die Administratorin bekommt *"Interner Serverfehler"*. Sie kann nicht erkennen, dass es an ihrer Eingabe lag, und meldet einen Ausfall der Teamverwaltung.
- Vorschlag: Dieselbe validierende `parseDateYMD`-Hilfsfunktion verwenden, die für Batch 4 ohnehin nach `lib/` gezogen werden sollte, und bei Fehlschlag mit 400 antworten.

### [SCHWERE: NIEDRIG] Vorgesetzten-Zuordnung erlaubt Zyklen und fachfremde Rollen
- Datei: app/api/admin/team/route.ts:96-105
- Problem: Geprüft wird nur, dass `managerId` nicht die eigene Membership ist und zur Organisation gehört. Weder wird die Rolle der vorgesetzten Person geprüft noch ein Zyklus über mehrere Ebenen ausgeschlossen.
- Konkretes Fehlerszenario: A wird B als vorgesetzt zugewiesen, danach B an A. `listVisibleUserIds()` (lib/access.ts:120-127) wertet nur eine Ebene aus, es entsteht also keine Endlosschleife — wohl aber eine Hierarchie, in der sich zwei Personen gegenseitig als Direktunterstellte sehen und gegenseitig Absenzanträge genehmigen können. Ebenso lässt sich ein `member` als Vorgesetzter eintragen; die Sichtbarkeit greift dann nicht, weil `listVisibleUserIds` für die Rolle `member` immer nur die eigene ID liefert — die Zuordnung ist wirkungslos, sieht in der Oberfläche aber gesetzt aus.
- Vorschlag: Verlangen, dass die vorgesetzte Membership die Rolle `manager`, `admin` oder `owner` trägt, und beim Setzen die Kette nach oben auf Zyklen prüfen.

### [SCHWERE: NIEDRIG] Profil-Aktualisierung ist nicht transaktional
- Datei: app/api/profile/route.ts:95-102
- Problem: Die Aktualisierung von `User` und `Membership` läuft in einem `Promise.all`, nicht in einer Transaktion. Schlägt eine der beiden fehl, bleibt die andere bestehen.
- Konkretes Fehlerszenario: Jemand ändert Nachname und Wochenstunden in einem Vorgang. Das `membership.update` scheitert (z.B. wegen des oben beschriebenen Typfehlers bei `weeklyHours`), das `user.update` ist zu diesem Zeitpunkt bereits durch. Der Nutzer bekommt einen 500er und geht davon aus, dass nichts gespeichert wurde — der Nachname ist aber geändert.
- Vorschlag: Beide Aktualisierungen in `prisma.$transaction` zusammenfassen.

## Batch 6 — Auth-, Dev- und Export-Routen (`auth/*`, `dev/orgs/*`, `dev/users/*/reset-link`, `health`, `analytics`, `import/timesheet`, `export`)

> **Der sauberste Batch bisher.** `forgot-password` (generische Antwort, Rate-Limit, `NEXTAUTH_URL` statt `Host`-Header), `reset-password` (Token-Prüfung, Einmalverwendung, Transaktion), `health` und die drei `/api/dev`-Routen sind ohne Beanstandung. `analytics` scopet durchgehend auf `userId + orgId` und vermeidet N+1 sauber (die Monatsschleife rechnet auf bereits geladenen Daten).
>
> **Damit abschliessend geklärt (offene Punkte aus Batch 2/4/5):**
> - **Kein Mandanten-Leck.** Alle Aufrufer von `canSeeUser()` scopen zusätzlich auf `orgId`; `export?scope=person` bricht sogar mit 404 ab, wenn keine passende Membership existiert (export/route.ts:158). Der Batch-2-Fund ist entsprechend als latente Falle annotiert, nicht als bestehende Lücke.
> - `createDevPasswordResetLink` bekommt `baseUrl` aus `process.env.NEXTAUTH_URL` (reset-link/route.ts:17), **nicht** aus dem `Host`-Header. Erledigt.
> - `reset-password` entwertet zwar alle anderen offenen Reset-Tokens desselben Nutzers (Zeile 51-54), **nicht** aber bestehende Sitzungen — der Batch-2-Fund "Passwortänderung beendet bestehende Sitzungen nicht" ist damit bestätigt. Bemerkenswert: der Code kümmert sich hier ausdrücklich um übrig gebliebene Zugänge, übersieht dabei aber den grössten.

### [SCHWERE: MITTEL] Analytics-Verlauf überspringt Monate, wenn der Zeitraum am 29.–31. beginnt
- Datei: app/api/analytics/route.ts:205-207 und 228 (`currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1)`)
- Problem: Die Monatsschleife startet auf `new Date(startDate)` — also auf dem **Tagesdatum** des Zeitraumbeginns, nicht auf dem Monatsersten — und schaltet mit `setUTCMonth(+1)` weiter. Fällt der Starttag auf einen Tag, den der Folgemonat nicht hat, läuft `setUTCMonth` über und springt in den übernächsten Monat. `lib/customer-months.ts:45-52` löst dasselbe Problem korrekt über eine reine Zähllogik (`m += 1` mit Jahresüberlauf) — die beiden Implementierungen kommen damit zu unterschiedlichen Monatslisten.
- Konkretes Fehlerszenario: Benutzerdefinierter Zeitraum 31.01.2026–30.04.2026. `currentMonth` startet auf dem 31.01. → `setUTCMonth(1)` ergäbe den 31. Februar, den es nicht gibt, also den **03.03.2026**. Die Schleife erzeugt damit Datenpunkte für Januar, März und April — **der Februar fehlt vollständig im Verlaufs-Chart**, ohne Lücke oder Hinweis. Die Jahressumme darüber stimmt weiterhin (sie kommt aus einem separaten `kennzahlen()`-Aufruf), sodass Chart und Kennzahlen sich widersprechen. Bei Start am 29. oder 30. tritt derselbe Effekt auf.
- Vorschlag: Die Schleife auf dem Monatsersten starten (`new Date(Date.UTC(startYear, startMonth, 1))`) oder `monthsInRange()` aus `lib/customer-months.ts` wiederverwenden — die Funktion existiert bereits und wird in derselben Datei (Zeile 199 im Export-Pendant) schon für die Kundenstunden genutzt.

### [SCHWERE: MITTEL] Import prüft weder auf Duplikate in der Datei noch auf Eintragskonflikte
- Datei: app/api/import/timesheet/route.ts:85-105 — kein Aufruf von `pruefeEintragKonflikte()`
- Problem: Übersprungen wird nur, was **bereits in der Datenbank** steht (`existingDates`, Zeile 63/86) — und das rein datumsbasiert. Innerhalb der hochgeladenen Datei findet keine Prüfung statt, und die Konfliktlogik aus `lib/entry-overlap.ts`, die `POST /api/time-entries` für jeden interaktiven Eintrag durchläuft, wird hier gar nicht erst aufgerufen. Anschliessend schreibt `createMany` alles ungeprüft.
- Konkretes Fehlerszenario: In der Altdatei steht der 12.03.2024 versehentlich zweimal mit `8.0 Stunden, Arbeitszeit` (typisch nach einem Copy-Paste beim Zusammenführen von Monatsblättern). Für diesen Tag existiert noch kein Eintrag, `existingDates` greift also nicht. Beide Zeilen werden angelegt — der Tag hat danach 16 statt 8 Stunden. Über den Tagesdialog wäre exakt dieselbe zweite Zeile mit **409 "Es existiert bereits ein identischer Eintrag an diesem Tag"** abgelehnt worden. Die Rückmeldung des Imports meldet `imported: 2` und keinen Konflikt. Da der Import gerade für grosse Altbestände gedacht ist, fällt so etwas erst über einen falschen Jahressaldo auf.
- Vorschlag: Im `preview`-Modus die Zeilen der Datei nach `(date, type, von, bis)` gruppieren und Doppelungen als eigene Warnkategorie ausweisen (nicht als Fehler — der Nutzer soll entscheiden). Vor dem `createMany` zusätzlich `pruefeEintragKonflikte()` je Tag laufen lassen, damit für alle Schreibwege dieselbe Regel gilt.

### [SCHWERE: MITTEL] Datei-Upload ohne Grössenbegrenzung
- Datei: app/api/import/timesheet/route.ts:31
- Problem: `Buffer.from(await file.arrayBuffer())` lädt den kompletten Upload in den Speicher, bevor `workbook.xlsx.load()` daraus zusätzlich ein vollständiges Objektmodell aufbaut. Es gibt weder eine Prüfung auf `Content-Length` noch ein Grössenlimit, und `.xlsx` ist ein ZIP-Container — die entpackte Grösse ist ein Vielfaches der übertragenen.
- Konkretes Fehlerszenario: Ein Mitglied lädt eine 20 MB grosse `.xlsx` hoch, deren Blätter entpackt mehrere hundert MB XML ergeben (bei stark komprimierbarem Inhalt ist das kein konstruierter Angriff, sondern eine real vorkommende Datei mit vielen formatierten Leerzeilen). Der Node-Prozess hält gleichzeitig den Rohpuffer, das entpackte XML und das ExcelJS-Objektmodell — und bedient dabei **alle** Mandanten. Das Ergebnis ist ein OOM-Neustart, der alle Organisationen trifft. Dies ist nach `gatherOrgExport` (Batch 3) der zweite unbegrenzte Speicherpfad, der von einem gewöhnlichen Mitglied auslösbar ist.
- Vorschlag: `file.size` vor dem Einlesen gegen ein Limit (z.B. 10 MB) prüfen und sonst mit 413 antworten. Zusätzlich `sheet.rowCount` nach dem Laden begrenzen, bevor die Zeilenschleife startet.

### [SCHWERE: NIEDRIG] Import schreibt Zeiteinträge und Kundenstunden in getrennten Vorgängen
- Datei: app/api/import/timesheet/route.ts:92-104 (`timeEntry.createMany`) und 144-146 (`customerMonth.createMany`)
- Problem: Beide Schreibvorgänge laufen im `commit`-Modus nacheinander ohne gemeinsame Transaktion.
- Konkretes Fehlerszenario: Die Zeiteinträge werden geschrieben, danach scheitert `customerMonth.createMany` (z.B. weil zwischenzeitlich ein Kunde gelöscht wurde — siehe den KRITISCH-Fund aus Batch 5, der das jedem Mitglied erlaubt). Der Nutzer sieht "Interner Serverfehler" und geht davon aus, dass der Import fehlgeschlagen ist. Tatsächlich sind die Tageszeiten bereits importiert; beim zweiten Versuch werden sie als `skippedExisting` gemeldet, was wie ein Doppelimport aussieht. Der Zustand ist reparierbar, aber die Rückmeldung führt in die Irre.
- Vorschlag: Beide `createMany`-Aufrufe in ein gemeinsames `prisma.$transaction` legen.

## Batch 7 — Schema, restliche Exporte und erste Seiten (`export/arg-control` + `payroll` + `stundenrapport`, `prisma/schema.prisma`, `app/layout`, `app/page`, `(app)/layout`, `calendar`, `absences`, `analytics`)

> **Schema und Exporte sind solide.** Das Datenmodell ist durchgehend kommentiert und begründet; die Entscheidung gegen ein `@@unique` auf `CustomerMonth` (Zeile 384-391) ist mit der NULL-Semantik von PostgreSQL korrekt hergeleitet. Die drei Export-Routen scopen sauber (`payroll` verlangt `owner`/`admin`, `stundenrapport` ist self-only, `arg-control` prüft `canSeeUser` **und** `orgId`). `app/page.tsx` leitet serverseitig um — das ist die einzige Seite, die das tut.
>
> **Geklärt:** `LoginAttempt` hat beide benötigten Indizes (Batch-2-Fund entsprechend entschärft) · `TimeEntry` hat bestätigt **keinen** Unique-Constraint (Batch-1-Race-Fund steht) · `deletedAt` existiert **ausschliesslich** auf `TimeEntry` — `Customer`, `Project`, `OvertimePayout`, `AbsenceRequest` und `CustomerMonth` haben keins, was die Funde aus Batch 4 und 5 bestätigt.
>
> **Hinweis zu bestehenden Funden:** `arg-control` ist der am stärksten betroffene Aufrufer von `parseExportRange` (Batch-3-Fund "Export-Zeitraum ohne Obergrenze) — die Route läuft Tag für Tag durch den Zeitraum und ruft je Tag `pruefeCompliance()` auf. Sie erbt ausserdem den Nachtarbeits-Fehler aus Batch 1, und zwar an genau der Stelle, für die sie gebaut wurde.

### [SCHWERE: MITTEL] Fehlgeschlagene Ladevorgänge sind in der Oberfläche unsichtbar
- Datei: app/(app)/calendar/page.tsx:112-116, 122-126, 132-136, 142-146, 152-155, 175-179 — und ebenso app/(app)/analytics/page.tsx:117-121
- Problem: Alle Ladefunktionen folgen demselben Muster: `const res = await fetch(...); if (res?.ok) { setState(...) }` — **ohne `else`**. Ein HTTP-Fehlerstatus (401, 403, 429, 500) führt damit zu gar keiner Reaktion: kein Toast, kein Fehlerzustand, nicht einmal ein `console.error` (das steht nur im `catch`, das ausschliesslich bei geworfenen Netzwerkfehlern greift). Die Schreibpfade sind deutlich besser gebaut — `app/(app)/profile/page.tsx:449` etwa zeigt bei `!res.ok` einen Toast mit der Servermeldung. Nur die Lesepfade schweigen.
- Konkretes Fehlerszenario: Die Datenbankverbindung fällt kurz aus, `GET /api/time-entries` liefert 500. Der Kalender rendert einen **vollständig leeren Monat** — ohne Fehlermeldung, ohne Wiederholen-Möglichkeit. Für eine Zeiterfassung ist das die denkbar schlechteste stille Fehlerform: Die Nutzerin sieht, dass ihre erfassten Stunden verschwunden sind, und muss annehmen, dass Daten verloren gingen. Dasselbe passiert bei abgelaufener Session (401), bevor der clientseitige Redirect aus `app/(app)/layout.tsx:58` greift.
- Vorschlag: Einen gemeinsamen Fetch-Helfer einführen, der bei `!res.ok` einen Fehlerzustand setzt, und die Seiten zwischen "geladen, leer" und "konnte nicht geladen werden" unterscheiden lassen — mit Wiederholen-Knopf. Die Unterscheidung ist genau die, die der Nutzer braucht, um Vertrauen in die Daten zu behalten.

### [SCHWERE: MITTEL] Analytics zeigt bei einem Fehler die Zahlen des vorherigen Zeitraums unter neuer Beschriftung
- Datei: app/(app)/analytics/page.tsx:114-122
- Problem: Verschärfung des vorigen Punktes durch den Zustandsverlauf. `setData(...)` wird nur bei `res.ok` aufgerufen; `setLoading(false)` läuft im `finally` immer. Schlägt eine Anfrage fehl, bleibt der **alte** `data`-Zustand stehen, während die Auswahl (Periodentyp, Monat, Jahr) bereits auf den neuen Wert umgestellt ist. Die Seite kennt keinen Fehlerzustand — `toast` und `setError` kommen in der Datei gar nicht vor.
- Konkretes Fehlerszenario: Die Nutzerin sieht die Auswertung für März und stellt auf einen benutzerdefinierten Zeitraum um, dessen `from`/`to` einen 400er auslösen (`parseExportRange` wirft `AccessError(400)` bei ungültigem Datum, lib/export-helpers.ts:53). Der Ladebalken verschwindet, und die Seite zeigt weiterhin **die März-Zahlen** — jetzt aber unter der Überschrift des neu gewählten Zeitraums. Es gibt keinen Hinweis, dass die Anfrage fehlgeschlagen ist. Die Nutzerin liest Soll, Ist, Überstunden und Verrechnungsgrad für einen Zeitraum, zu dem diese Zahlen nicht gehören — und kann das an nichts erkennen.
- Vorschlag: Bei `!res.ok` `setData(null)` setzen und einen Fehlerhinweis mit der Servermeldung rendern. Solange kein gültiges Ergebnis vorliegt, darf die Seite keine Zahlen zeigen.

### [SCHWERE: MITTEL] Die Aufräumaufgabe für Fehlerprotokolle ist vorgesehen, aber nicht vorhanden
- Datei: prisma/schema.prisma:465-472 (`OpsEvent.kind // "backup" | "errorlog-prune"`), lib/dev-metrics.ts:539-557 (`OpsEventStatus = "ok" | "failed" | "missing"`) — kein Skript in `deploy/` oder `scripts/`, das ein solches Ereignis schreibt
- Problem: Das Schema nennt `"errorlog-prune"` ausdrücklich als eine der beiden erwarteten Betriebsaufgaben, und die Developer-Übersicht hat einen Statusslot dafür, der `"missing"` als Zustand kennt. Implementiert ist die Aufgabe nirgends: `deploy/` enthält `backup.sh`, `deploy.sh` und `restore.sh`, aber kein Prune-Skript, und keine Route oder kein Skript ruft `errorLog.deleteMany` auf.
- Konkretes Fehlerszenario: `/dev` zeigt für "errorlog-prune" dauerhaft den Zustand "missing". Der Betreiber sieht eine rote Kachel, die sich durch nichts beheben lässt, weil es die Aufgabe gar nicht gibt — und gewöhnt sich daran, diese Kachel zu ignorieren. Damit verliert die Übersicht genau die Warnfunktion, für die sie laut Schema-Kommentar gebaut wurde ("ohne diese Tabelle ist ein stiller Fehlschlag des Backups aus der App heraus nicht erkennbar"): Wenn später auch das Backup rot wird, steht es neben einer Kachel, die immer rot ist.
- Vorschlag: Entweder das Prune-Skript nachliefern (Löschen von `ErrorLog` älter als 90 Tage und `LoginAttempt` älter als 24 Stunden, mit `OpsEvent`-Eintrag — das löst zugleich den Aufbewahrungs-Fund aus Batch 2) oder `"errorlog-prune"` aus Schema-Kommentar und Dashboard entfernen, bis es die Aufgabe gibt.

### [SCHWERE: NIEDRIG] Vorbelegtes Startdatum wird mit lokalen Gettern aus einem UTC-Zeitstempel gebildet
- Datei: app/(app)/analytics/page.tsx:83-87
- Problem: `const sd = new Date(profile.startDate)` — `startDate` kommt als ISO-Zeitstempel mit UTC-Mitternacht (`app/api/profile/route.ts:39` ruft `toISOString()` auf einem `@db.Date`-Wert). Anschliessend wird mit `sd.getFullYear()`, `sd.getMonth()`, `sd.getDate()` gerechnet, also mit **lokalen** Gettern. Dieselbe Fehlerklasse wie bei `fmtDate` (Batch 3), hier aber clientseitig — massgeblich ist die Zeitzone des **Browsers**, nicht die des Servers, und die lässt sich nicht per Deployment festlegen.
- Konkretes Fehlerszenario: Eine Person mit Eintrittsdatum 01.03.2020 öffnet die Auswertung von einem Rechner mit einer Zeitzone westlich von UTC (Reise, VPN, falsch gestellte Systemzeit). `new Date("2020-03-01T00:00:00.000Z").getDate()` liefert dort **29** und `getMonth()` **1** — das benutzerdefinierte "von"-Feld wird mit dem 29.02.2020 vorbelegt. Für Nutzer in `Europe/Zurich` (östlich von UTC) tritt der Fehler nicht auf, weshalb er im Alltag lange unbemerkt bleibt.
- Vorschlag: Den Datumsanteil direkt aus dem String schneiden (`profile.startDate.slice(0, 10)`) statt über ein `Date`-Objekt zu gehen — das Feld erwartet ohnehin das Format `YYYY-MM-DD`.

## Batch 8 — App- und Auth-Seiten (`team`, `admin/holidays`, `admin/legal`, `admin/team`, `profile`, `set-password`, `login`, `register`, `invite`, `forgot-password`)

> **Korrektur an Batch 2:** Alle vier rollengeschützten Seiten sichern sich selbst ab (`router.replace` + `return null`). Der dortige Fund war in der Sache falsch und ist umgeschrieben — als NIEDRIG mit dem verbleibenden, tatsächlichen Problem (vierfache Duplizierung, greift bei `role === null` nicht).
> **Einordnung zu Batch 5:** Die Profilseite begrenzt Pensum/Wochenstunden/Ferientage clientseitig; die fehlende Serverprüfung ist damit nur per direktem API-Aufruf erreichbar. Am Fund ändert das nichts, an der Eintrittswahrscheinlichkeit schon — als Nachtrag ergänzt.
> **Bestätigt:** Das Muster `if (res?.ok) { … }` ohne `else` zieht sich durch **alle** Seiten dieses Batches (Profil 23×, Teamverwaltung 12×, Feiertage 4×, Teamsicht 2×). Die Schreibpfade zeigen dagegen durchgehend Toasts — der Fund aus Batch 7 gilt damit app-weit für Lesevorgänge.

### [SCHWERE: MITTEL] Rollenwechsel und Deaktivierung feuern sofort beim Auswählen, ohne Rückfrage
- Datei: app/(app)/admin/team/page.tsx:377 (`role`), 391 (`status`), 403 (`managerId`)
- Problem: Alle drei `<select>`-Felder rufen `updateMember()` direkt im `onChange` auf. Es gibt keinen Speichern-Knopf, keinen Bestätigungsdialog und keine Rückgängig-Möglichkeit. In einer Tabelle mit einer Zeile pro Person liegen diese Dropdowns dicht untereinander; ein `<select>` ändert in mehreren Browsern seinen Wert bereits beim Scrollen mit dem Mausrad, wenn es den Fokus hat.
- Konkretes Fehlerszenario: Die Administratorin scrollt durch die Mitgliederliste, das Mausrad steht über dem Status-Dropdown einer Person. Der Wert springt auf "inaktiv", der PUT geht sofort raus, die Mitgliedschaft ist deaktiviert. Erschwerend: Weil `requireOrg()` die Rolle nur aus dem JWT liest (Fund "Rollenentzug wirkt bis zu 24 Stunden nicht"), merkt die betroffene Person davon zunächst nichts — und wenn die Administratorin den Fehler bemerkt und zurückstellt, ist auch das für die Sitzung folgenlos. Es gibt keinen Audit-Eintrag (siehe Fund "Änderungen an Mitgliedschaften werden nirgends protokolliert"), über den sich später nachvollziehen liesse, was passiert ist.
- Vorschlag: Für Rolle und Status einen Bestätigungsdialog vorschalten, der Namen und Zielzustand nennt (`AlertDialog` ist im Projekt vorhanden, `components/ui/alert-dialog.tsx`). Die Kombination "sofort wirksam, unbestätigt, unprotokolliert, 24h verzögert sichtbar" ist für die sicherheitsrelevanteste Eingabemaske der App zu wenig.

### [SCHWERE: MITTEL] Stammdatenfelder der Teamverwaltung sind unkontrolliert und behalten nach einem Fehler den falschen Wert
- Datei: app/(app)/admin/team/page.tsx:415 (`entryDate`), 419 (`exitDate`)
- Problem: Beide Datumsfelder sind **uncontrolled** (`defaultValue` statt `value`) und speichern im `onBlur`. Schlägt der PUT fehl, wird der Zustand nicht zurückgesetzt — das Feld zeigt weiterhin den eingegebenen Wert, obwohl der Server ihn nie übernommen hat. Genau dieser Fehlerfall ist realistisch: `app/api/admin/team/route.ts:107-112` reicht die Datumsangaben ungeprüft an `new Date()` weiter und liefert bei ungültigem Format einen 500er (Fund "Ungültige Datumsangaben ergeben 500 statt 400").
- Konkretes Fehlerszenario: Die Administratorin trägt bei einer Person das Austrittsdatum ein, verlässt das Feld, und der Server antwortet mit 500. Ein Fehler-Toast erscheint kurz. Das Feld zeigt aber weiterhin das eingetragene Datum. Beim nächsten Blick auf die Seite — oder für eine Kollegin, die die noch offene Seite ansieht — sieht es so aus, als sei das Austrittsdatum gesetzt. Erst ein Neuladen deckt auf, dass es fehlt. Da `exitDate` über `sollStundenTag()` (lib/calc.ts:204) sämtliche Sollstunden nach diesem Tag auf 0 setzt, ist der Unterschied zwischen "gesetzt" und "nicht gesetzt" für die Lohnabrechnung erheblich.
- Vorschlag: Beide Felder auf kontrollierte Eingaben umstellen und nach einem fehlgeschlagenen `updateMember` aus dem Serverzustand neu befüllen (`fetchMembers()` im Fehlerpfad, nicht nur im Erfolgspfad).

### [SCHWERE: NIEDRIG] Teamsicht meldet Fehler überhaupt nicht
- Datei: app/(app)/team/page.tsx — 2 `fetch`-Aufrufe, beide nach dem `if (res?.ok)`-Muster, **kein einziger** `toast`-Aufruf in der gesamten Datei
- Problem: Die Teamsicht ist neben `analytics` die zweite Seite ohne jede Fehlerrückmeldung. Sie ist zugleich diejenige, die am ehesten in einen Fehler läuft: `GET /api/team` aggregiert über alle sichtbaren Mitglieder und ruft dabei `kennzahlen()` je Person auf — die Route mit der längsten Laufzeit und dem grössten Datenvolumen der App.
- Konkretes Fehlerszenario: Eine Managerin öffnet die Teamsicht für einen grossen Zeitraum, die Anfrage läuft in einen Timeout des Reverse Proxy (Caddy, `deploy/Caddyfile`). Die Seite zeigt eine leere Mitgliederliste. Für die Managerin sieht das so aus, als hätte niemand in ihrem Team Stunden erfasst — eine Aussage, auf die sie reagieren könnte, obwohl sie schlicht falsch ist.
- Vorschlag: Denselben Fehlerzustand ergänzen wie bei den übrigen Seiten (siehe Fund "Fehlgeschlagene Ladevorgänge sind in der Oberfläche unsichtbar") und dabei zwischen "Team hat keine Einträge" und "konnte nicht geladen werden" unterscheiden.

## Batch 9 — Dev-Seiten und eigene Komponenten (`reset-password`, `dev/*`, `day-entry-dialog`, `absence-year-overview`, `analytics-charts`, `customer-month-card`, `pensum-preview`, `project-month-summary`)

> **Der Tagesdialog ist der am besten gebaute Teil der Anwendung** — und er entlastet gleich drei offene Punkte:
> - **`geklemmt` wird ausgewertet** (day-entry-dialog.tsx:546, Hinweis *"Das Ende wurde auf 23:59 begrenzt."*). Der Batch-4-Fund behauptete, **kein** Aufrufer werte das Flag aus; das war falsch und ist korrigiert. Ohne Auswertung bleiben nur die beiden Massenpfade (`bulk-apply`, Excel-Import).
> - **Die Überlappungs-`warnings` der API werden angezeigt** (Zeile 326-327, je ein `toast.warning`). Offener Punkt aus Batch 4 erledigt, ohne Fund.
> - **Migrierte Zeilen sind gekennzeichnet und die Graduierung ist angekündigt** (Zeile 461-463: *"Nur Projektzeit aus dem Import — zählt erst zur Arbeitszeit, sobald diese Zeile hier gespeichert wird."*). Der HOCH-Fund aus Batch 4 ist entsprechend umformuliert: Er betrifft nicht die Graduierung selbst, sondern ihre **unangekündigte Doppelzählungs-Folge** gegenüber `CustomerMonth`.
>
> **Weitere Positivbefunde:** Doppeltes Absenden ist sauber verhindert (`saving` je Zeile, Speichern-Knopf deaktiviert bei laufendem Speichern und bei blockierenden Konflikten, Zeile 453/653). `components/pensum-preview.tsx:18` nutzt die kanonische `tagessollBasis()` aus `lib/calc.ts` — die Live-Vorschau kann nicht von der echten Berechnung abweichen. `app/(dev)/dev/page.tsx:143-262` rendert für **jede** Kachel das `error`-Feld und hält damit die Fehlerkonvention aus `lib/dev-metrics.ts` ein — was den Batch-3-Fund zu `getOrgDetail` bestätigt: Die Detailseite ist die einzige, die das nicht kann, weil ihrem Rückgabetyp das Feld fehlt.

### [SCHWERE: NIEDRIG] `customer-month-card.tsx` ist toter Code
- Datei: components/customer-month-card.tsx (282 Zeilen) — nirgends importiert; erwähnt wird die Datei nur noch in zwei Kommentaren (`components/project-month-summary.tsx:3` "Ersetzt components/customer-month-card.tsx", `app/(app)/calendar/page.tsx:327`)
- Problem: Die Komponente wurde am 19.08.2026 durch `ProjectMonthSummary` abgelöst, aber nicht entfernt. Sie enthält weiterhin eine vollständige, eigene Lade- und Speicherlogik gegen `/api/customer-months` samt eigener Zustandshaltung — also eine zweite, nicht mehr angebundene Implementierung eines Datenpfads, den es real noch gibt (die Bearbeitung lebt heute in `app/(app)/profile/page.tsx:591`).
- Konkretes Fehlerszenario: Kein Laufzeitfehler — die Datei wird nicht gebündelt. Der Schaden ist Irreführung bei der Weiterentwicklung: Wer die Kundenstunden-Bearbeitung sucht, findet zuerst diese Komponente, liest ihre Logik und passt womöglich sie an statt der Profilseite. Die Änderung hätte dann keinerlei Wirkung, und der Fehler wäre erst beim Testen im Browser bemerkbar. Zusätzlich enthält die Datei in Zeile 145 dieselbe `hours <= 0`-Ablehnung, die in Batch 4 als eine der beiden Ursachen dafür identifiziert wurde, dass sich eine Kundenstunden-Korrektur auf 0 nicht speichern lässt — wer den Fund beheben will, könnte ihn hier "beheben" und sich wundern.
- Vorschlag: Datei löschen. Die beiden Kommentare, die auf sie verweisen, entsprechend anpassen (der Hinweis in `project-month-summary.tsx` bleibt als Historie sinnvoll, sollte aber nicht mehr auf eine existierende Datei zeigen).

## Batch 10 — Provider, Theme, Dev- und Layout-Komponenten

> **Durchweg sauber.** Bemerkenswert ist der Kontrast zu den Produktseiten: Die `/dev`-Komponenten behandeln Fehler **vorbildlich** — `components/dev/org-plan-actions.tsx:37-47,61-69` und `components/dev/reset-link-button.tsx:27-34` prüfen jeweils `!res.ok`, zeigen die Servermeldung als Toast, deaktivieren die Knöpfe über einen `pending`-Zustand und rufen erst nach Erfolg `router.refresh()`. Genau das fehlt den Lesepfaden der Produktseiten (Fund aus Batch 7). Die Betriebsoberfläche ist robuster gebaut als die Nutzeroberfläche.
>
> Weitere Positivbefunde: `theme-toggle.tsx` nutzt begründet `resolvedTheme` statt `theme` (sonst würde der erste Klick bei `defaultTheme="system"` immer auf Dunkel schalten). `StatusDot` ist korrekt `aria-hidden` und steht in `app/(dev)/dev/page.tsx:92-105` immer neben einem Textlabel — Farbe ist also nie der einzige Informationsträger. Der Planwechsel in `org-plan-actions.tsx:88` verlangt erst eine Auswahl und dann einen separaten Knopfdruck (`disabled={pending || selectedPlan === currentPlan}`) — der wohltuende Gegenentwurf zu den sofort feuernden Dropdowns in der Teamverwaltung (Fund aus Batch 8).

### [SCHWERE: NIEDRIG] Vier von fünf Layout-Komponenten sind toter Code
- Datei: components/layouts/app-shell.tsx (65 Zeilen), auth-layout.tsx (30), container.tsx (23), section.tsx (13) — von den fünf Dateien in `components/layouts/` wird ausschliesslich `page-header.tsx` importiert (in `app/(dev)/dev/page.tsx:22` und `app/(dev)/dev/orgs/[slug]/page.tsx:12`)
- Problem: `AppShell` ist nicht bloss unbenutzt, sondern **architektonisch abweichend**: Die Komponente implementiert ein Layout mit ausklappbarer Seitenleiste (`aside` mit `translate-x`, Mobile-Overlay, Hamburger-Knopf). Die App verwendet aber durchgehend ein Layout mit Kopfzeile und Tabs (`app/(app)/layout.tsx`). Es liegt also ein vollständiger, funktionsfähiger Gegenentwurf zum tatsächlichen Navigationskonzept im Repository.
- Konkretes Fehlerszenario: Kein Laufzeitfehler — die Dateien werden nicht gebündelt. Der Schaden ist Irreführung: Wer die Navigation der App ändern oder eine neue Seite anlegen soll, findet unter `components/layouts/` ein vollständiges Shell-Gerüst und nimmt an, das sei die Grundlage der App. Erst ein Blick in `app/(app)/layout.tsx` zeigt, dass dort nichts davon verwendet wird. Nebenbei trüge `AppShell` bei einer späteren Übernahme eigene Mängel mit: Das Mobile-Overlay ist ein `div` mit `onClick` ohne Tastaturbedienung, und die geschlossene Seitenleiste bleibt per Tab erreichbar (kein `aria-hidden`, kein `inert`).
- Konsolidierte Sicht: Zusammen mit `components/customer-month-card.tsx` (282 Zeilen, Batch 9) und den Vorlagenresten in `lib/types.ts`/`lib/utils.ts` (Batch 3) liegen rund **430 Zeilen** unbenutzter Code im Projekt — durchweg Stellen, an denen jemand plausibel die falsche Datei bearbeiten könnte.
- Vorschlag: Die vier Dateien löschen. Falls das Seitenleisten-Layout als Option erhalten bleiben soll, gehört das in einen Branch oder eine Notiz, nicht in `components/`.

## Batch 11 — Angepasste UI-Bausteine (`layouts/*`, `date-range-picker`, `month-year-picker`, `task-card`, `animate`, `use-toast` ×2, `toast`, `toaster`)

> **Positivbefund:** `components/ui/month-year-picker.tsx` ist ein gutes Stück Arbeit und wird an vier Stellen genutzt. Die Begründung im Kopfkommentar trifft einen echten i18n-Fallstrick: Ein natives `<input type="month">` beschriftet den Monat in der Sprache des **Browsers**, nicht der App — in einer durchgehend deutschen Oberfläche stünde je nach System "October 2026". Die Komponente greift stattdessen auf die `month.1..12`-Strings aus `lib/i18n.tsx` zurück.

### [SCHWERE: MITTEL] Zwei Toast-Systeme im Projekt — das zweite ist doppelt vorhanden und wirkungslos
- Datei: components/ui/use-toast.ts (191 Zeilen) und hooks/use-toast.ts (191 Zeilen) — **byte-identisch** (`diff` meldet keinen Unterschied) — sowie components/ui/toast.tsx (129) und components/ui/toaster.tsx (35)
- Problem: Die Anwendung verwendet durchgehend **sonner**: elf Dateien importieren `toast` aus `"sonner"`, und `components/providers.tsx:6,14` montiert genau einen `<Toaster />`, nämlich den aus `@/components/ui/sonner`. Daneben liegt das vollständige shadcn-Toast-System — zweimal derselbe Hook plus Komponente und Renderer. Es wird von **keiner** Datei der Anwendung importiert; der einzige Verweis auf `use-toast` im ganzen Projekt steht in `components/ui/toaster.tsx:3`, und dieser Renderer wird selbst nirgends eingebunden.
- Konkretes Fehlerszenario: Jemand ergänzt eine Meldung in einer neuen Komponente, lässt sich `useToast` von der Autovervollständigung vorschlagen und bekommt `@/hooks/use-toast` oder `@/components/ui/use-toast` angeboten (beide existieren, beide sehen richtig aus). Der Code kompiliert, `toast({ title: "Gespeichert" })` läuft ohne Fehler durch, der Zustand wird im Reducer korrekt abgelegt — und **es erscheint nichts**, weil der zugehörige `<Toaster>` nie gerendert wird. Es gibt keine Fehlermeldung und keinen Hinweis; die Ursache ist nur zu finden, wenn man weiss, dass es zwei Systeme gibt. Erschwerend: Bei zwei identischen Dateien ist nicht erkennbar, welche die "richtige" ist.
- Vorschlag: `components/ui/use-toast.ts`, `hooks/use-toast.ts`, `components/ui/toast.tsx` und `components/ui/toaster.tsx` löschen (zusammen 546 Zeilen). `components/ui/sonner.tsx` bleibt als einziges Toast-System. Falls das shadcn-System bewusst erhalten bleiben soll, muss zumindest die Verdopplung weg und ein Kommentar erklären, welches wofür gilt.

### [SCHWERE: NIEDRIG] Drei weitere UI-Bausteine ohne Verwender
- Datei: components/ui/task-card.tsx (65 Zeilen), components/ui/animate.tsx (144), components/ui/date-range-picker.tsx (65)
- Problem: Keine dieser drei Dateien wird importiert (geprüft über den Importpfad `components/ui/<name>"`, nicht per Textsuche). `task-card` ist dabei fachfremd — eine Karte für "Tasks", ein Begriff, den die Zeiterfassung nicht kennt; sie stammt vermutlich aus derselben Projektvorlage wie die `Expense`-Typen aus `lib/types.ts` (Fund aus Batch 3). `animate.tsx` ist mit 144 Zeilen die grösste der drei und dupliziert Animationslogik, die die Seiten heute direkt über `framer-motion` lösen.
- Konkretes Fehlerszenario: Kein Laufzeitfehler. Wie bei den übrigen Altlasten besteht der Schaden darin, dass eine Suche nach "wie animiere ich hier etwas" oder "gibt es schon eine Datumsbereichs-Auswahl" auf eine fertige, funktionsfähige, aber nicht angebundene Komponente führt — und die Antwort "ja, gibt es" falsch ist.
- Konsolidierte Sicht: Mit diesem Batch summiert sich der unbenutzte Eigen-Code auf rund **1 250 Zeilen** (Batch 3: Vorlagenreste in `types.ts`/`utils.ts`; Batch 9: `customer-month-card.tsx` 282; Batch 10: vier Layout-Dateien 131; Batch 11: Toast-System 546 und diese drei 274). Nicht mitgezählt sind die shadcn-Primitive — dass eine Komponentenbibliothek ungenutzte Bausteine enthält, ist normal und wird in den folgenden Batches bewusst nicht als Fund geführt.
- Vorschlag: Die drei Dateien löschen. Ein Aufräum-Commit über alle in diesem Audit genannten toten Dateien ist risikoarm (nichts importiert sie) und macht das Projekt spürbar leichter lesbar.

## Batch 12 — Seed-/Betriebsskripte und erste shadcn-Primitive

> **Letzter offener Punkt aus Batch 1 geklärt:** `scripts/set-plan.ts:33` validiert gegen `VALID_PLANS`. Damit ist geprüft, dass **kein** Schreibweg einen unbekannten Plan-Wert in die Datenbank bringt — der Fail-open-Fund zu `lib/billing.ts` ist entsprechend als latente Falle annotiert. Nebenbei bestätigt: Das Skript enthält in Zeile 51 denselben Trial-Reset-Fehler wie `lib/dev-actions.ts:49`; der Fund aus Batch 3 hat damit zwei Fundorte.
> Die vier shadcn-Primitive dieses Batches (`accordion`, `alert-dialog`, `alert`, `aspect-ratio`) sind unverändert und ohne Beanstandung.

### [SCHWERE: MITTEL] Die Schutzprüfung vor dem Seeden verschluckt ihre eigenen Fehler
- Datei: scripts/safe-seed.ts:5-25 (`try { … } catch (err: any) { }`) — leerer `catch`-Block, danach Zeile 27 `execSync("tsx --require dotenv/config scripts/seed.ts")`
- Problem: Das Skript existiert einzig, um `scripts/seed.ts` vor dem Ausführen auf `prisma.*.delete(` / `prisma.*.deleteMany(` zu prüfen und abzubrechen, falls welche gefunden werden. Die Warnung im Skript benennt den Grund unmissverständlich: *"production and deployment database can be shared"*. Der gesamte Prüfblock steht aber in einem `try` mit **leerem** `catch`. Schlägt `fs.readFileSync` fehl, wird der Fehler verworfen — und die Ausführung läuft trotzdem in Zeile 27 weiter, ohne dass je geprüft wurde.
- Konkretes Fehlerszenario: `npm run seed` wird aus einem anderen Arbeitsverzeichnis gestartet (der Pfad wird über `process.cwd()` aufgelöst, Zeile 6) oder die Datei wurde umbenannt. `readFileSync` wirft `ENOENT`, der leere `catch` schluckt es **ohne jede Ausgabe**, und `execSync` startet den Seed ungeprüft. Der Nutzer sieht keinen Unterschied zu einem normalen Lauf — die Schutzprüfung hat stillschweigend nicht stattgefunden. Genau in dem Moment, in dem der Wächter am nötigsten wäre (unerwarteter Zustand), gibt er auf.
- Vorschlag: Im `catch` mit einer klaren Meldung abbrechen (`process.exit(1)`) statt fortzufahren — ein Wächter, der bei eigenem Fehlschlag durchwinkt, ist keiner. Zusätzlich prüfen, ob die Datei überhaupt existiert, bevor gelesen wird.

### [SCHWERE: MITTEL] Der Lasttest-Seed löscht 14 Tabellen und ist durch nichts abgesichert
- Datei: scripts/loadtest-seed.ts:33-48 (14 `deleteMany`-Aufrufe) — nicht von `scripts/safe-seed.ts` erfasst, das ausschliesslich `scripts/seed.ts` prüft (safe-seed.ts:6)
- Problem: `seed.ts` und `seed-demo-team.ts` sind ausweislich ihrer Kommentare bewusst idempotent und löschfrei — die Schutzprüfung greift also dort, wo ohnehin nichts zu holen ist. Das Skript mit den echten Löschoperationen ist das **einzige**, das der Wächter nicht kennt, und es wird laut eigenem Kopfkommentar direkt aufgerufen (`npx tsx scripts/loadtest-seed.ts`). Die Datenbankverbindung zieht es wie jedes andere Skript aus `DATABASE_URL`; die Einschränkung *"Ausschliesslich lokal gedacht"* steht ausschliesslich im Kommentar und wird nirgends erzwungen.
- Konkretes Fehlerszenario: Auf der Deployment-VM zeigt die `.env` auf die Produktionsdatenbank (`deploy/deploy.sh:15` prüft genau diese Datei als Voraussetzung). Wer dort zur Fehlersuche `npx tsx scripts/loadtest-seed.ts` ausführt — etwa um ein Performanceproblem nachzustellen, wofür das Skript gebaut wurde —, löscht in der Produktionsdatenbank Zeiteinträge, Audit-Zeilen, Monatssperren, Absenzanträge, Auszahlungen, Kunden und Projekte. Die Löschungen sind zwar auf `LOADTEST_ORG` eingegrenzt, aber Zeile 46 löscht zusätzlich `User`-Datensätze; da `Membership.user` laut Schema `onDelete: Cascade` trägt, verschwindet ein so gelöschter Mensch auch aus **jeder anderen** Organisation, in der er Mitglied ist.
- Vorschlag: Am Anfang des Skripts abbrechen, wenn `DATABASE_URL` nicht auf `localhost`/`127.0.0.1` zeigt oder `NODE_ENV === "production"` gesetzt ist. Die `user.deleteMany`-Zeile zusätzlich auf Nutzer beschränken, die ausschliesslich in der Lasttest-Organisation Mitglied sind.

## Batches 13–16 — shadcn-Primitive (42 Dateien) — **keine Funde**

Wie in der Statusdatei vor Batch 12 festgelegt, wurden diese Dateien nicht Zeile für Zeile geprüft, sondern gezielt auf das untersucht, was bei Fremdcode relevant ist: **lokale Abweichungen vom shadcn-Standard, eigene Logik und Zugänglichkeits-Regressionen durch Anpassungen**. Dass eine Komponentenbibliothek ungenutzte Bausteine enthält, ist normal und wird hier bewusst nicht als Fund geführt — sonst entstünden 30 Einträge ohne Erkenntniswert.

Ergebnis der Prüfung:
- **Keine der 42 Dateien enthält eigene Zustands- oder Rechenlogik.** Eine Suche nach `useState|useEffect|useMemo|new Date|Math.|locale|weekStartsOn` trifft ausserhalb der bereits behandelten Eigenentwicklungen (`month-year-picker`, `task-card`) nur `carousel.tsx` — und dort ausschliesslich die unveränderte Embla-Anbindung des shadcn-Originals.
- **Kein `any`, kein `@ts-ignore`, kein `TODO`/`FIXME`** in den Primitiven.
- `components/ui/sonner.tsx` — das einzige tatsächlich eingebundene Toast-System — ist unverändert und reicht `theme` korrekt an Sonner durch (der Wert `"system"` wird von der Bibliothek selbst aufgelöst, anders als bei `next-themes`, wo `theme-toggle.tsx` begründet `resolvedTheme` verwendet).
- `components/ui/calendar.tsx` konfiguriert weder `locale` noch `weekStartsOn`, würde also mit englischen Wochentagen und Sonntag als Wochenbeginn rendern — im Widerspruch zur deutschen Oberfläche und zur Montags-Konvention aus `lib/calc.ts:montagDerWoche`. **Das ist kein Fund**, weil die Komponente ausschliesslich von `components/ui/date-range-picker.tsx` importiert wird und diese selbst niemand einbindet (Fund aus Batch 11). Sollte die Datumsbereichs-Auswahl je aktiviert werden, muss beides gesetzt werden — dieser Hinweis gehört an den Fund aus Batch 11.

