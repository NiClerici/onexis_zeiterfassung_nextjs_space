"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { EINTRAG_TYPEN, stundenAusEintrag, type EintragTyp } from "@/lib/calc";
import { buildArbeitszeit } from "@/lib/arbeitszeit";
import { pruefeEintragKonflikte, type VergleichbarerEintrag, type EintragKonflikt } from "@/lib/entry-overlap";

export interface DayTimeEntry {
  id: string;
  date: string;
  type: string;
  von: string | null;
  bis: string | null;
  pauseMin: number;
  notiz: string | null;
  customerId: string | null;
  projectId: string | null;
  hours: number | null;
  // false nur bei aus dem Stundenrapport-Import migrierten Zeilen (siehe
  // TimeEntry.countsAsWorktime in prisma/schema.prisma) — zählt bewusst
  // nicht zur Arbeitszeit, bis diese Zeile hier gespeichert wird (der
  // Server setzt das dann automatisch auf true).
  countsAsWorktime: boolean;
}

export interface DayCustomer {
  id: string;
  name: string;
}

export interface DayProject {
  id: string;
  customerId: string;
  name: string;
  active: boolean;
}

interface DraftRow {
  key: string;
  id: string | null;
  type: EintragTyp;
  von: string;
  bis: string;
  pauseMin: string;
  notiz: string;
  customerId: string;
  projectId: string;
  hours: string;
  // Nur für type==="arbeit" relevant: Eingabe über Von/Bis/Pause (false,
  // Standard) oder direkt über eine Stundenzahl (true) — im zweiten Fall
  // leitet resolvedZeit() von/bis/pauseMin beim Speichern über
  // buildArbeitszeit ab, die Datenstruktur beim Server bleibt identisch.
  hoursMode: boolean;
  saving: boolean;
  countsAsWorktime: boolean;
}

// entry.hours != null nur bei Absenzen (server-seitig, siehe PUT/POST
// /api/time-entries) — hoursModeDefault entscheidet, ob eine frisch aus dem
// Server geladene "arbeit"-Zeile im Von/Bis- oder im Stunden-Modus
// angezeigt wird. Reine hours-Zeilen aus dem Stundenrapport-Import (kein
// von/bis, siehe TimeEntry.countsAsWorktime) starten sinnvollerweise im
// Stunden-Modus statt mit irreführenden 08:00–17:00-Platzhaltern.
function hoursModeDefault(entry: DayTimeEntry): boolean {
  return entry.type === "arbeit" && !entry.von && !entry.bis && entry.hours != null;
}

function toDraft(entry: DayTimeEntry, fallbackHours: number, hoursMode: boolean = hoursModeDefault(entry)): DraftRow {
  const isArbeit = (entry.type as EintragTyp) === "arbeit";
  let hoursStr: string;
  if (entry.hours != null) {
    hoursStr = String(entry.hours);
  } else if (isArbeit && hoursMode && entry.von && entry.bis) {
    // "arbeit" speichert hours serverseitig immer als null — im
    // Stunden-Modus die echte Netto-Stundenzahl aus von/bis/pauseMin
    // zurückrechnen, statt hier auf das Tagessoll zurückzufallen (Bugfix:
    // nach dem Speichern im Stunden-Modus zeigte das Feld plötzlich das
    // Tagessoll statt der eingegebenen Zahl).
    const netto = stundenAusEintrag({ typ: "arbeit", von: entry.von, bis: entry.bis, pauseMin: entry.pauseMin }, 0);
    hoursStr = (Math.round(netto * 100) / 100).toFixed(2);
  } else {
    hoursStr = fallbackHours.toFixed(2);
  }
  return {
    key: entry.id,
    id: entry.id,
    type: (entry.type as EintragTyp) ?? "arbeit",
    von: entry.von ?? "08:00",
    bis: entry.bis ?? "17:00",
    pauseMin: String(entry.pauseMin ?? 0),
    notiz: entry.notiz ?? "",
    customerId: entry.customerId ?? "",
    projectId: entry.projectId ?? "",
    hours: hoursStr,
    hoursMode: isArbeit ? hoursMode : false,
    saving: false,
    countsAsWorktime: entry.countsAsWorktime ?? true,
  };
}

