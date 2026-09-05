# REVIEW_LOOP – Statusdatei

Audit-Loop über die gesamte App. Diese Datei ist der Zustand zwischen den Iterationen.
Nicht manuell löschen, solange der Loop läuft.

## Baseline (Iteration 1, 2026-08-30)
- `npm run typecheck`: **sauber**, keine Fehler.
- `npm test`: **35 Test-Dateien, 460 Tests, alle grün** (Dauer ~7s).
- Regel: Der Loop ändert KEINEN Produktivcode. Nur REVIEW_LOOP.md und REVIEW_LOOP_STATE.md werden geschrieben.

## Reihenfolge
Die Batches sind **risikosortiert**, nicht alphabetisch: zuerst Rechenkern (Zeit/Pensum/Abrechnung),
dann Auth/Zugriff, dann API-Routen, dann Seiten/Komponenten, zuletzt shadcn-UI-Primitive (Fremdcode, Schnellscan).
So stehen die wichtigen Funde früh in REVIEW_LOOP.md, auch wenn der Loop vorzeitig abgebrochen wird.

## Batch-Zeiger
ABGESCHLOSSEN — alle 16 Batches erledigt, Abschlussbericht in REVIEW_LOOP.md eingefügt.

## Offene Verdachtsmomente für die nächste Iteration
**Keine offenen Punkte mehr.** Alle im Verlauf notierten Verdachtsmomente wurden abgearbeitet:
geklärt in Batch 4 (Zeitraumgrenzen, geklemmt, Feiertags-Recompute), Batch 5 (E-Mail-Änderung, clientseitige Grenzen),
Batch 6 (Mandanten-Leck ausgeschlossen, baseUrl, Session-Invalidierung), Batch 7 (Indizes, Constraints, deletedAt),
Batch 8 (Rollen-Gating der Seiten), Batch 9 (warnings, Graduierungs-Hinweis, Doppelklick-Schutz),
Batch 11 (Toast-Duplikat) und Batch 12 (set-plan-Validierung).

**Ergebnis:** 85 Funde — 1 KRITISCH, 10 HOCH, 50 MITTEL, 24 NIEDRIG.
4 frühere Einschätzungen wurden im Verlauf widerlegt bzw. entschärft und sind an den Funden vermerkt.

## Batches

### Batch 1 — ERLEDIGT (19 Funde: 3× HOCH, 9× MITTEL, 7× NIEDRIG)
1. lib/calc.ts
2. lib/arbeitszeit.ts
3. lib/billing.ts
4. lib/billing-rules.ts
5. lib/holidays.ts
6. lib/absence-entries.ts
7. lib/absence-ranges.ts
8. lib/entry-overlap.ts
9. lib/compliance.ts
10. lib/customer-months.ts

### Batch 2 — ERLEDIGT (11 Funde: 2× HOCH, 6× MITTEL, 3× NIEDRIG)
11. lib/access.ts
12. lib/auth-options.ts
13. lib/dev-access.ts
14. lib/token.ts
15. lib/password-policy.ts
16. lib/rate-limit.ts
17. lib/audit.ts
18. lib/error-log.ts
19. lib/db.ts
20. middleware.ts

### Batch 3 — ERLEDIGT (16 Funde: 1× HOCH, 12× MITTEL, 3× NIEDRIG)
21. lib/import-timesheet.ts
22. lib/export-helpers.ts
23. lib/org-export.ts
24. lib/dev-actions.ts
25. lib/dev-metrics.ts
26. lib/project-visibility.ts
27. lib/mail.ts
28. lib/types.ts
29. lib/utils.ts
30. lib/i18n.tsx

### Batch 4 — ERLEDIGT (11 Funde: 2× HOCH, 7× MITTEL, 2× NIEDRIG)
31. app/api/time-entries/route.ts
32. app/api/time-entries/bulk-apply/route.ts
33. app/api/time-entries/bulk-vacation/route.ts
34. app/api/month-locks/route.ts
35. app/api/pensum-changes/route.ts
36. app/api/overtime-payouts/route.ts
37. app/api/absence-requests/route.ts
38. app/api/absences/calendar/route.ts
39. app/api/holidays/route.ts
40. app/api/customer-months/route.ts

### Batch 5 — ERLEDIGT (11 Funde: 1× KRITISCH, 2× HOCH, 6× MITTEL, 2× NIEDRIG)
41. app/api/admin/organization/route.ts
42. app/api/admin/organization/export/route.ts
43. app/api/admin/team/route.ts
44. app/api/team/route.ts
45. app/api/projects/route.ts
46. app/api/customers/route.ts
47. app/api/profile/route.ts
48. app/api/invitations/route.ts
49. app/api/invitations/accept/route.ts
50. app/api/signup/route.ts

### Batch 6 — ERLEDIGT (4 Funde: 3× MITTEL, 1× NIEDRIG; sauberster Batch. Zusätzlich 1 Korrektur an Batch 3 und 1 Annotation an Batch 2.)
51. app/api/auth/[...nextauth]/route.ts
52. app/api/auth/forgot-password/route.ts
53. app/api/auth/reset-password/route.ts
54. app/api/dev/orgs/[slug]/plan/route.ts
55. app/api/dev/orgs/[slug]/trial/route.ts
56. app/api/dev/users/[id]/reset-link/route.ts
57. app/api/health/route.ts
58. app/api/analytics/route.ts
59. app/api/import/timesheet/route.ts
60. app/api/export/route.ts

