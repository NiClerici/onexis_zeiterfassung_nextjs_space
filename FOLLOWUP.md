# FOLLOWUP.md — Vorschläge aus HARDENING.md

Vier Befunde aus dem HARDENING.md-Loop (Teil A/B), die bewusst **nicht**
dort gefixt wurden — entweder weil sie eine fehlende REGEL/ein fehlendes
FEATURE sind statt eines Rechenfehlers, oder weil sie über reines
Testlücken-Schliessen hinausgehen und eigene Sorgfalt verdienen (Security-
Flows). HARDENING.md selbst ist inzwischen vollständig abgeschlossen (Teil
A, B, C alle abgehakt); diese Datei ist der dort mehrfach angekündigte
Nachtrag.

**Anders als HARDENING.md: dieser Loop DARF Features bauen** — die vier
Punkte hier sind genau dafür vorgesehen. Trotzdem gilt: pro Punkt eine
bewusste Entscheidung, keine Nebenbei-Umbauten an Dingen, die der Punkt
nicht verlangt.

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

**Referenzwerte, die nach JEDEM Punkt noch stimmen müssen** (Profil 40h,
60%, 25 Ferientage, Start 01.04.2026, Stichtag 12.08.2026 — aus
HARDENING.md, Punkt 1 und 2 unten berühren `lib/calc.ts` direkt):
- Sollstunden/Tag = 4.8
- Soll August bis 12.08. = 38.4, Soll August gesamt = 100.8
- Ferienanspruch 2026 = 18.8

Alle vier Punkte sind unabhängig voneinander — Reihenfolge ist nicht
zwingend, aber sinnvoll von "reiner Rechenlogik-Fix" zu "grösseres
Security-Testpaket".

---

### - [ ] 1. Ferienanspruch bei Austritt anteilig kürzen

**Befund (HARDENING.md A3, 17.08.2026):** `feriensaldo` in `lib/calc.ts:465-470`
kürzt den Jahresanspruch nur bei EINTRITT im Abfragejahr
(`(ferientage * (13 - startMonat)) / 12`). `profil.exitDate` geht in die
Formel nicht ein — wer am 31.01.2026 austritt, hat für 2026 trotzdem den
vollen Anspruch von 25 Tagen. `sollStundenTag` respektiert `exitDate`
bereits korrekt (kein Soll mehr nach dem Austrittstag, MIGRATION.md
Punkt 4d) — nur die Anspruchsformel kennt das Austrittsdatum nicht.

**Vorschlag:** Anspruch bei Austritt im Abfragejahr symmetrisch zur
Eintritts-Formel kürzen (`ferientage * austrittsMonat / 12`, wobei
"austrittsMonat" der letzte volle/anteilige Monat ist — exakte
Monatsdefinition analog zur bestehenden Eintritts-Formel klären, siehe
Test unten). Den Fall **Eintritt UND Austritt im selben Jahr** explizit
testen (beide Kürzungen kombiniert, nicht nur eine).

**Betroffene Stelle:** `lib/calc.ts`, Funktion `feriensaldo` (aktuell
Zeilen 459–495), speziell die `anspruch`-Berechnung 464–471.

**Tests:** in `lib/calc.test.ts`, im bestehenden
`describe("feriensaldo mit Pensumswechsel", …)`-Nachbarschaftsbereich oder
einem neuen `describe("feriensaldo bei Austritt", …)`:
- Austritt 31.01. im Abfragejahr → Anspruch gekürzt (nicht mehr 25)
- Austritt 31.12. im Abfragejahr → praktisch voller Anspruch
- Eintritt 01.04. UND Austritt im selben Jahr → beide Kürzungen kombiniert
- Austritt in einem SPÄTEREN Jahr als das Abfragejahr → keine Kürzung
  (Regressionstest, damit die neue Formel bestehende Fälle nicht bricht)
- Die vier HARDENING.md-Referenzwerte oben laufen weiterhin korrekt (Profil
  hat kein `exitDate`, darf also unverändert bleiben)

---

### - [ ] 2. Absenzen an Feiertagen erzeugen Phantom-Überstunden

**Befund (HARDENING.md A2, 17.08.2026):** `createAbsenceEntries`
(`lib/absence-entries.ts`) kennt die `Holiday`-Tabelle nicht — kein
Holiday-Query, kein `holidays`-Parameter. Der Skip für Feiertage in
`lib/absence-entries.ts:102` (`if (ex.type === "feiertag" || ex.type ===
type)`) greift nur, wenn für diesen Tag bereits von Hand ein
`feiertag`-TimeEntry angelegt wurde — nichts im Code materialisiert
Feiertage automatisch als solche Einträge. Eine genehmigte Ferienwoche, die
über einen Feiertag läuft, erzeugt am Feiertag deshalb einen normalen
`ferien`-Eintrag mit vollen Stunden.

