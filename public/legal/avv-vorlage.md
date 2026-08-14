# Auftragsbearbeitungsvertrag (AVV)

**Vorlage — vor Verwendung durch eine Rechtsberatung prüfen lassen.** Dieses
Dokument ist ein Ausgangspunkt, kein rechtsverbindliches, geprüftes
Vertragsdokument. Es orientiert sich am Schweizer Datenschutzgesetz (revDSG)
und, soweit anwendbar, an Art. 28 DSGVO, ersetzt aber keine individuelle
rechtliche Prüfung für Ihre konkrete Situation.

zwischen

**[Name des Auftraggebers/der Kundenorganisation]**
(nachfolgend "Auftraggeber" oder "Verantwortlicher")

und

**[Name des Anbieters von ONEXIS Zeiterfassung]**
(nachfolgend "Auftragsbearbeiter")

---

## 1. Gegenstand

Der Auftragsbearbeiter betreibt die Software-as-a-Service-Anwendung
"ONEXIS Zeiterfassung" und bearbeitet dabei im Auftrag des Auftraggebers
Personendaten von dessen Mitarbeitenden zum Zweck der Arbeitszeiterfassung,
-auswertung und -verwaltung. Dieser Vertrag regelt die Rechte und Pflichten
der Parteien im Zusammenhang mit dieser Bearbeitung.

## 2. Gegenstand und Dauer der Bearbeitung

Die Bearbeitung dauert für die Dauer der Nutzung von ONEXIS Zeiterfassung
durch den Auftraggeber (siehe separater Nutzungsvertrag/AGB) sowie für die
Dauer allfälliger gesetzlicher Aufbewahrungsfristen danach (siehe Ziff. 8).

## 3. Art und Zweck der Bearbeitung

- Erfassung von Arbeitszeiten, Absenzen und Pensumsdaten
- Berechnung von Soll-/Ist-Stunden, Überstunden, Feriensaldi
- Team- und Kundenauswertungen im Auftrag des Auftraggebers
- Versand von Systemmitteilungen (z.B. Passwort-Reset) per E-Mail

## 4. Kategorien betroffener Personen

Mitarbeitende des Auftraggebers, die ONEXIS Zeiterfassung nutzen
(Administratoren, Vorgesetzte, Mitarbeitende).

## 5. Kategorien personenbezogener Daten

Name, E-Mail-Adresse, Pensum, Arbeitszeit-Einträge (Datum, Von/Bis, Pause,
Notizen), Kunden-/Projektzuordnung, Absenzdaten, Rollenzugehörigkeit.
Keine besonders schützenswerten Personendaten im Sinne von Art. 5 lit. c
revDSG, ausser der Absenztyp "Krank" kann implizit auf gesundheitliche
Umstände hindeuten — der Auftraggeber entscheidet über deren Detailtiefe.

## 6. Standort der Datenbearbeitung

Die Daten werden ausschliesslich auf Infrastruktur mit Serverstandort
**Schweiz** bearbeitet und gespeichert (siehe Datenschutzerklärung,
`datenschutzerklaerung.md`, für Details zu Hosting-Anbietern). Es findet
keine Übermittlung an Drittstaaten statt. Der Auftragsbearbeiter setzt
bewusst keine Drittdienste (Analytics, Error-Tracking, E-Mail-Versand)
ausserhalb der Schweiz ein.

## 7. Unterauftragsbearbeiter

Der Auftragsbearbeiter kann folgende Unterauftragsbearbeiter beiziehen,
jeweils mit Sitz und Datenbearbeitung in der Schweiz:

- Hosting-Anbieter (cloudscale.ch oder Infomaniak Public Cloud)
- SMTP-Anbieter für Systemmitteilungen (Infomaniak)

Der Auftraggeber wird über Änderungen der Unterauftragsbearbeiter
informiert und kann innert angemessener Frist widersprechen.

## 8. Aufbewahrung und Löschung

Zeiterfassungsdaten unterliegen der gesetzlichen Aufbewahrungspflicht für
Geschäftsunterlagen (Art. 958f OR, grundsätzlich 10 Jahre für
buchführungsrelevante Unterlagen; arbeitsrechtliche Aufzeichnungspflichten
nach Art. 73 ArGV 1 sehen mindestens 5 Jahre vor). Der Auftraggeber ist
dafür verantwortlich, vor einer Kündigung des Vertragsverhältnisses einen
vollständigen Export seiner Daten vorzunehmen (siehe `/admin/legal` in der
Anwendung, "Organisationsexport"). Eine vollständige Löschung der
Organisation in der Anwendung entbindet den Auftraggeber NICHT von seinen
eigenen, unabhängigen gesetzlichen Aufbewahrungspflichten.

## 9. Technische und organisatorische Massnahmen

- Verschlüsselte Übertragung (TLS, automatisch über Caddy/Let's Encrypt)
- Passwort-Hashing (bcrypt), keine Klartext-Speicherung
- Rollenbasierte Zugriffskontrolle (member/manager/admin/owner) mit
  serverseitiger Durchsetzung
- Mandantentrennung: jede Organisation sieht ausschliesslich ihre eigenen
  Daten
- Protokollierung sicherheitsrelevanter Ereignisse (Änderungs-/
  Löschprotokoll auf Zeiteinträgen)
- Regelmässige Backups (siehe `deploy/README.md`)

## 10. Rechte und Pflichten des Auftraggebers

Der Auftraggeber bleibt Verantwortlicher im Sinne des Datenschutzrechts
und trägt die Verantwortung für die Rechtmässigkeit der Datenbearbeitung
gegenüber seinen eigenen Mitarbeitenden (z.B. Information der
Mitarbeitenden, Rechtsgrundlage für die Zeiterfassung).

## 11. Meldung von Datenschutzverletzungen

Der Auftragsbearbeiter informiert den Auftraggeber unverzüglich über
festgestellte Verletzungen der Datensicherheit, die Personendaten des
Auftraggebers betreffen könnten.

---

*Ort, Datum* ________________________

*Unterschrift Auftraggeber* ________________________

*Unterschrift Auftragsbearbeiter* ________________________
