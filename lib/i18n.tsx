"use client";

import React, { createContext, useContext, useCallback } from "react";

const translations: Record<string, string> = {
  // Nav
  "nav.calendar": "Kalender",
  "nav.analytics": "Analytics",
  "nav.profile": "Profil",
  "nav.team": "Team",
  "nav.teamsicht": "Teamsicht",
  "nav.holidays": "Feiertage",
  "nav.absences": "Absenzen",
  "nav.legal": "Rechtliches",
  // Login
  "login.title": "Anmelden",
  "login.email": "E-Mail",
  "login.emailPlaceholder": "name@firma.ch",
  "login.password": "Passwort",
  "login.submit": "Anmelden",
  "login.forgotPassword": "Passwort vergessen?",
  "login.noAccount": "Noch kein Konto?",
  "login.register": "Registrieren",
  "login.error": "Ungültige E-Mail oder ungültiges Passwort. Bei zu vielen Fehlversuchen ist das Konto vorübergehend gesperrt.",
  // Register
  "register.title": "Registrieren",
  "register.firstName": "Vorname",
  "register.lastName": "Nachname",
  "register.companyName": "Firmenname",
  "register.email": "E-Mail",
  "register.password": "Passwort",
  "register.confirmPassword": "Passwort bestätigen",
  "register.passwordHint": "Mindestens 10 Zeichen, kein häufig verwendetes Passwort.",
  "register.weeklyHours": "Wochenstunden (bei 100%)",
  "register.pensum": "Pensum (%)",
  "register.vacationDays": "Ferientage (bei 100%)",
  "register.startDate": "Startdatum",
  "register.submit": "Registrieren",
  "register.hasAccount": "Bereits registriert?",
  "register.login": "Anmelden",
  "register.note": "Diese Angaben kannst du später in deinem Profil noch bearbeiten.",
  "register.error.passwordMismatch": "Passwörter stimmen nicht überein",
  "register.error.passwordFormat": "Passwort muss mindestens 10 Zeichen haben",
  "register.error.required": "Pflichtfeld",
  "register.optional": "Optional",
  // Forgot password
  "forgot.title": "Passwort vergessen",
  "forgot.description": "Gib deine E-Mail-Adresse ein. Falls ein Konto damit existiert, schicken wir dir einen Link zum Zurücksetzen.",
  "forgot.email": "E-Mail",
  "forgot.submit": "Link anfordern",
  "forgot.sent": "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen verschickt. Der Link ist 60 Minuten gültig.",
  "forgot.backToLogin": "Zurück zum Login",
  // Reset password (Link aus der E-Mail)
  "reset.title": "Neues Passwort setzen",
  "reset.newPassword": "Neues Passwort",
  "reset.submit": "Passwort setzen",
  "reset.success": "Passwort erfolgreich gesetzt! Du kannst dich jetzt anmelden.",
  "reset.error.noToken": "Ungültiger oder fehlender Link. Bitte fordere einen neuen Link an.",
  // Invitation (Link aus der E-Mail)
  "invite.title": "Einladung annehmen",
  "invite.description": "Du wurdest zu {org} eingeladen (Rolle: {role}).",
  "invite.submit": "Konto erstellen und beitreten",
  "invite.acceptExisting": "Organisation beitreten",
  "invite.success": "Willkommen! Dein Konto wurde erstellt.",
  "invite.successExisting": "Du bist der Organisation beigetreten. Melde dich mit deinem bestehenden Passwort an.",
  "invite.accountExistsHint": "Für diese E-Mail existiert bereits ein Konto — melde dich danach mit deinem bestehenden Passwort an.",
  "invite.error.invalid": "Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.",
  // Set password (erzwungen nach Migration von Vorname+Code auf E-Mail+Passwort)
  "setPassword.title": "Neues Passwort erforderlich",
  "setPassword.description": "Aus Sicherheitsgründen wurde die Anmeldung auf E-Mail und Passwort umgestellt. Bitte setze ein neues Passwort, um fortzufahren.",
  "setPassword.currentPassword": "Bisheriges Passwort / bisheriger Code",
  "setPassword.submit": "Passwort setzen und fortfahren",
  "setPassword.success": "Passwort gesetzt!",
  // Calendar
  "calendar.greeting": "Hallo, {name}",
  "calendar.today": "Heute",
  "calendar.hours": "Stunden",
  "calendar.type": "Typ",
  "calendar.type.arbeit": "Arbeitszeit",
  "calendar.type.ferien": "Ferien",
  "calendar.type.krank": "Krank",
  "calendar.type.feiertag": "Feiertag",
  "calendar.type.militaer": "Militär",
  "calendar.type.unbezahlt": "Unbezahlt",
  "calendar.save": "Speichern",
  "calendar.cancel": "Abbrechen",
  "calendar.delete": "Löschen",
  "calendar.von": "Von",
  "calendar.bis": "Bis",
  // Kurz gehalten, damit das Label in der 3-spaltigen Von/Bis/Pause-Zeile
  // (components/day-entry-dialog.tsx) nicht zweizeilig umbricht und dadurch
  // gegenüber den Von/Bis-Labels nach unten verrutscht — die Netto-Zeile
  // direkt darunter (calendar.netHoursVonBis) zeigt "X Min. Pause" ohnehin
  // schon explizit als Abzug, das war der eigentliche Zweck des Zusatzes.
  "calendar.pause": "Pause (Min.)",
  "calendar.notiz": "Notiz",
  "calendar.notizPlaceholder": "Optionale Notiz",
  "calendar.tasks": "Tasks",
  "calendar.tasksPlaceholder": "Was wurde am Projekt gemacht?",
  "calendar.countsAsWorktimeHint": "Nur Projektzeit aus dem Import — zählt erst zur Arbeitszeit, sobald diese Zeile hier gespeichert wird.",
  "calendar.customer": "Kunde",
  "calendar.customerNone": "Kein Kunde",
  "calendar.project": "Projekt",
  "calendar.projectNone": "Kein Projekt",
  "calendar.addEntry": "Eintrag hinzufügen",
  "calendar.noEntriesForDay": "Keine Einträge für diesen Tag",
  "calendar.entryHours": "Stunden für diesen Eintrag",
  "calendar.modeVonBis": "Von/Bis",
  "calendar.modeHours": "Stunden direkt",
  "calendar.hoursDirectHint": "Von/Bis werden automatisch daraus abgeleitet (Start bei der bisherigen Von-Zeit, Pause nach ArG ab 5.5h, sofern nicht manuell gesetzt).",
  // Netto-Anzeige unter beiden Erfassungsmodi (Bugfix: unklar, ob die Pause
  // von der Zeit abgezogen wird) — {von}/{bis} und {pause}/{hours} kommen aus
  // stundenAusEintrag() (lib/calc.ts), derselben Funktion, die auch die
  // Monatssumme berechnet, damit die Anzeige nie von der echten Summe abweicht.
  "calendar.netHoursVonBis": "{von}–{bis} − {pause} Min. Pause = {hours} h",
  "calendar.netHoursMode": "{hours} h netto + {pause} Min. Pause → {von}–{bis}",
  "calendar.pauseExceedsSpan": "Die Pause ist länger als die eingetragene Zeitspanne.",
  "calendar.timeClamped": "Das Ende wurde auf 23:59 begrenzt.",
  // Konflikt-Warnungen (Bugfix: zweimal dieselbe Zeit am selben Tag war
  // speicherbar) — dieselben Meldungstexte wie lib/entry-overlap.ts, aber
  // hier als Live-Hinweis im Dialog, bevor überhaupt gespeichert wird.
  // Überschrift über den Konflikt-Meldungen einer Zeile — der eigentliche
  // Text kommt aus lib/entry-overlap.ts (pruefeEintragKonflikte), das schon
  // die konkrete Uhrzeit des kollidierenden Eintrags nennt.
  "calendar.conflictBlocking": "Speichern gesperrt:",
  "calendar.conflictWarning": "Hinweis:",
  "calendar.complianceTitle": "Hinweise zur Arbeitszeit",
  "calendar.entrySaved": "Eintrag gespeichert",
  "calendar.entryDeleted": "Eintrag gelöscht",
  "calendar.entryError": "Fehler beim Speichern des Eintrags",
  "calendar.noEntries": "Keine Einträge",
  "calendar.deleteConfirm": "Wirklich löschen?",
  "calendar.selectMonth": "Monat wählen",
  "calendar.workSummary": "Arbeitsstunden",
  "calendar.exportCustomer": "Kundenrapport",
  "calendar.exportError": "Export fehlgeschlagen.",
  "calendar.unbilledHours": "{hours}h nicht verrechnet",
  // Zeilentitel für die CustomerMonth-Migrationszeile innerhalb einer
  // Kundengruppe (app/(app)/calendar/page.tsx projectSummary) — additiv zu
  // den Tageseinträgen desselben Kunden, gleiche Kombination wie Analytics/
  // Teamsicht/Export (lib/customer-months.ts combineCustomerHours()).
  "calendar.migrationHoursRow": "Aus Migration",
  // Kundenstunden im Kalender (CustomerMonth, Betrieb.md-Nachtrag) — Block
  // existierte vor dem Vision-Ausbau schon einmal (damals auf dem
  // inzwischen ersetzten CustomerHour-Modell), Keys hier neu vergeben statt
  // der damaligen wiederverwendet, weil die Erfassung jetzt monatsweise
  // über Kunde+optionales Projekt läuft statt als reine Textzeile.
  "calendar.customerHours": "Kundenstunden",
  "calendar.addCustomer": "Kunde hinzufügen",
  "calendar.editCustomer": "Bearbeiten",
  "calendar.deleteCustomer": "Löschen",
  "calendar.customerHoursNoCustomers": "Noch keine Kunden angelegt. Kunden können im Profil unter \"Kundenverwaltung\" erstellt werden.",
  "calendar.customerHoursSelectCustomer": "Kunde wählen",
  "calendar.customerHoursSelectProject": "— kein Projekt —",
  "calendar.customerHoursHoursLabel": "Stunden",
  "calendar.customerHoursDuplicate": "Für diese Kombination aus Kunde und Projekt existiert in diesem Monat bereits ein Eintrag — bitte diesen bearbeiten statt einen neuen anzulegen.",
  "calendar.customerHoursSaved": "Kundenstunden gespeichert",
  "calendar.customerHoursDeleted": "Eintrag gelöscht",
  "calendar.customerHoursError": "Fehler beim Speichern der Kundenstunden",
  // Monatsabschluss (MIGRATION.md Punkt 6e)
  "calendar.monthLocked": "Dieser Monat ist abgeschlossen und schreibgeschützt. Bei Korrekturbedarf wende dich an eine admin-berechtigte Person.",
  // Weekdays
  "weekday.mo": "Mo",
  "weekday.tu": "Di",
  "weekday.we": "Mi",
  "weekday.th": "Do",
  "weekday.fr": "Fr",
  "weekday.sa": "Sa",
  "weekday.su": "So",
  // Months
  "month.1": "Januar",
  "month.2": "Februar",
  "month.3": "März",
  "month.4": "April",
  "month.5": "Mai",
  "month.6": "Juni",
  "month.7": "Juli",
  "month.8": "August",
  "month.9": "September",
  "month.10": "Oktober",
  "month.11": "November",
  "month.12": "Dezember",
  // Analytics
  "analytics.title": "Analytics",
  "analytics.period": "Zeitraum",
  "analytics.month": "Monat",
  "analytics.quarter": "Quartal",
  "analytics.year": "Jahr",
  "analytics.custom": "Frei wählen",
  "analytics.targetHours": "Sollarbeitszeit",
  // Sollarbeitszeit ist bewusst der Wert BIS HEUTE (kennzahlen() rechnet
  // bisHeute = min(to, heute), lib/calc.ts) — bei laufender Periode zeigt die
  // Arbeitszeit-Karte darunter zusätzlich das Soll des ganzen Zeitraums
  // (sollGesamt, ofFullTarget).
  "analytics.ofFullTarget": "{hours}h im ganzen Zeitraum",
  "analytics.actualHours": "Geleistete Stunden",
  "analytics.difference": "Differenz",
  "analytics.billingRate": "Verrechnungsgrad",
  // Basis unter der Verrechnungsgrad-Kachel: Nenner ist die reine Arbeitszeit,
  // nicht Ferien/Feiertage/Krank/Militär/Unbezahlt (Betrieb.md-Nachtrag,
  // 21.08.2026).
  "analytics.billingRateBasis": "{customer}h von {work}h Arbeitszeit",
  "analytics.customerHours": "Kundenstunden",
  // Aufschlüsselung, wenn ein Teil von customerHours aus der CustomerMonth-
  // Migration stammt (additiv zu den Tageseinträgen, lib/customer-months.ts
  // combineCustomerHours()) — nicht zusätzlich, sondern bereits enthalten.
  "analytics.customerHoursFromMigration": "{hours}h davon aus Migration",
  "analytics.workHours": "Arbeitsstunden",
  "analytics.vacationDays": "Ferientage",
  "analytics.holidays": "Feiertage",
  "analytics.overview": "Übersicht",
  "analytics.monthlyTrend": "Monatlicher Verlauf",
  "analytics.from": "Von",
  "analytics.to": "Bis",
  "analytics.h": "h",
  "analytics.noData": "Keine Daten für diesen Zeitraum",
  // Überzeit (Art. 12/13 ArG, gesetzliches Wochenlimit) — eigener Begriff,
  // getrennt von Überstunden (MIGRATION.md Punkt 6a).
  "analytics.weeklyOvertime": "Überzeit",
  "analytics.weeklyOvertimeHint": "Stunden über der gesetzlichen Höchstarbeitszeit (Art. 12/13 ArG), pro Kalenderwoche berechnet.",
  "analytics.vacationBalance": "Feriensaldo",
  "analytics.totalVacation": "Total Ferientage",
  "analytics.usedVacation": "Bezogen",
  "analytics.remainingVacation": "Restlich",
  "analytics.stillToPlan": "Noch zu planen",
  "analytics.plannedVacation": "Geplant",
  "analytics.totalEntitlement": "Gesamtanspruch",
  "analytics.fullTargetHours": "Sollstunden (gesamt)",
  // Overtime payouts
  "profile.overtimePayouts": "Überstunden-Auszahlungen",
  "profile.overtimePayoutsDesc": "Hier kannst du ausbezahlte Überstunden erfassen. Diese werden vom Überstundensaldo abgezogen.",
  "profile.payoutDate": "Datum der Auszahlung",
  "profile.payoutHours": "Ausbezahlte Stunden",
  "profile.payoutNote": "Notiz (optional)",
  "profile.payoutNotePlaceholder": "z.B. Auszahlung Q4 2026",
  "profile.addPayout": "Auszahlung erfassen",
  "profile.noPayouts": "Keine Auszahlungen erfasst",
  "profile.payoutSaved": "Auszahlung erfasst!",
  // Überstunden-Hero: eine dominante Zahl (kumulierter Nettosaldo seit Eintritt)
  // plus Badge für den gewählten Zeitraum. Löst die frühere 4-Felder-Matrix ab —
  // die vierte Zahl (Prognose nur für den Zeitraum) entfällt bewusst, sie stand
  // gleichgewichtig neben drei anderen und wurde dadurch nicht gelesen.
  "analytics.overtimeHeroTotal": "Überstunden gesamt seit {date}",
  // Fallback, wenn der gewählte Zeitraum die ganze Historie abdeckt und die API
  // deshalb kein cumulative liefert — dann ist die Hero-Zahl der Zeitraumwert.
  "analytics.overtimeHeroPeriod": "Überstunden {label}",
  // Akkusativ für den Badge ("+28.9h diesen Monat"), getrennt von den
  // Nominativ-Labels colPeriodMonth/colPeriodRange, die die Auszahlungszeile
  // beschriften.
  "analytics.badgePeriodMonth": "diesen Monat",
  "analytics.badgePeriodRange": "im Zeitraum",
  "analytics.forecastFoot": "Prognose per {date}: {hours} · geplant: {planned}h",
  "analytics.colPeriodMonth": "dieser Monat",
  "analytics.colPeriodRange": "gewählter Zeitraum",
  "analytics.payoutsFootTotal": "Auszahlungen gesamt: {hours} h",
  "analytics.payoutsFootPeriod": "davon {label}: {hours} h",
  // Arbeitszeit-Karte: Ist/Soll mit Fortschrittsbalken statt zwei getrennter
  // Kacheln (Sollarbeitszeit + Geleistete Stunden).
  "analytics.workTime": "Arbeitszeit",
  "analytics.workTargetMet": "Soll erreicht, {hours}h darüber",
  "analytics.workTargetShort": "noch {hours}h bis Soll",
  "analytics.vacationToPlan": "Ferien noch zu planen",
  // Profile
  "profile.title": "Profil",
  "profile.personalInfo": "Persönliche Daten",
  "profile.workSettings": "Arbeitseinstellungen",
  "profile.kuerzel": "Kürzel",
  "profile.kuerzelPlaceholder": "z.B. CLN",
  "profile.security": "Sicherheit",
  "profile.save": "Speichern",
  "profile.saved": "Gespeichert!",
  "profile.changePassword": "Passwort ändern",
  "profile.currentPassword": "Aktuelles Passwort",
  "profile.newPassword": "Neues Passwort",
  "profile.export": "Meine Stunden (Excel)",
  "profile.exportMonth": "Monat",
  "profile.exportYear": "Jahr",
  "profile.exportCustom": "Zeitraum",
  "profile.exportButton": "Exportieren",
  "profile.import": "Alte Zeiterfassung importieren",
  "profile.importHint": "Excel-Datei aus einem früheren System (Blatt \"Tageszeiten\": Datum, Stunden, Typ; optional Blatt \"Kundenstunden\": Jahr, Monat, Kunde, Stunden). Import gilt nur für dein eigenes Konto.",
  "profile.importChooseFile": "Datei auswählen",
  "profile.importPreview": "Vorschau",
  "profile.importPreviewCount": "{imported} von {total} Einträgen können importiert werden.",
  "profile.importCustomerMonthCount": "{imported} von {total} Kundenmonaten können importiert werden.",
  "profile.importSkippedExisting": "{count} übersprungen — an diesen Tagen sind bereits Einträge vorhanden.",
  "profile.importSkippedLocked": "{count} übersprungen — liegen in einem abgeschlossenen Monat.",
  "profile.importErrors": "{count} Zeilen mit Fehlern",
  "profile.importCommit": "{count} Einträge importieren",
  "profile.importDone": "{count} Einträge importiert.",
  "profile.importFileError": "Datei konnte nicht gelesen werden.",
  "profile.logout": "Abmelden",
  "profile.error": "Fehler beim Speichern",
  "profile.pensumChange": "Pensumsänderung",
  "profile.pensumChangeDesc": "Neues Pensum ab einem bestimmten Datum festlegen. Die Wochenstunden immer als Vollzeit-Basis (100%) eintragen — das Pensum reduziert automatisch.",
  "profile.effectiveFrom": "Gültig ab",
  "profile.newPensum": "Neues Pensum (%)",
  "profile.newWeeklyHours": "Neue Wochenstunden (bei 100%)",
  "profile.pensumPreview": "Ergibt {daily} h/Tag · {weekly} h/Woche effektiv",
  "profile.weeklyHoursHint": "Vollzeit-Basis eintragen, nicht die bereits reduzierten Stunden.",
  "profile.addPensumChange": "Pensumsänderung speichern",
  "profile.pensumHistory": "Pensum-Verlauf",
  "profile.noPensumChanges": "Keine Pensumsänderungen erfasst",
  "profile.customers": "Kundenverwaltung",
  "profile.customersDesc": "Kunden anlegen und umbenennen. Im Kalender kannst du Arbeitszeit-Einträgen einen Kunden zuordnen.",
  "profile.customerNamePlaceholder": "Kundenname",
  "profile.addCustomer": "Kunde hinzufügen",
  "profile.noCustomers": "Keine Kunden erfasst",
  "profile.customerSaved": "Kunde gespeichert",
  "profile.customerDeleted": "Kunde gelöscht",
  "profile.customerError": "Fehler beim Speichern des Kunden",
  "profile.hourlyRate": "CHF/h",
  // Erweiterter Export (MIGRATION.md Punkt 7)
  "profile.exportScopeSelf": "Eigene Daten",
  "profile.exportScopePerson": "Mitarbeiter/in wählen",
  "profile.exportScopeOrg": "Ganze Organisation",
  "profile.exportSelectPerson": "Person wählen",
  "profile.exportArgControl": "ArG-Kontrollexport",
  "profile.exportArgControlHint": "Prüffähige Tabelle nach Art. 73 ArGV 1: Beginn/Ende der Arbeitszeit, Pausen, Wochenarbeitszeit, Überzeit, Ruhetage, Nacht-/Sonntagsarbeit.",
  "profile.exportPayroll": "Lohnexport",
  "profile.exportPayrollDesc": "CSV mit Stunden, Absenzen und Überstunden pro Person für einen Monat — zur Übernahme in dein Lohnprogramm.",
  "profile.exportPayrollButton": "Lohnexport (CSV) herunterladen",
  // Projektverwaltung (MIGRATION.md Punkt 5)
  "profile.projects": "Projektverwaltung",
  "profile.projectsDesc": "Projekte je Kunde anlegen, mit Stundensatz und Budget. Im Kalender kannst du Arbeitszeit-Einträgen ein Projekt zuordnen.",
  "profile.selectCustomer": "Kunde wählen",
  "profile.projectNamePlaceholder": "Projektname",
  "profile.budgetHours": "Budget (h)",
  "profile.projectExternalRef": "SAP-/Auftrags-Nr.",
  "profile.addProject": "Projekt hinzufügen",
  "profile.active": "Aktiv",
  "profile.noProjects": "Keine Projekte erfasst",
  "profile.projectSaved": "Projekt gespeichert",
  "profile.projectDeleted": "Projekt gelöscht",
  "profile.projectError": "Fehler beim Speichern des Projekts",
  // Kundenstunden monatlich (statt am Tageseintrag)
  "profile.customerMonth": "Kundenstunden",
  "profile.customerMonthDesc": "Diese Monatserfassung ist für migrierte Altmonate gedacht. Läuft der Monat schon im Kalender pro Tag mit, gilt dort die Kundenzuordnung — hier eingetragene Stunden für denselben Monat werden dann nicht mitgezählt. Bei Kunden mit mindestens einem Projekt kannst du die Stunden über \"Auf Projekte aufteilen\" aufsplitten.",
  "profile.customerMonthSplit": "Auf Projekte aufteilen",
  "profile.customerMonthCollapse": "Zuklappen",
  "profile.customerMonthSave": "Monat speichern",
  "profile.customerMonthSaved": "Kundenstunden gespeichert",
  "profile.customerMonthError": "Fehler beim Speichern der Kundenstunden",
  "profile.customerMonthEntered": "{hours}h Kunden zugeordnet",
  "profile.customerMonthWorked": "{hours}h Arbeitszeit erfasst",
  "profile.retroactiveWarning": "Bei rückwirkender Pensumsänderungen müssen die eingegebenen Zeiten (z.B. Ferientage) ab diesem Datum manuell nachkontrolliert werden.",
  // Team-Verwaltung (/admin/team)
  "team.invite": "Mitglied einladen",
  "team.inviteSubmit": "Einladen",
  "team.inviteSent": "Einladung verschickt",
  "team.inviteRevoked": "Einladung widerrufen",
  "team.inviteRegenerate": "Link neu erzeugen",
  "team.inviteLinkTitle": "Einladungslink für {email}",
  "team.inviteLinkDescription": "7 Tage gültig, kann nur einmal verwendet werden. Behandle diesen Link wie ein Passwort — wer ihn hat, kann der Organisation beitreten.",
  "team.inviteLinkCopy": "Kopieren",
  "team.inviteLinkCopied": "Kopiert",
  "team.inviteLinkClose": "Schliessen",
  "team.members": "Mitglieder",
  "team.you": "du",
  "team.role": "Rolle",
  "team.status": "Status",
  "team.statusActive": "aktiv",
  "team.statusInactive": "inaktiv",
  "team.manager": "Vorgesetzte Person",
  "team.noManager": "Keine",
  "team.entryDate": "Eintrittsdatum",
  "team.exitDate": "Austrittsdatum",
  // Monatsabschluss (MIGRATION.md Punkt 6e)
  "team.monthLock": "Monatsabschluss",
  "team.monthLockYear": "Jahr",
  "team.monthLockMonth": "Monat",
  "team.monthLockSubmit": "Sperren",
  "team.monthUnlock": "Entsperren",
  "team.noMonthLocks": "Keine gesperrten Monate",
  "team.monthLocked": "Monat gesperrt",
  "team.monthUnlocked": "Monat entsperrt",
  // Standard-Wochenplan
  "profile.standardWeek": "Standard-Wochenplan",
  "profile.standardWeekDesc": "Hinterlege hier deine typische Arbeitswoche (Stunden pro Wochentag). Du kannst sie danach im Kalender auf beliebige Zeiträume anwenden.",
  "profile.stdWeekSum": "Wochentotal",
  "profile.stdWeekSave": "Standard-Wochenplan speichern",
  "profile.stdWeekSaved": "Standard-Wochenplan gespeichert!",
  "calendar.applyStdWeek": "Standardwoche anwenden",
  "calendar.applyStdWeekTitle": "Standardwoche auf Zeitraum anwenden",
  "calendar.applyStdWeekDesc": "Dein hinterlegter Standard-Wochenplan wird auf alle Tage im gewählten Zeitraum angewendet.",
  "calendar.applyFrom": "Von",
  "calendar.applyTo": "Bis",
  "calendar.applyOverwrite": "Bestehende Arbeitszeit-Einträge überschreiben",
  "calendar.applyOverwriteHint": "Ferien und Feiertage werden nie überschrieben.",
  "calendar.applyNoTemplate": "Kein Standard-Wochenplan hinterlegt. Bitte zuerst im Profil einen Standard-Wochenplan definieren.",
  "calendar.applyGoToProfile": "Zum Profil",
  "calendar.applySubmit": "Anwenden",
  "calendar.applyResult": "{created} erstellt · {updated} aktualisiert · {skipped} übersprungen",
  "calendar.applyError": "Fehler beim Anwenden",
  "calendar.applyPreview": "Vorschau",
  "calendar.applyPreviewText": "{days} Tage im Zeitraum · {workDays} Tage mit Stunden",
  "calendar.bulkVacation": "Ferien eintragen",
  "calendar.bulkVacationTitle": "Ferien für Zeitraum eintragen",
  "calendar.bulkVacationDesc": "Erstellt Ferieneinträge für alle Werktage (Mo–Fr) im gewählten Zeitraum. Wochenenden werden automatisch übersprungen.",
  "calendar.vacPreviewTitle": "Vorschau",
  "calendar.vacPreviewText": "{totalDays} Tage im Zeitraum · {workDays} Ferientage (Werktage)",
  "calendar.vacOverwrite": "Bestehende Arbeitszeit-Einträge überschreiben",
  "calendar.vacOverwriteHint": "Bestehende Feiertage werden nie überschrieben.",
  "calendar.vacSubmit": "Ferien eintragen",
  "calendar.vacResult": "{created} erstellt · {updated} aktualisiert · {skipped} übersprungen",
  "calendar.vacError": "Fehler beim Eintragen der Ferien",
  // Teamsicht (MIGRATION.md Punkt 8)
  "teamsicht.title": "Teamsicht",
  "teamsicht.tableTitle": "Mitarbeitende",
  "teamsicht.filterPlaceholder": "Name suchen...",
  "teamsicht.exportButton": "Excel-Export",
  "teamsicht.colName": "Name",
  "teamsicht.colPensum": "Pensum",
  "teamsicht.colSoll": "Soll",
  "teamsicht.colIst": "Ist",
  "teamsicht.colSaldo": "Saldo",
  "teamsicht.colVerrechnung": "Verrechnungsgrad",
  "teamsicht.colFerien": "Feriensaldo",
  "teamsicht.totalsRow": "Total",
  "teamsicht.customersTitle": "Kunden- und Projektsicht",
  "teamsicht.customersSubtitle": "Kunden",
  "teamsicht.projectsSubtitle": "Projekte",
  "teamsicht.colCustomer": "Kunde",
  "teamsicht.colProject": "Projekt",
  "teamsicht.colHours": "Stunden",
  "teamsicht.colRate": "CHF/h",
  "teamsicht.colBudget": "Budget",
  "teamsicht.colRevenue": "Umsatz",
  "teamsicht.overBudget": "Budget überschritten",
  "teamsicht.noData": "Keine Daten für diesen Zeitraum",
  // Absenzanträge (MIGRATION.md Punkt 9)
  "absences.title": "Absenzen",
  "absences.newRequest": "Neuer Antrag",
  "absences.from": "Von",
  "absences.to": "Bis",
  "absences.type": "Typ",
  "absences.comment": "Notiz",
  "absences.commentPlaceholder": "Optionale Notiz",
  "absences.submit": "Antrag stellen",
  "absences.requestSubmitted": "Antrag gestellt",
  "absences.myRequests": "Meine Anträge",
  "absences.noRequests": "Keine Anträge gestellt",
  "absences.withdraw": "Zurückziehen",
  "absences.withdrawn": "Antrag zurückgezogen",
  "absences.status.offen": "Offen",
  "absences.status.genehmigt": "Genehmigt",
  "absences.status.abgelehnt": "Abgelehnt",
  "absences.toApprove": "Zu genehmigen",
  "absences.noOpenRequests": "Keine offenen Anträge",
  "absences.approve": "Genehmigen",
  "absences.reject": "Ablehnen",
  "absences.approvedResult": "Genehmigt — {created} Einträge erstellt, {skipped} übersprungen",
  "absences.rejected": "Antrag abgelehnt",
  "absences.teamCalendar": "Team-Kalender",
  "absences.teamCalendarHint": "Abwesenheiten im gewählten Monat ({teamSize} sichtbare Mitglieder). Rot markierte Tage: ungewöhnlich viele gleichzeitig abwesend.",
  "absences.warningHint": "Ungewöhnlich viele Mitglieder gleichzeitig abwesend",
  "absences.noAbsences": "Keine Abwesenheiten in diesem Monat",
  "absences.noAbsencesYear": "Keine Abwesenheiten in diesem Jahr",
  "absences.teamCalendarHintYear": "Abwesenheiten im Jahr {year} ({teamSize} sichtbare Mitglieder). Ferienbilanz in Tagen.",
  "absences.colEntitlement": "Anspruch",
  "absences.colRemaining": "Offen",
  "absences.dayOne": "Tag",
  "absences.dayMany": "Tage",
  // Billing/Trial (MIGRATION.md Punkt 12)
  "billing.trialActive": "Testphase läuft bis {date}.",
  "billing.trialExpired": "Testzeitraum abgelaufen. Diese Organisation ist schreibgeschützt, bis ein Plan gewählt wird.",
  // Rechtliches (MIGRATION.md Punkt 12)
  "legal.title": "Rechtliches",
  "legal.documentsTitle": "Rechtliche Dokumente",
  "legal.documentsHint": "Vorlagen — vor Verwendung durch eine Rechtsberatung prüfen lassen.",
  "legal.docAvv": "Auftragsbearbeitungsvertrag (AVV)",
  "legal.docRecords": "Bearbeitungsverzeichnis-Vorlage",
  "legal.docPrivacy": "Datenschutzerklärung",
  "legal.exportTitle": "Organisationsexport",
  "legal.exportHint": "Vollständiger Export aller Daten dieser Organisation — auch als Vorbereitung für eine Kündigung, siehe gesetzliche Aufbewahrungspflicht.",
  "legal.exportJson": "JSON (vollständig)",
  "legal.exportExcel": "Excel (Übersicht)",
  "legal.dangerZoneTitle": "Gefahrenzone",
  "legal.dangerZoneHint": "Löscht die Organisation und alle zugehörigen Daten unwiderruflich. Vorher unbedingt einen Export vornehmen — die gesetzliche Aufbewahrungspflicht für Geschäftsunterlagen besteht unabhängig von dieser Anwendung weiter.",
  "legal.confirmNameLabel": "Zum Bestätigen \"{name}\" eingeben:",
  "legal.deleteButton": "Organisation endgültig löschen",
  "legal.orgDeleted": "Organisation gelöscht",
  "legal.warningsTitle": "ArG-Warnungen",
  "legal.warningsHint": "Nicht-blockierende Hinweise im Kalender — betrifft nur die Anzeige, nichts wird dadurch am Speichern gehindert.",
  "legal.warnPauseZuKurzLabel": "Pausen-Warnung",
  "legal.warnPauseZuKurzHint": "Warnt, wenn bei der erfassten Arbeitszeit die gesetzliche Mindestpause (Art. 15 ArG) fehlt.",
  "legal.warnSonntagsarbeitLabel": "Sonntagsarbeit-Warnung",
  "legal.warnSonntagsarbeitHint": "Warnt bei jeder Sonntagsarbeit (Art. 18 ArG) — sinnvoll ohne generelle Bewilligung, sonst meist Rauschen.",
  // Common
  "common.loading": "Laden...",
  "common.error": "Ein Fehler ist aufgetreten",
  "common.success": "Erfolgreich",
};

type I18nContextType = {
  t: (key: string, params?: Record<string, string>) => string;
};

const I18nContext = createContext<I18nContextType>({
  t: (key: string) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const t = useCallback(
    (key: string, params?: Record<string, string>) => {
      let str = translations?.[key] ?? key;
      if (params) {
        Object.entries(params ?? {}).forEach(([k, v]: [string, string]) => {
          str = str?.replace?.(`{${k}}`, v ?? "") ?? str;
        });
      }
      return str ?? key;
    },
    []
  );

  return (
    <I18nContext.Provider value={{ t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
