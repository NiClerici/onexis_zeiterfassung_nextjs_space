# AUDIT.md — Code-Audit-Loop

Findet Bugs, Fehler und Verbesserungsvorschläge in der Zeiterfassungs-App.
Dieser Loop **fixt nichts** — reine Bestandsaufnahme. Jeder Bereich wird
einmal gründlich gelesen (nicht nur gegrept), Funde werden hier dokumentiert.

## Bereiche

- [ ] lib/ (Kernlogik: calc.ts, billing.ts, absence-*, compliance.ts, access.ts, holidays.ts, arbeitszeit.ts, ...)
- [ ] app/api/ (alle Route-Handler — Auth/Autorisierung, Validierung)
- [ ] app/(app)/ (Seiten: absences, admin, analytics, calendar, profile, team)
- [ ] app/(auth)/ (login, register, forgot-password, reset-password, invite)
- [ ] components/
- [ ] hooks/ + middleware.ts
- [ ] prisma/schema.prisma + Migrations
- [ ] scripts/ (seed/import scripts)

---