### Batch 7 — ERLEDIGT (4 Funde: 3× MITTEL, 1× NIEDRIG; zusätzlich Verschärfung des KRITISCH-Funds und Entschärfung eines Batch-2-Funds)
61. app/api/export/arg-control/route.ts
62. app/api/export/payroll/route.ts
63. app/api/export/stundenrapport/route.ts
64. prisma/schema.prisma
65. app/layout.tsx
66. app/page.tsx
67. app/(app)/layout.tsx
68. app/(app)/calendar/page.tsx
69. app/(app)/absences/page.tsx
70. app/(app)/analytics/page.tsx

### Batch 8 — ERLEDIGT (3 Funde: 2× MITTEL, 1× NIEDRIG; zusätzlich 1 KORREKTUR an Batch 2 und 1 Einordnung zu Batch 5)
71. app/(app)/team/page.tsx
72. app/(app)/admin/holidays/page.tsx
73. app/(app)/admin/legal/page.tsx
74. app/(app)/admin/team/page.tsx
75. app/(app)/profile/page.tsx
76. app/(app)/set-password/page.tsx
77. app/(auth)/login/page.tsx
78. app/(auth)/register/page.tsx
79. app/(auth)/invite/page.tsx
80. app/(auth)/forgot-password/page.tsx

### Batch 9 — ERLEDIGT (1 Fund: 1× NIEDRIG; 5 Positivbefunde, 2 KORREKTUREN an Batch 4)
81. app/(auth)/reset-password/page.tsx
82. app/(dev)/dev/page.tsx
83. app/(dev)/dev/orgs/[slug]/page.tsx
84. app/(dev)/layout.tsx
85. components/day-entry-dialog.tsx
86. components/absence-year-overview.tsx
87. components/analytics-charts.tsx
88. components/customer-month-card.tsx
89. components/pensum-preview.tsx
90. components/project-month-summary.tsx

### Batch 10 — ERLEDIGT (1 Fund: 1× NIEDRIG; Batch durchweg sauber)
91. components/providers.tsx
92. components/theme-provider.tsx
93. components/theme-toggle.tsx
94. components/dev/org-plan-actions.tsx
95. components/dev/reset-link-button.tsx
96. components/dev/stat-tile.tsx
97. components/dev/status-dot.tsx
98. components/dev/weekly-bars.tsx
99. components/layouts/app-shell.tsx
100. components/layouts/auth-layout.tsx

### Batch 11 — ERLEDIGT (2 Funde: 1× MITTEL, 1× NIEDRIG)
101. components/layouts/container.tsx
102. components/layouts/page-header.tsx
103. components/layouts/section.tsx
104. components/ui/date-range-picker.tsx
105. components/ui/month-year-picker.tsx
106. components/ui/task-card.tsx
107. components/ui/animate.tsx
108. components/ui/use-toast.ts
109. hooks/use-toast.ts
110. components/ui/toast.tsx

### Batch 12 — ERLEDIGT (2 Funde: 2× MITTEL; letzter offener Punkt aus Batch 1 geklärt)
111. components/ui/toaster.tsx
112. scripts/safe-seed.ts
113. scripts/seed.ts
114. scripts/seed-demo-team.ts
115. scripts/loadtest-seed.ts
116. scripts/set-plan.ts
117. components/ui/accordion.tsx
118. components/ui/alert-dialog.tsx
119. components/ui/alert.tsx
120. components/ui/aspect-ratio.tsx

### Batch 13 — ERLEDIGT (shadcn-Primitive, keine Funde)
121. components/ui/avatar.tsx
122. components/ui/badge.tsx
123. components/ui/breadcrumb.tsx
124. components/ui/button.tsx
125. components/ui/calendar.tsx
126. components/ui/card.tsx
127. components/ui/carousel.tsx
128. components/ui/checkbox.tsx
129. components/ui/collapsible.tsx
130. components/ui/command.tsx

### Batch 14 — ERLEDIGT (shadcn-Primitive, keine Funde)
131. components/ui/context-menu.tsx
132. components/ui/dialog.tsx
133. components/ui/drawer.tsx
134. components/ui/dropdown-menu.tsx
135. components/ui/form.tsx
136. components/ui/hover-card.tsx
137. components/ui/input-otp.tsx
138. components/ui/input.tsx
139. components/ui/label.tsx
140. components/ui/menubar.tsx

### Batch 15 — ERLEDIGT (shadcn-Primitive, keine Funde)
141. components/ui/navigation-menu.tsx
142. components/ui/pagination.tsx
143. components/ui/popover.tsx
144. components/ui/progress.tsx
145. components/ui/radio-group.tsx
146. components/ui/resizable.tsx
147. components/ui/scroll-area.tsx
148. components/ui/select.tsx
149. components/ui/separator.tsx
150. components/ui/sheet.tsx

### Batch 16 — ERLEDIGT (shadcn-Primitive, keine Funde)
151. components/ui/skeleton.tsx
152. components/ui/slider.tsx
153. components/ui/sonner.tsx
154. components/ui/switch.tsx
155. components/ui/table.tsx
156. components/ui/tabs.tsx
157. components/ui/textarea.tsx
158. components/ui/toggle-group.tsx
159. components/ui/toggle.tsx
160. components/ui/tooltip.tsx

### Batch 17 — ERLEDIGT (Abschluss: Prioritätenliste, Querschnittsmuster, Gesamteinschätzung)
161. lib/common-passwords.ts
162. lib/download-blob.ts
