"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { EINTRAG_TYPEN, type EintragTyp } from "@/lib/calc";

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
  billable: boolean;
  hours: number | null;
}

export interface DayCustomer {
  id: string;
  name: string;
  billable: boolean;
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
  billable: boolean;
  hours: string;
  saving: boolean;
}

function toDraft(entry: DayTimeEntry, fallbackHours: number): DraftRow {
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
    billable: entry.billable ?? false,
    hours: entry.hours != null ? String(entry.hours) : fallbackHours.toFixed(2),
    saving: false,
  };
}

function newDraft(fallbackHours: number): DraftRow {
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    id: null,
    type: "arbeit",
    von: "08:00",
    bis: "17:00",
    pauseMin: "0",
    notiz: "",
    customerId: "",
    projectId: "",
    billable: false,
    hours: fallbackHours.toFixed(2),
    saving: false,
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
}

export function DayEntryDialog({ open, onClose, dateStr, dayLabel, entries, customers, projects, tagesSoll, onChanged, locked = false }: DayEntryDialogProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(entries.length > 0 ? entries.map((e) => toDraft(e, tagesSoll)) : []);
  }, [open, dateStr, entries, tagesSoll]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  // Kunde/Projekt bestimmen billable — beim Wechsel des Kunden wird billable
  // aus dessen Standard-Flag neu vorbelegt (im Tagesdialog per Checkbox
  // weiterhin überschreibbar, MIGRATION.md Punkt 5).
  const handleCustomerChange = (key: string, customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        // Projekt zurücksetzen, wenn es nicht mehr zum neuen Kunden passt.
        const projectStillValid = r.projectId && projects.find((p) => p.id === r.projectId)?.customerId === customerId;
        return { ...r, customerId, projectId: projectStillValid ? r.projectId : "", billable: customer?.billable ?? false };
      })
    );
  };

  const handleProjectChange = (key: string, projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (!project) return { ...r, projectId: "" };
        const customer = customers.find((c) => c.id === project.customerId);
        return { ...r, projectId, customerId: project.customerId, billable: customer?.billable ?? r.billable };
      })
    );
  };

  const handleTypeChange = (key: string, type: EintragTyp) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (type !== "arbeit" && r.type === "arbeit") {
          return { ...r, type, hours: tagesSoll.toFixed(2) };
        }
        return { ...r, type };
      })
    );
  };

  const addRow = () => setRows((prev) => [...prev, newDraft(tagesSoll)]);

  const removeUnsavedRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const saveRow = async (row: DraftRow) => {
    updateRow(row.key, { saving: true });
    try {
      const isArbeit = row.type === "arbeit";
      const body: Record<string, unknown> = {
        date: dateStr,
        type: row.type,
        von: isArbeit ? row.von : null,
        bis: isArbeit ? row.bis : null,
        pauseMin: isArbeit ? Math.max(0, Math.min(1440, parseInt(row.pauseMin, 10) || 0)) : 0,
        notiz: row.notiz.trim() || null,
        customerId: row.customerId || null,
        projectId: row.projectId || null,
        billable: row.billable,
        // hours ist nur für Absenzen relevant — bei arbeit wird aus von/bis/pauseMin berechnet
        hours: isArbeit || row.hours === "" ? null : Math.max(0, Math.min(24, parseFloat(row.hours) || 0)),
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
        const saved = data?.entry;
        if (saved) {
          setRows((prev) => prev.map((r) => (r.key === row.key ? toDraft(saved, tagesSoll) : r)));
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
    } finally {
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
              <div className="flex items-start gap-2 p-3 mb-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800">{t("calendar.monthLocked")}</p>
              </div>
            )}

            {rows.length === 0 && <p className="text-sm text-muted-foreground mb-4">{t("calendar.noEntriesForDay")}</p>}

            <div className="space-y-4">
              {rows.map((row) => {
                const isArbeit = row.type === "arbeit";
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

                    {isArbeit ? (
                      <>
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
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`customer-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.customer")}</label>
                            <select
                              id={`customer-${row.key}`}
                              value={row.customerId}
                              onChange={(e) => handleCustomerChange(row.key, e.target.value)}
                              className="w-full px-2 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                            >
                              <option value="">{t("calendar.customerNone")}</option>
                              {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`project-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.project")}</label>
                            <select
                              id={`project-${row.key}`}
                              value={row.projectId}
                              onChange={(e) => handleProjectChange(row.key, e.target.value)}
                              disabled={!row.customerId}
                              className="w-full px-2 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition disabled:opacity-50"
                            >
                              <option value="">{t("calendar.projectNone")}</option>
                              {projects
                                .filter((p) => p.customerId === row.customerId && p.active)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.billable}
                            onChange={(e) => updateRow(row.key, { billable: e.target.checked })}
                            className="accent-primary"
                          />
                          {t("calendar.billable")}
                        </label>
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
                      <label htmlFor={`notiz-${row.key}`} className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.notiz")}</label>
                      <input
                        id={`notiz-${row.key}`}
                        type="text"
                        value={row.notiz}
                        onChange={(e) => updateRow(row.key, { notiz: e.target.value })}
                        placeholder={t("calendar.notizPlaceholder")}
                        className="w-full px-2 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      />
                    </div>

                    <button
                      onClick={() => saveRow(row)}
                      disabled={row.saving || locked}
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
