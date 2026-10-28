"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Plus, AlertTriangle, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { EINTRAG_TYPEN, stundenAusEintrag, type EintragTyp } from "@/lib/calc";
import { buildArbeitszeit } from "@/lib/arbeitszeit";
import { pruefeEintragKonflikte, type VergleichbarerEintrag, type EintragKonflikt } from "@/lib/entry-overlap";
import { verschiebeFolgezeilen } from "@/lib/day-shift";
import { TYPE_COLOR } from "@/lib/absence-colors";

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

function zeitInMinuten(zeit: string): number {
  const [h, m] = zeit.split(":").map(Number);
  return h * 60 + m;
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


// Ergebnis der Live-Prüfung einer Zeile (siehe rowChecks im Dialog) — Karte
// und Editor lesen beide daraus, damit Netto-Stunden und Konflikte in der
// Liste links und im Editor rechts nie auseinanderlaufen.
interface RowCheck {
  isArbeit: boolean;
  zeit: ReturnType<typeof resolvedZeit>;
  nettoHours: number | null;
  pauseInvalid: boolean;
  blockierend: EintragKonflikt[];
  ueberlappungen: EintragKonflikt[];
  // Stunden, mit denen die Zeile ins Tagestotal eingeht (Arbeit netto aus
  // von/bis/pause, Absenzen ihre Stundenzahl bzw. das Tagessoll).
  stunden: number;
}

type T = (key: string, params?: Record<string, string>) => string;

interface EntryCardProps {
  row: DraftRow;
  check: RowCheck;
  customers: DayCustomer[];
  projects: DayProject[];
  selected: boolean;
  onSelect: () => void;
  t: T;
}

// Kompakte Zusammenfassung eines Eintrags für die Liste links (Desktop) bzw.
// die Kartenansicht auf dem Handy — Bearbeiten passiert nur im Editor.
function EntryCard({ row, check, customers, projects, selected, onSelect, t }: EntryCardProps) {
  const { isArbeit, zeit, blockierend, ueberlappungen, pauseInvalid, stunden } = check;
  const project = projects.find((p) => p.id === row.projectId);
  const customer = customers.find((c) => c.id === (project?.customerId ?? row.customerId));
  const projektZeile = [customer?.name, project?.name].filter(Boolean).join(" · ");
  const hatWarnung = blockierend.length > 0 || ueberlappungen.length > 0 || pauseInvalid;

  let zeitZeile: string;
  if (isArbeit && zeit.von && zeit.bis) {
    zeitZeile = `${zeit.von}–${zeit.bis}`;
    if (zeit.pauseMin > 0) zeitZeile += ` · ${zeit.pauseMin}′ ${t("calendar.pause")}`;
    if (row.hoursMode) zeitZeile = `${t("calendar.hoursDirectShort", { hours: (parseFloat(row.hours) || 0).toFixed(2) })} · ${zeitZeile}`;
  } else {
    zeitZeile = `${(zeit.hours ?? 0).toFixed(2)} h`;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative w-full text-left rounded-xl pl-4 pr-3 py-2.5 transition overflow-hidden ${
        selected ? "bg-accent ring-2 ring-primary" : "bg-secondary/60 hover:bg-accent"
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${TYPE_COLOR[row.type] ?? "bg-gray-400"}`} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate flex items-center gap-1.5">
          {t(`calendar.type.${row.type}`)}
          {row.id === null && (
            <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{t("calendar.newBadge")}</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {hatWarnung && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" aria-label={t("calendar.conflictWarning")} />}
          <span className={`text-sm font-mono ${pauseInvalid ? "text-destructive" : ""}`}>{stunden.toFixed(2)} h</span>
        </span>
      </div>
      <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{zeitZeile}</p>
      {projektZeile && <p className="text-xs text-foreground/80 mt-0.5 truncate">{projektZeile}</p>}
      {row.notiz.trim() && <p className="text-xs text-muted-foreground mt-0.5 truncate italic">{row.notiz}</p>}
      {!row.countsAsWorktime && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 truncate">{t("calendar.notCountedShort")}</p>
      )}
    </button>
  );
}

interface EntryEditorProps {
  row: DraftRow;
  check: RowCheck;
  customers: DayCustomer[];
  projects: DayProject[];
  disabled: boolean;
  onUpdate: (patch: Partial<DraftRow>) => void;
  onTypeChange: (type: EintragTyp) => void;
  onProjectChange: (projectId: string) => void;
  onRemove: () => void;
  t: T;
}

// Formular für genau einen Eintrag (rechts auf dem Desktop, Detailansicht
// auf dem Handy) — Inhalt und Verhalten entsprechen 1:1 der früheren
// aufgeklappten Zeile im gestapelten Dialog.
function EntryEditor({ row, check, customers, projects, disabled, onUpdate, onTypeChange, onProjectChange, onRemove, t }: EntryEditorProps) {
  const { isArbeit, zeit, nettoHours, pauseInvalid, blockierend, ueberlappungen } = check;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <select
          aria-label={t("calendar.type")}
          value={row.type}
          onChange={(e) => onTypeChange(e.target.value as EintragTyp)}
          className="flex-1 px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
        >
          {EINTRAG_TYPEN.map((typ) => (
            <option key={typ} value={typ}>
              {t(`calendar.type.${typ}`)}
            </option>
          ))}
        </select>
        <button
          onClick={onRemove}
          disabled={disabled}
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
                onUpdate({ hoursMode: false, von: z.von ?? row.von, bis: z.bis ?? row.bis, pauseMin: String(z.pauseMin) });
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
                onUpdate({ hoursMode: true, hours: (Math.round(hours * 100) / 100).toFixed(2) });
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
                onChange={(e) => onUpdate({ hours: e.target.value })}
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
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <div className="min-w-0">
                <label htmlFor={`von-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.von")}</label>
                <input
                  id={`von-${row.key}`}
                  type="time"
                  value={row.von}
                  onChange={(e) => onUpdate({ von: e.target.value })}
                  className="w-full px-1 sm:px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`bis-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.bis")}</label>
                <input
                  id={`bis-${row.key}`}
                  type="time"
                  value={row.bis}
                  onChange={(e) => onUpdate({ bis: e.target.value })}
                  className="w-full px-1 sm:px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`pause-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.pause")}</label>
                <input
                  id={`pause-${row.key}`}
                  type="number"
                  min="0"
                  max="1440"
                  step="5"
                  value={row.pauseMin}
                  onChange={(e) => onUpdate({ pauseMin: e.target.value })}
                  className="w-full px-1 sm:px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
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
              onChange={(e) => onProjectChange(e.target.value)}
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
            onChange={(e) => onUpdate({ hours: e.target.value })}
            className="w-full px-4 py-2 rounded-xl bg-secondary text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
        </div>
      )}

      <div>
        {/* Bei Arbeitszeit dient das Feld als Tätigkeitsbeschreibung
            (Tasks, passend zum Stundenrapport-Format), bei
            Absenzen bleibt es eine freie Notiz. Im Editor ist dafür
            Platz für mehrere Zeilen, die Karte links kürzt auf eine. */}
        <label htmlFor={`notiz-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{isArbeit ? t("calendar.tasks") : t("calendar.notiz")}</label>
        <textarea
          id={`notiz-${row.key}`}
          rows={3}
          value={row.notiz}
          onChange={(e) => onUpdate({ notiz: e.target.value })}
          placeholder={isArbeit ? t("calendar.tasksPlaceholder") : t("calendar.notizPlaceholder")}
          className="w-full px-2 py-2 rounded-xl bg-secondary text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
        />
      </div>
    </div>
  );
}

export function DayEntryDialog({ open, onClose, dateStr, dayLabel, entries, customers, projects, tagesSoll, onChanged, locked = false, violations = [] }: DayEntryDialogProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [savingDay, setSavingDay] = useState(false);
  // Ob seit dem letzten Öffnen/Speichern ungespeicherte Änderungen bestehen
  // — mit nur noch einem Speichern-Button pro Tag (statt einem pro Zeile)
  // wiegt ein versehentliches Schliessen schwerer als vorher, siehe
  // handleClose() unten.
  const [dirty, setDirty] = useState(false);
  // Master-Detail: links die Liste aller Einträge des Tages, rechts der
  // Editor für genau einen davon. Auf dem Handy (< md) ist immer nur eine
  // der beiden Ansichten sichtbar — mobileView schaltet zwischen ihnen um,
  // auf dem Desktop sind beide Spalten immer sichtbar und mobileView wirkt
  // sich rein über die CSS-Klassen nicht aus.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // Merkt sich, für welches Datum `rows` zuletzt aus `entries` aufgebaut
  // wurde. Bugfix: der Dialog baute `rows` bisher bei JEDER Änderung von
  // `entries` neu auf (auch response-getriebene Refetches nach dem
  // Speichern EINER Zeile, siehe onChanged→fetchEntries in
  // calendar/page.tsx) — dabei gingen alle noch ungespeicherten Zeilen und
  // laufenden Eingaben verloren ("kann ich am gleichen Tag weitere
  // Einträge hinzufügen"). Jede Zeilen-Mutation aktualisiert `rows` bereits
  // direkt und lokal; dieser Effect ist nur noch für den initialen Aufbau
  // beim Öffnen zuständig.
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openedForRef.current = null;
      return;
    }
    if (openedForRef.current === dateStr) return;
    openedForRef.current = dateStr;
    const initial = entries.length > 0 ? entries.map((e) => toDraft(e, tagesSoll)) : [];
    setRows(initial);
    setSelectedKey(initial[0]?.key ?? null);
    setMobileView("list");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dateStr]);

  // Ändert ein Patch die aufgelöste Bis-Zeit einer "arbeit"-Zeile, rücken
  // alle FOLGENDEN "arbeit"-Zeilen desselben Tages automatisch um dieselbe
  // Differenz nach (lib/day-shift.ts) — vorher musste das von Hand in jeder
  // Zeile nachgetragen werden. Alte und neue Bis-Zeit kommen beide aus
  // resolvedZeit(), derselben Funktion, die Anzeige und Speichern schon
  // nutzen, damit die drei nicht auseinanderlaufen können; das trifft damit
  // automatisch beide Eingabemodi (Von/Bis und Stunden direkt).
  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setDirty(true);
    setRows((prev) => {
      const before = prev.find((r) => r.key === key);
      if (!before) return prev;
      const after = { ...before, ...patch };
      let next = prev.map((r) => (r.key === key ? after : r));

      if (after.type === "arbeit") {
        const beforeBis = resolvedZeit(before).bis;
        const afterBis = resolvedZeit(after).bis;
        const deltaMin = beforeBis && afterBis ? zeitInMinuten(afterBis) - zeitInMinuten(beforeBis) : 0;
        if (deltaMin !== 0) {
          const shiftInput = next.map((r) => ({ key: r.key, typ: r.type, von: r.von, bis: r.bis, hoursMode: r.hoursMode }));
          const { rows: shifted, geklemmt } = verschiebeFolgezeilen(shiftInput, key, deltaMin);
          const shiftedByKey = new Map(shifted.map((s) => [s.key, s]));
          next = next.map((r) => {
            if (r.key === key) return r;
            const s = shiftedByKey.get(r.key);
            return s ? { ...r, von: s.von, bis: s.bis } : r;
          });
          if (geklemmt) toast.warning(t("calendar.dayShiftClamped"));
        }
      }
      return next;
    });
  };

  // Kunde ist keine eigene Auswahl mehr — er ergibt sich aus dem gewählten
  // Projekt (Project.customerId ist required, siehe app/api/time-entries/
  // route.ts:resolveProjectAndCustomer).
  const handleProjectChange = (key: string, projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setDirty(true);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (!project) return { ...r, projectId: "", customerId: "" };
        return { ...r, projectId, customerId: project.customerId };
      })
    );
  };

  const handleTypeChange = (key: string, type: EintragTyp) => {
    setDirty(true);
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
    const draft = newDraft(tagesSoll, startVon);
    setDirty(true);
    setRows((prev) => [...prev, draft]);
    setSelectedKey(draft.key);
    setMobileView("detail");
  };

  // Löscht nur noch lokal — egal ob die Zeile schon gespeichert ist oder
  // nicht. Die eigentliche Löschung (Soft-Delete + Audit) wird erst mit dem
  // nächsten "Tag speichern" wirksam (app/api/time-entries/day/route.ts:
  // Zeilen, die im Payload fehlen, werden dort entfernt) — Speichern ist
  // damit die einzige schreibende Aktion dieses Dialogs.
  const removeRow = (key: string) => {
    const index = rows.findIndex((r) => r.key === key);
    const remaining = rows.filter((r) => r.key !== key);
    // Auswahl auf den Nachbarn setzen (nächster, sonst vorheriger), damit der
    // Editor nach dem Löschen nicht leer dasteht.
    const neighbour = remaining[Math.min(index, remaining.length - 1)];
    setDirty(true);
    setRows(remaining);
    setSelectedKey(neighbour?.key ?? null);
    setMobileView("list");
  };

  const saveDay = async () => {
    setSavingDay(true);
    try {
      const hoursModeByIndex = rows.map((r) => r.hoursMode);
      const selectedIndex = rows.findIndex((r) => r.key === selectedKey);
      const payloadRows = rows.map((row) => {
        const zeit = resolvedZeit(row);
        return {
          id: row.id ?? undefined,
          type: row.type,
          von: zeit.von,
          bis: zeit.bis,
          pauseMin: zeit.pauseMin,
          notiz: row.notiz.trim() || null,
          customerId: row.customerId || null,
          projectId: row.projectId || null,
          hours: zeit.hours,
        };
      });

      const res = await fetch("/api/time-entries/day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr, rows: payloadRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t("calendar.daySaved"));
        const warnings: string[] = data?.warnings ?? [];
        warnings.forEach((w) => toast.warning(w));
        const savedEntries: DayTimeEntry[] = data?.entries ?? [];
        // Antwort und Anfrage haben dieselbe Reihenfolge (die Route verarbeitet
        // rows in Eingabereihenfolge) — per Index statt per id zuordnen, damit
        // auch neu angelegte Zeilen (id war beim Senden noch null) ihren
        // gewählten hoursMode behalten (gleiche Begründung wie zuvor bei
        // saveRow(): ein Refetch darf den Eingabemodus nicht zurücksetzen).
        // Aus demselben Grund bleibt auch die Auswahl per Index erhalten —
        // neue Zeilen wechseln beim Speichern von "new-…" auf ihre echte id.
        const saved = savedEntries.map((e, i) => toDraft(e, tagesSoll, hoursModeByIndex[i]));
        setRows(saved);
        setSelectedKey(saved[selectedIndex]?.key ?? saved[0]?.key ?? null);
        setDirty(false);
        onChanged();
      } else {
        toast.error(data?.error ?? t("calendar.entryError"));
      }
    } catch (err) {
      console.error(err);
      toast.error(t("calendar.entryError"));
    } finally {
      setSavingDay(false);
    }
  };

  const handleClose = () => {
    if (dirty && !window.confirm(t("calendar.unsavedWarning"))) return;
    onClose();
  };

  const selectRow = (key: string) => {
    setSelectedKey(key);
    setMobileView("detail");
  };

  // Einmal pro Zeile berechnet (statt separat für Karte, Editor UND das
  // aggregierte Sperren des Tages-Speichern-Buttons unten) — jede Zeile
  // prüft dieselben Konflikte gegen alle anderen Zeilen des Tages, wie es
  // vorher schon der Fall war.
  const rowChecks = new Map<string, RowCheck>(
    rows.map((row) => {
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
      const stunden = Math.max(
        0,
        stundenAusEintrag({ typ: row.type, von: zeit.von, bis: zeit.bis, pauseMin: zeit.pauseMin, hours: zeit.hours }, tagesSoll)
      );
      return [row.key, { isArbeit, zeit, nettoHours, pauseInvalid, blockierend, ueberlappungen, stunden }] as const;
    })
  );
  const canSaveDay =
    !locked && !savingDay && rows.every((r) => !rowChecks.get(r.key)!.pauseInvalid && rowChecks.get(r.key)!.blockierend.length === 0);
  // Nur Zeilen, die zur Arbeitszeit zählen — importierte Stundenrapport-
  // Zeilen (countsAsWorktime=false) wirken sich nicht aufs Soll aus.
  const tagesTotal = rows.reduce((sum, r) => (r.countsAsWorktime ? sum + rowChecks.get(r.key)!.stunden : sum), 0);
  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null;
  const showDetailOnMobile = mobileView === "detail" && selectedRow !== null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm md:p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="bg-card rounded-t-2xl md:rounded-2xl w-full md:max-w-4xl max-h-[92svh] md:h-[min(640px,85svh)] flex flex-col overflow-hidden"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            {/* Kopfzeile: auf dem Handy in der Detailansicht ein Zurück-Button
                statt des Datums. */}
            <div className="flex items-center justify-between gap-2 px-5 md:px-6 pt-5 pb-3 shrink-0">
              {showDetailOnMobile ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMobileView("list")}
                    className="md:hidden -ml-2 flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium hover:bg-accent transition"
                  >
                    <ChevronLeft className="w-4 h-4" /> {t("calendar.back")}
                  </button>
                  <h3 className="hidden md:block font-display font-semibold">{dayLabel}</h3>
                </>
              ) : (
                <h3 className="font-display font-semibold">{dayLabel}</h3>
              )}
              <button onClick={handleClose} className="p-1 rounded-lg hover:bg-accent transition" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {(locked || violations.length > 0) && (
              <div className={`px-5 md:px-6 space-y-2 mb-3 shrink-0 ${showDetailOnMobile ? "hidden md:block" : ""}`}>
                {locked && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                    <p className="text-xs text-amber-800 dark:text-amber-200">{t("calendar.monthLocked")}</p>
                  </div>
                )}
                {violations.length > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
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
              </div>
            )}

            <div className="flex-1 min-h-0 grid md:grid-cols-[18rem_1fr] md:border-t md:border-border">
              {/* Liste */}
              <div className={`min-h-0 flex-col md:border-r md:border-border ${showDetailOnMobile ? "hidden md:flex" : "flex"}`}>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 md:px-4 py-1 md:py-4 space-y-2">
                  {rows.length === 0 && <p className="text-sm text-muted-foreground py-2">{t("calendar.noEntriesForDay")}</p>}
                  {rows.map((row) => (
                    <EntryCard
                      key={row.key}
                      row={row}
                      check={rowChecks.get(row.key)!}
                      customers={customers}
                      projects={projects}
                      selected={row.key === selectedKey}
                      onSelect={() => selectRow(row.key)}
                      t={t}
                    />
                  ))}
                </div>
                <div className="px-5 md:px-4 pt-2 pb-3 md:pb-4 shrink-0">
                  <button
                    onClick={addRow}
                    disabled={locked || savingDay}
                    className="w-full py-2.5 rounded-xl border border-dashed border-border text-foreground text-sm font-medium hover:bg-accent transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> {t("calendar.addEntry")}
                  </button>
                </div>
              </div>

              {/* Editor */}
              <div className={`min-h-0 overflow-y-auto overscroll-contain px-5 md:px-6 py-1 md:py-4 ${showDetailOnMobile ? "block" : "hidden md:block"}`}>
                {selectedRow ? (
                  <motion.div key={selectedRow.key} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}>
                    <h4 className="font-display font-semibold text-sm text-muted-foreground mb-3">{t("calendar.editEntry")}</h4>
                    <EntryEditor
                      row={selectedRow}
                      check={rowChecks.get(selectedRow.key)!}
                      customers={customers}
                      projects={projects}
                      disabled={locked || savingDay}
                      onUpdate={(patch) => updateRow(selectedRow.key, patch)}
                      onTypeChange={(type) => handleTypeChange(selectedRow.key, type)}
                      onProjectChange={(projectId) => handleProjectChange(selectedRow.key, projectId)}
                      onRemove={() => removeRow(selectedRow.key)}
                      t={t}
                    />
                  </motion.div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm text-muted-foreground text-center max-w-xs">{t("calendar.selectEntryHint")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Fusszeile: Tagestotal + Speichern; auf dem Handy in der
                Detailansicht stattdessen "Fertig" zurück zur Liste. */}
            <div className="shrink-0 border-t border-border px-5 md:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {showDetailOnMobile && (
                <button
                  onClick={() => setMobileView("list")}
                  className="md:hidden w-full py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition"
                >
                  {t("calendar.done")}
                </button>
              )}
              <div className={`items-center justify-between gap-3 ${showDetailOnMobile ? "hidden md:flex" : "flex"}`}>
                <p className="text-xs text-muted-foreground font-mono">
                  {t("calendar.dayTotal", { hours: tagesTotal.toFixed(2), soll: tagesSoll.toFixed(2) })}
                </p>
                <button
                  onClick={saveDay}
                  disabled={!canSaveDay}
                  className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {savingDay ? t("common.loading") : t("calendar.saveDay")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
