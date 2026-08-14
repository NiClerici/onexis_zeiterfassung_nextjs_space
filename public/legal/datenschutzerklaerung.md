# Datenschutzerklärung — ONEXIS Zeiterfassung

**Vorlage — vor Veröffentlichung durch eine Rechtsberatung prüfen lassen
und mit den tatsächlichen Anbieterangaben (Firma, Adresse, Kontakt)
ergänzen.** Stand: [Datum einfügen].

## 1. Hosting-Standort

ONEXIS Zeiterfassung wird ausschliesslich auf Servern mit physischem
**Standort Schweiz** betrieben, bei einem Schweizer
Infrastrukturanbieter (cloudscale.ch oder Infomaniak Public Cloud — siehe
`deploy/README.md` für die konkrete Konfiguration dieser Installation).
Es findet keine Datenübermittlung an Server ausserhalb der Schweiz statt.

## 2. Keine Drittdienste ausserhalb der Schweiz

Diese Anwendung verzichtet bewusst auf US-amerikanische oder andere
nicht-schweizerische Drittdienste:

- **Keine Analytics-/Tracking-Dienste** (kein Google Analytics, kein
  Vercel Analytics, kein vergleichbarer Dienst)
- **Kein Error-Tracking bei Drittanbietern** (kein Sentry, Bugsnag o.ä.)
- **E-Mail-Versand** (Passwort-Reset, Einladungen) über einen Schweizer
  SMTP-Anbieter (Infomaniak) — nicht über SendGrid, Postmark, Resend o.ä.
- **Schriftarten** werden zur Build-Zeit heruntergeladen und danach von
  der eigenen Domain ausgeliefert — der Browser einer nutzenden Person
  kontaktiert zu keinem Zeitpunkt Google-Server für Schriftarten.

## 3. Welche Daten werden bearbeitet

- **Konto-/Identitätsdaten**: Name, E-Mail-Adresse, Passwort (nur als
  Hash gespeichert, nie im Klartext)
- **Arbeitszeitdaten**: erfasste Arbeitszeiten, Absenzen, Pensum,
  Kunden-/Projektzuordnung
- **Nutzungsprotokoll**: Änderungs- und Löschprotokoll auf Zeiteinträgen
  (wer hat wann was geändert) — gesetzlich vorgeschrieben, dient der
  Nachvollziehbarkeit bei einer Kontrolle durch das Arbeitsinspektorat

## 4. Zweck der Bearbeitung

Ausschliesslich zur Erbringung der Zeiterfassungs-Dienstleistung für den
Arbeitgeber (Ihre Organisation), der Sie als Mitarbeiter*in angehören.
Details zur konkreten Bearbeitung im Auftrag Ihres Arbeitgebers finden
sich im Auftragsbearbeitungsvertrag (`avv-vorlage.md`) zwischen Ihrem
Arbeitgeber und dem Betreiber dieser Anwendung.

## 5. Aufbewahrungsdauer

Zeiterfassungsdaten werden mindestens 5 Jahre aufbewahrt (gesetzliche
Aufzeichnungspflicht nach Art. 73 ArGV 1). Gelöschte Einträge werden nicht
sofort unwiderruflich entfernt, sondern als gelöscht markiert und bleiben
für die Dauer der Aufbewahrungspflicht rekonstruierbar.

## 6. Ihre Rechte

Sie haben das Recht auf Auskunft über die zu Ihrer Person bearbeiteten
Daten. Wenden Sie sich dazu an Ihren Arbeitgeber als Verantwortlichen im
Sinne des Datenschutzrechts — er kann über die Administrationsoberfläche
einen vollständigen Datenexport Ihrer Organisation vornehmen.

## 7. Cookies

Diese Anwendung verwendet ausschliesslich technisch notwendige Cookies
für die Anmeldesitzung (Session-Cookie von NextAuth). Keine
Marketing- oder Tracking-Cookies.

## 8. Kontakt

[Firma, Adresse, E-Mail-Adresse der verantwortlichen Stelle einfügen]