// startVon: die neue Zeile beginnt standardmässig dort, wo die letzte
// "arbeit"-Zeile des Tages endet (siehe addRow), statt wie bisher immer
// wieder bei 08:00–17:00 zu starten — das war der Grund, warum ein zweiter
// Eintrag am selben Tag per Default deckungsgleich mit dem ersten war.
function newDraft(fallbackHours: number, startVon: string = "08:00"): DraftRow {
  const { von, bis, pauseMin } = buildArbeitszeit(fallbackHours, { startVon });
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    id: null,
    type: "arbeit",
    von,
    bis,
    pauseMin: String(pauseMin),
    notiz: "",
    customerId: "",
    projectId: "",
    hours: fallbackHours.toFixed(2),
    hoursMode: false,
    saving: false,
    countsAsWorktime: true,
  };
}

// Leitet die tatsächlich zu speichernden Von/Bis/Pause/Hours-Werte einer
// Zeile ab — einzige Stelle, die zwischen den beiden Eingabemodi übersetzt.
// saveRow(), die Netto-Anzeige und die Live-Konfliktprüfung nutzen alle
// dieselbe Funktion, damit sie nie auseinanderlaufen können (vorher leitete
// nur saveRow() über buildArbeitszeit ab, die Anzeige der Netto-Stunden
// fehlte komplett — Bugfix "unklar, ob die Pause abgezogen wird").
function resolvedZeit(row: DraftRow): { von: string | null; bis: string | null; pauseMin: number; hours: number | null; geklemmt: boolean } {
  if (row.type !== "arbeit") {
    return {
      von: null,
      bis: null,
      pauseMin: 0,
      hours: row.hours === "" ? null : Math.max(0, Math.min(24, parseFloat(row.hours) || 0)),
      geklemmt: false,
    };
  }
  const pauseMinCurrent = Math.max(0, Math.min(1440, parseInt(row.pauseMin, 10) || 0));
  if (row.hoursMode) {
    const hours = Math.max(0, Math.min(24, parseFloat(row.hours) || 0));
    // startVon: row.von (Bugfix "Reset beim Moduswechsel") — die zuletzt
    // bekannte Startzeit bleibt erhalten statt auf 08:00 zurückzuspringen.
    // pauseMin: row.pauseMin (dieselbe Begründung) — eine manuell gesetzte
    // Pause wird nicht stillschweigend durch das ArG-Minimum ersetzt.
    const { von, bis, pauseMin, geklemmt } = buildArbeitszeit(hours, { startVon: row.von || "08:00", pauseMin: pauseMinCurrent });
    return { von, bis, pauseMin, hours: null, geklemmt };
  }
  return { von: row.von, bis: row.bis, pauseMin: pauseMinCurrent, hours: null, geklemmt: false };
}

function toVergleichbarerEintrag(row: DraftRow): VergleichbarerEintrag {
  const zeit = resolvedZeit(row);
  return {
    id: row.id,
    typ: row.type,
    von: zeit.von,
    bis: zeit.bis,
    pauseMin: zeit.pauseMin,
    hours: zeit.hours,
    countsAsWorktime: row.countsAsWorktime,
  };
}

interface DayEntryDialogProps {
  open: boolean;
  onClose: () => void;
  dateStr: string;
  dayLabel: string;
  entries: DayTimeEntry[];
  customers: DayCustomer[];
  projects: DayProject[];
  tagesSoll: number;
  onChanged: () => void;
  // Monatsabschluss (MIGRATION.md Punkt 6e) — true, wenn der angezeigte Monat
  // für die aktuelle Rolle gesperrt ist (vom Aufrufer schon auf "member"
  // eingeschränkt geprüft, siehe calendar/page.tsx). Rein UI-seitig — die
  // eigentliche Durchsetzung liegt in app/api/time-entries/route.ts.
  locked?: boolean;
  // Nicht-blockierende ArG-Compliance-Warnungen dieses Tages (lib/compliance.ts,
  // vom Aufrufer via getComplianceViolations() berechnet). Das Kalender-Grid
  // zeigt dafür nur ein Warndreieck mit title-Tooltip, der auf Touch-Geräten
  // nicht erreichbar ist — hier stehen dieselben Texte lesbar im Dialog.
  violations?: { type: string; message: string }[];
}