Folge in `kennzahlen` (`lib/calc.ts`): `sollStundenTag` liefert für diesen
Tag 0 (`lib/calc.ts:182-183`, Feiertagsregel), die vollen Ferienstunden
zählen aber ins `ist` → Phantom-Überstunden in Höhe eines Tagessolls pro
betroffenem Feiertag. Der Feriensaldo selbst bleibt korrekt
(`lib/calc.ts:486`, `tagesSoll > 0 ? … : 0` verhindert eine Division durch
0 und zählt an dem Tag 0 Ferientage) — nur `ist`/`ueberstunden` sind
verfälscht.

**Vorschlag:** `createAbsenceEntries` um einen `holidays`-Parameter
erweitern (Signatur analog zu `sollStundenTag`/`kennzahlen` in
`lib/calc.ts`, die `holidays: HolidayInput[]` bereits kennen) und Tage, die
laut Holiday-Tabelle ganztägig frei sind, beim Erzeugen der Absenz-
TimeEntries überspringen (wie bereits bestehende `feiertag`-Einträge) oder
mit 0 Stunden anlegen — **Entscheidung zwischen "überspringen" und
"0-Stunden-Eintrag anlegen" vor der Umsetzung treffen**, da beides
unterschiedliche Folgen für die Anzeige im persönlichen Kalender hat
(ein übersprungener Tag zeigt dort evtl. gar keinen Eintrag, ein
0-Stunden-Eintrag schon). Halbtags-Feiertage (`Holiday.halfDay`) brauchen
denselben Halbierungs-Mechanismus wie `sollStundenTag` bereits hat.

**Betroffene Stellen:**
- `lib/absence-entries.ts`, Funktion `createAbsenceEntries` und
  `getDailyRateForDate` (aktuell Zeilen 26–60)
- Beide Aufrufer: `app/api/time-entries/bulk-vacation/route.ts` und
  `app/api/absence-requests/route.ts` (PATCH-Handler, `action === "approve"`)
  müssen die Holiday-Liste laden und durchreichen

**Tests:** in `lib/absence-entries.test.ts`, Erweiterung des bestehenden
Musters (das dort bereits Pensumsänderungen gegen `sollStundenTag`
verifiziert):
- Ferienwoche über einen ganztägigen Feiertag → an dem Tag keine
  vollen Stunden mehr im erzeugten TimeEntry
- Ferienwoche über einen Halbtags-Feiertag → halbe Stunden
- End-to-End-Regressionstest über `kennzahlen`: `ist`/`sollGesamt` für den
  betroffenen Monat stimmen nach dem Fix überein (vorher künstlich
  reproduzieren, dass sie es nicht tun, dann den Fix zeigen)

---

### - [ ] 3. Nachtschichten über den DST-Wechsel real statt als Wanduhrzeit rechnen

**Befund (HARDENING.md A3, 17.08.2026):** `stundenAusEintrag`
(`lib/calc.ts:178-191`) rechnet die Dauer einer `arbeit`-Schicht rein aus
den `von`/`bis`-Minutenwerten der Strings, ohne Datum oder Zeitzone. Eine
Schicht 22:00–06:00 in der Nacht auf den Frühjahrswechsel (letzter Sonntag
März) dauert real 6.5h (eine Stunde springt vor), wird aber wie an jedem
anderen Tag mit 7.5h Wanduhrzeit gutgeschrieben. Im Herbst (letzter
Sonntag Oktober) ist es umgekehrt: real 8.5h, gutgeschrieben 7.5h. Das
Verhalten ist konsistent und deterministisch, aber nicht die tatsächlich
geleistete Zeit — betrifft ausschliesslich Organisationen mit
Nachtarbeit über exakt diese zwei Nächte im Jahr.

**Vorschlag:** `Organization` um ein Zeitzone-Feld erweitern (Default
`Europe/Zurich`, da alle bisherigen Beispieldaten/Kantone Schweiz
betreffen) und `stundenAusEintrag` für Schichten, die die beiden
Umstellungsnächte überspannen, die real verstrichene Zeit statt der
Wanduhr-Differenz berechnen (z.B. über eine Zeitzonen-Bibliothek wie
`date-fns-tz`, die noch keine Abhängigkeit dieses Projekts ist — Prüfen,
ob eine neue Abhängigkeit gerechtfertigt ist, oder ob sich die zwei
Stichtage pro Jahr mit den vorhandenen Bordmitteln (`Intl.DateTimeFormat`
mit `timeZone`) ohne neue Abhängigkeit lösen lassen). Für alle anderen
Tage im Jahr muss sich am Ergebnis nichts ändern.

**Betroffene Stellen:**
- `prisma/schema.prisma`, Model `Organization` — neues Feld, Migration
- `lib/calc.ts`, Funktion `stundenAusEintrag` (aktuell Zeilen 178–191)
- Vermutlich auch `lib/compliance.ts` (`pruefeCompliance`,
  `eintragStartEnde`/`nettoArbeitsstunden` verwenden dieselbe
  Mitternacht-Logik) — prüfen, ob dieselbe Korrektur dort ebenfalls nötig
  ist oder ob die Compliance-Prüfung bewusst auf Wanduhrzeit bleiben soll
  (ArG-Ruhezeiten sind an der Wanduhr orientiert, nicht an
  UTC-Absolutzeit — das könnte ein Grund sein, es dort NICHT zu ändern;
  vor der Umsetzung klären, nicht automatisch mitziehen)

