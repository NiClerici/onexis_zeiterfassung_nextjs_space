# VERIFY_LOOP – Statusdatei

## Zeiger
ABGESCHLOSSEN — 19/19 bestätigt, keiner widerlegt.

## Sicherheitsregeln (gelten für jede Iteration)
1. Bestehende DB-Inhalte NUR lesen.
2. Schreibende Tests ausschliesslich in einer Wegwerf-Organisation (Slug-Präfix `zzz-verify-`), die im selben Lauf wieder entfernt wird.
3. Kein Produktivcode ändern. Geschrieben wird nur in `verification/` und `VERIFY_*.md`.

## Erledigt
- **V1 — KRITISCH Kaskade:** BESTÄTIGT (lesend an der echten DB; 36 CustomerMonth, 3 Projekte, 183 Einträge betroffen).
- **V2 — Rechenkern:** 7 Funde BESTÄTIGT, 11/11 Tests grün (`verification/01-rechenkern.verify.ts`).

- **V3 — Graduierung:** BESTÄTIGT (102.8 -> 110.8 Kundenstunden, ist 0 -> 8). Numerisch exakt wie im Audit vorhergesagt.
- **V4 — Routen:** BESTÄTIGT. pensum=-100 wird gespeichert (Soll -184.8h, +184.8 erfundene Überstunden); startDate frei setzbar; DELETE /api/customers gibt 200 für 'member', Kaskade end-to-end nachgewiesen.
  - Hinweis: eine Zusicherung von MIR war zunächst falsch (nicht der Code) — korrigiert und vermerkt.

## Offen
- **V5 — Import:** 5/5 BESTÄTIGT (echte xlsx über Puffer round-getrippt).
- **V6 — Kennzahlen:** BESTÄTIGT. Verrechnungsgrad 204% (Audit schätzte 147% — real also deutlicher). Null-Korrektur verpufft.
- **V7 — Browser:** BESTÄTIGT (beide Funde). Fünf Anläufe nötig, alle Fehlschläge auf meiner Seite (Hydration, Locator-Kosten, falscher Icon-Klassenname).
- **Aufräumen verifiziert:** 0 Wegwerf-Orgs, Echtdaten unverändert (2/3/36/183).
- Dev-Server gestoppt.