export function DayEntryDialog({ open, onClose, dateStr, dayLabel, entries, customers, projects, tagesSoll, onChanged, locked = false, violations = [] }: DayEntryDialogProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftRow[]>([]);

  // Merkt sich, für welches Datum `rows` zuletzt aus `entries` aufgebaut
  // wurde. Bugfix: der Dialog baute `rows` bisher bei JEDER Änderung von
  // `entries` neu auf (auch response-getriebene Refetches nach dem
  // Speichern EINER Zeile, siehe onChanged→fetchEntries in
  // calendar/page.tsx) — dabei gingen alle noch ungespeicherten Zeilen und
  // laufenden Eingaben verloren ("kann ich am gleichen Tag weitere
  // Einträge hinzufügen"). Jede Zeilen-Mutation (saveRow/deleteRow)
  // aktualisiert `rows` bereits direkt und lokal; dieser Effect ist nur
  // noch für den initialen Aufbau beim Öffnen zuständig.
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openedForRef.current = null;
      return;
    }
    if (openedForRef.current === dateStr) return;
    openedForRef.current = dateStr;
    setRows(entries.length > 0 ? entries.map((e) => toDraft(e, tagesSoll)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dateStr]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  // Kunde ist keine eigene Auswahl mehr — er ergibt sich aus dem gewählten
  // Projekt (Project.customerId ist required, siehe app/api/time-entries/
  // route.ts:resolveProjectAndCustomer).
  const handleProjectChange = (key: string, projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (!project) return { ...r, projectId: "", customerId: "" };
        return { ...r, projectId, customerId: project.customerId };
      })
    );
  };

  const handleTypeChange = (key: string, type: EintragTyp) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (type !== "arbeit" && r.type === "arbeit") {
          return { ...r, type, hours: tagesSoll.toFixed(2), hoursMode: false };
        }
        if (type === "arbeit" && r.type !== "arbeit") {
          // Absenz → Arbeitszeit: Von/Bis aus der bisherigen Stundenzahl
          // ableiten statt aus generischen 08:00–17:00-Defaults, die bei
          // einem Teilzeitpensum ein falsches Tagessoll vorgaukeln würden
          // (Bugfix "Typwechsel erfindet Arbeitszeit").
          const hours = Math.max(0, Math.min(24, parseFloat(r.hours) || 0));
          const { von, bis, pauseMin } = buildArbeitszeit(hours);
          return { ...r, type, von, bis, pauseMin: String(pauseMin), hoursMode: false };
        }
        return { ...r, type };
      })
    );
  };

  const addRow = () => {
    // Neue Zeile beginnt beim spätesten Ende der bestehenden "arbeit"-Zeilen
    // dieses Tages (Fallback 08:00 für die erste Zeile) — vorher startete
    // jede neue Zeile unabhängig davon immer bei 08:00–17:00, wodurch ein
    // zweiter Eintrag am selben Tag per Default deckungsgleich mit dem
    // ersten war (Bugfix "Doppelbuchung möglich"). Über resolvedZeit()
    // statt des rohen r.bis werden dabei auch im Modus "Stunden direkt"
    // erfasste Zeilen korrekt berücksichtigt (Bugfix "zweiter Stunden-
    // direkt-Eintrag startet wieder bei 08:00 und überschneidet sich").
    const bisZeiten = rows
      .filter((r) => r.type === "arbeit")
      .map((r) => resolvedZeit(r).bis)
      .filter((bis): bis is string => !!bis)
      .sort();
    const startVon = bisZeiten.length > 0 ? bisZeiten[bisZeiten.length - 1] : "08:00";
    setRows((prev) => [...prev, newDraft(tagesSoll, startVon)]);
  };

  const removeUnsavedRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const saveRow = async (row: DraftRow) => {
    const isArbeit = row.type === "arbeit";
    const zeit = resolvedZeit(row);

    // Pause > Zeitspanne (Bugfix "negative Stunden") — vorher speicherbar,
    // weil weder Client noch Server die Pause gegen die Spanne prüften.
    if (isArbeit && zeit.von && zeit.bis) {
      const netto = stundenAusEintrag({ typ: "arbeit", von: zeit.von, bis: zeit.bis, pauseMin: zeit.pauseMin }, 0);
      if (netto < 0) {
        toast.error(t("calendar.pauseExceedsSpan"));
        return;
      }
    }

    // Blockierende Konflikte (Duplikat/doppelte Absenz) client-seitig vorab
    // prüfen — derselbe Check läuft auch serverseitig (lib/entry-overlap.ts
    // über POST/PUT /api/time-entries) und lehnt mit 409 ab, hier sparen wir
    // uns den Roundtrip und zeigen die Meldung sofort.
    const andereDesTages = rows.filter((r) => r.key !== row.key).map(toVergleichbarerEintrag);
    const konflikte = pruefeEintragKonflikte(toVergleichbarerEintrag(row), andereDesTages);
    const blockierend = konflikte.filter((k) => k.art !== "ueberlappung");
    if (blockierend.length > 0) {
      toast.error(blockierend[0].message);
      return;
    }

    updateRow(row.key, { saving: true });
    try {
      const body: Record<string, unknown> = {
        date: dateStr,
        type: row.type,
        von: zeit.von,
        bis: zeit.bis,
        pauseMin: zeit.pauseMin,
        notiz: row.notiz.trim() || null,
        customerId: row.customerId || null,
        projectId: row.projectId || null,
        // hours ist nur für Absenzen relevant — bei arbeit wird aus von/bis/pauseMin berechnet
        hours: zeit.hours,
      };
      if (row.id) body.id = row.id;

      const res = await fetch("/api/time-entries", {
        method: row.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t("calendar.entrySaved"));
        const warnings: string[] = data?.warnings ?? [];
        warnings.forEach((w) => toast.warning(w));
        const saved = data?.entry;
        if (saved) {
          setRows((prev) => prev.map((r) => (r.key === row.key ? toDraft(saved, tagesSoll, row.hoursMode) : r)));
        } else {
          updateRow(row.key, { saving: false });
        }
        onChanged();
      } else {
        toast.error(data?.error ?? t("calendar.entryError"));
        updateRow(row.key, { saving: false });
      }
    } catch (err) {
      console.error(err);
      toast.error(t("calendar.entryError"));
      updateRow(row.key, { saving: false });
    }
  };

  const deleteRow = async (row: DraftRow) => {
    if (!row.id) {
      removeUnsavedRow(row.key);
      return;
    }
    updateRow(row.key, { saving: true });
    try {
      const res = await fetch("/api/time-entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      if (res.ok) {
        toast.success(t("calendar.entryDeleted"));
        setRows((prev) => prev.filter((r) => r.key !== row.key));
        onChanged();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? t("calendar.entryError"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("calendar.entryError"));
    } finally {
      updateRow(row.key, { saving: false });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="bg-card rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold">{dayLabel}</h3>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {locked && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                <p className="text-xs text-amber-800 dark:text-amber-200">{t("calendar.monthLocked")}</p>
              </div>
            )}

            {violations.length > 0 && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-0.5">{t("calendar.complianceTitle")}</p>
                  <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                    {violations.map((v, i) => (
                      <li key={i}>{v.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {rows.length === 0 && <p className="text-sm text-muted-foreground mb-4">{t("calendar.noEntriesForDay")}</p>}

            <div className="space-y-4">
              {rows.map((row) => {
                const isArbeit = row.type === "arbeit";
                const zeit = resolvedZeit(row);
                const nettoHours =
                  isArbeit && zeit.von && zeit.bis
                    ? stundenAusEintrag({ typ: "arbeit", von: zeit.von, bis: zeit.bis, pauseMin: zeit.pauseMin }, 0)
                    : null;
                const pauseInvalid = nettoHours !== null && nettoHours < 0;

                const andereDesTages = rows.filter((r) => r.key !== row.key).map(toVergleichbarerEintrag);
                const konflikte: EintragKonflikt[] = pruefeEintragKonflikte(toVergleichbarerEintrag(row), andereDesTages);
                const blockierend = konflikte.filter((k) => k.art !== "ueberlappung");
                const ueberlappungen = konflikte.filter((k) => k.art === "ueberlappung");

                return (
                  <div key={row.key} className="rounded-xl bg-secondary/60 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        aria-label={t("calendar.type")}
                        value={row.type}
                        onChange={(e) => handleTypeChange(row.key, e.target.value as EintragTyp)}
                        className="flex-1 px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      >
                        {EINTRAG_TYPEN.map((typ) => (
                          <option key={typ} value={typ}>
                            {t(`calendar.type.${typ}`)}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => deleteRow(row)}
                        disabled={row.saving || locked}
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
                        title={t("calendar.delete")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {!row.countsAsWorktime && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                        {t("calendar.countsAsWorktimeHint")}
                      </p>
                    )}

                    {(blockierend.length > 0 || ueberlappungen.length > 0) && (
                      <div className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5 space-y-1">
                        {blockierend.map((k, i) => (
                          <p key={`b-${i}`} className="text-amber-900 dark:text-amber-100 font-medium">
                            {t("calendar.conflictBlocking")} {k.message}
                          </p>
                        ))}
                        {ueberlappungen.map((k, i) => (
                          <p key={`o-${i}`} className="text-amber-700 dark:text-amber-300">
                            {t("calendar.conflictWarning")} {k.message}
                          </p>
                        ))}
                      </div>
                    )}

                    {isArbeit ? (
                      <>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              // Nur etwas ableiten, wenn tatsächlich vom
                              // Stunden-Modus gewechselt wird — resolvedZeit()
                              // nutzt dafür row.hours, row.von (Startzeit) und
                              // row.pauseMin (manuell gesetzte Pause) statt sie
                              // auf 08:00 + ArG-Minimum zurückzusetzen (Bugfix
                              // "Reset beim Moduswechsel"). War schon Von/Bis
                              // aktiv, bleibt die Zeile unangetastet.
                              if (!row.hoursMode) return;
                              const z = resolvedZeit(row);
                              updateRow(row.key, { hoursMode: false, von: z.von ?? row.von, bis: z.bis ?? row.bis, pauseMin: String(z.pauseMin) });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${!row.hoursMode ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}
                          >
                            {t("calendar.modeVonBis")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              // Nur beim tatsächlichen Wechsel aus Von/Bis
                              // neu berechnen — war schon Stunden-Modus aktiv,
                              // würde ein erneutes Ableiten aus row.von/row.bis
                              // (die dort seit dem letzten Wechsel eingefroren
                              // sind) die gerade getippte Stundenzahl
                              // überschreiben.
                              if (row.hoursMode) return;
                              const pauseMin = Math.max(0, Math.min(1440, parseInt(row.pauseMin, 10) || 0));
                              const hours = stundenAusEintrag({ typ: "arbeit", von: row.von, bis: row.bis, pauseMin }, 0);
                              updateRow(row.key, { hoursMode: true, hours: (Math.round(hours * 100) / 100).toFixed(2) });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${row.hoursMode ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}
                          >
                            {t("calendar.modeHours")}
                          </button>
                        </div>
                        {row.hoursMode ? (
                          <div>
                            <label htmlFor={`hours-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.entryHours")}</label>
                            <input
                              id={`hours-${row.key}`}
                              type="number"
                              step="0.25"
                              min="0"
                              max="24"
                              value={row.hours}
                              onChange={(e) => updateRow(row.key, { hours: e.target.value })}
                              className="w-full px-4 py-2 rounded-xl bg-secondary text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("calendar.hoursDirectHint")}</p>
                            {zeit.von && zeit.bis && (
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {t("calendar.netHoursMode", {
                                  hours: (parseFloat(row.hours) || 0).toFixed(2),
                                  pause: String(zeit.pauseMin),
                                  von: zeit.von,
                                  bis: zeit.bis,
                                })}
                              </p>
                            )}
                            {zeit.geklemmt && <p className="text-xs text-amber-700 mt-1">{t("calendar.timeClamped")}</p>}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label htmlFor={`von-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.von")}</label>
                              <input
                                id={`von-${row.key}`}
                                type="time"
                                value={row.von}
                                onChange={(e) => updateRow(row.key, { von: e.target.value })}
                                className="w-full px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                              />
                            </div>
                            <div>
                              <label htmlFor={`bis-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.bis")}</label>
                              <input
                                id={`bis-${row.key}`}
                                type="time"
                                value={row.bis}
                                onChange={(e) => updateRow(row.key, { bis: e.target.value })}
                                className="w-full px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                              />
                            </div>
                            <div>
                              <label htmlFor={`pause-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.pause")}</label>
                              <input
                                id={`pause-${row.key}`}
                                type="number"
                                min="0"
                                max="1440"
                                step="5"
                                value={row.pauseMin}
                                onChange={(e) => updateRow(row.key, { pauseMin: e.target.value })}
                                className="w-full px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                              />
                            </div>
                            {nettoHours !== null && (
                              <p className={`col-span-3 text-xs font-mono ${pauseInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                                {pauseInvalid
                                  ? t("calendar.pauseExceedsSpan")
                                  : t("calendar.netHoursVonBis", {
                                      von: zeit.von ?? "",
                                      bis: zeit.bis ?? "",
                                      pause: String(zeit.pauseMin),
                                      hours: nettoHours.toFixed(2),
                                    })}
                              </p>
                            )}
                          </div>
                        )}
                        <div>
                          <label htmlFor={`project-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.project")}</label>
                          <select
                            id={`project-${row.key}`}
                            value={row.projectId}
                            onChange={(e) => handleProjectChange(row.key, e.target.value)}
                            className="w-full px-2 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          >
                            <option value="">{t("calendar.projectNone")}</option>
                            {customers.map((c) => {
                              const custProjects = projects.filter((p) => p.customerId === c.id && p.active);
                              if (custProjects.length === 0) return null;
                              return (
                                <optgroup key={c.id} label={c.name}>
                                  {custProjects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                      </>
                    ) : (
                      <div>
                        <label htmlFor={`hours-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.entryHours")}</label>
                        <input
                          id={`hours-${row.key}`}
                          type="number"
                          step="0.25"
                          min="0"
                          max="24"
                          value={row.hours}
                          onChange={(e) => updateRow(row.key, { hours: e.target.value })}
                          className="w-full px-4 py-2 rounded-xl bg-secondary text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                        />
                      </div>
                    )}

                    <div>
                      {/* Bei Arbeitszeit dient das Feld als Tätigkeitsbeschreibung
                          (Tasks, passend zum Stundenrapport-Format), bei
                          Absenzen bleibt es eine freie Notiz. */}
                      <label htmlFor={`notiz-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{isArbeit ? t("calendar.tasks") : t("calendar.notiz")}</label>
                      <input
                        id={`notiz-${row.key}`}
                        type="text"
                        value={row.notiz}
                        onChange={(e) => updateRow(row.key, { notiz: e.target.value })}
                        placeholder={isArbeit ? t("calendar.tasksPlaceholder") : t("calendar.notizPlaceholder")}
                        className="w-full px-2 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      />
                    </div>

                    <button
                      onClick={() => saveRow(row)}
                      disabled={row.saving || locked || pauseInvalid || blockierend.length > 0}
                      className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                    >
                      {row.saving ? t("common.loading") : t("calendar.save")}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={addRow}
              disabled={locked}
              className="mt-4 w-full py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {t("calendar.addEntry")}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