**Tests:** in `lib/calc.test.ts`, Erweiterung von
`describe("Kalenderrandfälle (HARDENING.md A3)", …)` bzw. einem neuen
Bereich:
- Schicht 22:00–06:00 in der Nacht auf den Frühjahrswechsel (29./30.03.2026)
  → 6.5h statt 7.5h
- Dieselbe Schicht in der Nacht auf den Herbstwechsel (24./25.10.2026)
  → 8.5h statt 7.5h
- Dieselbe Schicht an einem gewöhnlichen Tag → weiterhin 7.5h
  (Regressionstest)
- `pruefeCompliance` an denselben zwei Nächten — Verhalten bewusst
  dokumentieren, ob es sich ändert oder nicht

> BLOCKER-Kandidat: Diese Änderung ist die einzige der vier mit einer
> Schema-Migration. Vor der Umsetzung abklären, ob ein Zeitzone-Feld pro
> Organisation die richtige Granularität ist (nicht pro Mitglied) —
> passt zur bestehenden Prämisse, dass Feiertage/`maxWeeklyHours` bereits
> organisationsweit statt pro Person gelten.

---

### - [ ] 4. Sicherheitsrelevante Auth-Routen testen (0% Coverage)

**Befund (HARDENING.md B1, 16.08.2026):** Der Coverage-Bericht zeigte vier
sicherheitsrelevante Routen bei 0% Statement-Coverage — ausserhalb des
Fokus von B2 (das nur die dort explizit genannten Routen behandelte):

| Route | Zeilen | Warum sicherheitsrelevant |
|---|---|---|
| `app/api/signup/route.ts` | 78 | Erstregistrierung, legt Organisation + Owner an |
| `app/api/invitations/accept/route.ts` | 123 | Token-Einlösung, macht aus einem Einladungstoken ein Konto |
| `app/api/auth/forgot-password/route.ts` | 69 | löst einen Reset-Token aus |
| `app/api/auth/reset-password/route.ts` | 61 | löst einen Reset-Token EIN, setzt das Passwort |

**Vorschlag:** eigener, sorgfältiger Testpunkt statt Nebenbei-Ergänzung —
diese Routen entscheiden über Kontoübernahme und Erstzugang, ein
oberflächlicher Test wäre schlimmer als gar keiner (falsches
Sicherheitsgefühl). Mindestens folgende Fälle je Route:

- **`signup`:** doppelte E-Mail-Adresse abgelehnt; Passwortrichtlinie
  durchgesetzt (`lib/password-policy.ts`, `lib/common-passwords.ts` —
  beide aktuell ebenfalls 0%/gering getestet, hier mitprüfen); erzeugte
  Organisation ist von allen anderen isoliert (Muster aus
  `lib/api-isolation.test.ts` wiederverwenden)
- **`invitations/accept`:** abgelaufener Token abgelehnt; bereits
  eingelöster Token kann nicht zweimal verwendet werden; Token für eine
  andere/gelöschte Einladung wird abgelehnt; E-Mail-Adresse aus dem Token
  kann beim Einlösen nicht manipuliert werden (falls die Route sie aus
  dem Body statt nur aus dem Token liest — genau prüfen)
- **`forgot-password`:** liefert **dieselbe Antwort** unabhängig davon, ob
  die E-Mail-Adresse existiert (keine Enumeration real existierender
  Konten über Antwortzeit/-inhalt); erzeugt einen Token nur bei
  tatsächlich existierender Adresse; Rate-Limiting greift
  (`lib/rate-limit.ts`, ebenfalls 10% Coverage — hier mitprüfen)
- **`reset-password`:** abgelaufener Token abgelehnt; bereits verwendeter
  Token kann nicht zweimal verwendet werden; neues Passwort durchläuft
  dieselbe Richtlinie wie bei `signup`; alle bestehenden Sessions der
  betroffenen Person werden invalidiert (prüfen, ob das aktuell überhaupt
  passiert — falls nicht, das als eigenen Unterbefund festhalten, nicht
  stillschweigend mitfixen)

**Betroffene Stellen:** die vier genannten Routen unverändert lassen,
sofern die Tests keinen echten Fehler aufdecken (dies ist primär ein
Testlücken-Punkt, kein angekündigter Fix) — falls ein Test einen echten
Sicherheitsfehler aufdeckt (z.B. Enumeration über `forgot-password`),
diesen **sofort** beheben und im Commit gesondert hervorheben, nicht am
Ende der Iteration verstecken.

**Tests:** neue Datei `lib/auth-routes.test.ts`, gleiches Muster wie
`lib/invitations-limit.test.ts`/`lib/api-isolation.test.ts` (Route-Handler
direkt aufrufen, `next-auth` mocken wo nötig, echte Dev-DB).

---

## Notizen des Loops

_(Analog zu HARDENING.md: Blocker, Entscheidungen, Auffälligkeiten und
neue Vorschläge, die über diese vier Punkte hinausgehen.)_
