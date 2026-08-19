"use client";

// Manuelle monatliche Kundenstunden-Erfassung — nur im Profil eingebunden
// (app/(app)/profile/page.tsx), bewusst nicht zusätzlich im Kalender, um
// nicht zwei Bearbeitungsorte für dieselben Daten zu haben. API ist
// monatsbasiert (app/api/customer-months/route.ts).
//
// Wichtig: PUT /api/customer-months ersetzt immer den GESAMTEN Monat
// (deleteMany + create in einer Transaktion) — es gibt bewusst kein
// POST/DELETE für einzelne Zeilen (@@unique fehlt in CustomerMonth wegen
// Prisma-NULL-Semantik bei projectId, siehe schema.prisma). Jede Änderung
// hier baut deshalb den vollständigen rows-Stand neu auf und schickt ihn
// komplett.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

interface CustomerData {
  id: string;
  name: string;
  billable: boolean;
}

interface ProjectData {
  id: string;
  name: string;
  customerId: string;
}

interface CustomerMonthRow {
  id: string;
  customerId: string;
  projectId: string | null;
  hours: number;
}

interface CustomerMonthCardProps {
  year: number;
  month: number;
  locked?: boolean;
}

export function CustomerMonthCard({ year, month, locked }: CustomerMonthCardProps) {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [rows, setRows] = useState<CustomerMonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formProjectId, setFormProjectId] = useState("");
  const [formHours, setFormHours] = useState("");

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/customers");
      const data = await res?.json?.().catch(() => null);
      if (res?.ok) setCustomers(data?.customers ?? []);
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res?.json?.().catch(() => null);
      if (res?.ok) setProjects(data?.projects ?? []);
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchMonth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer-months?year=${year}&month=${month}`);
      const data = await res?.json?.().catch(() => null);
      if (res?.ok) {
        setRows((data?.rows ?? []).map((r: any) => ({ id: r.id, customerId: r.customerId, projectId: r.projectId, hours: r.hours })));
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { fetchCustomers(); fetchProjects(); }, [fetchCustomers, fetchProjects]);
  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "";
  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? "" : "");
  const totalHours = useMemo(() => rows.reduce((s, r) => s + (r.hours ?? 0), 0), [rows]);
  const projectsForCustomer = (customerId: string) => projects.filter((p) => p.customerId === customerId);

  const openAdd = () => {
    setEditingId(null);
    setFormCustomerId(customers[0]?.id ?? "");
    setFormProjectId("");
    setFormHours("");
    setModalOpen(true);
  };

  const openEdit = (row: CustomerMonthRow) => {
    setEditingId(row.id);
    setFormCustomerId(row.customerId);
    setFormProjectId(row.projectId ?? "");
    setFormHours(String(row.hours));
    setModalOpen(true);
  };

  // Baut den vollständigen rows-Stand für die API neu auf: `rows` unverändert
  // übernehmen, bis auf die eine Zeile, die gerade bearbeitet/gelöscht/neu
  // angelegt wird.
  const persistRows = async (nextRows: CustomerMonthRow[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/customer-months", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          rows: nextRows.map((r) => ({ customerId: r.customerId, projectId: r.projectId, hours: r.hours })),
        }),
      });
      const data = await res?.json?.().catch(() => null);
      if (res?.ok) {
        setRows((data?.rows ?? []).map((r: any) => ({ id: r.id, customerId: r.customerId, projectId: r.projectId, hours: r.hours })));
        return true;
      }
      toast.error(data?.error ?? t("calendar.customerHoursError"));
      return false;
    } catch (err: any) {
      console.error(err);
      toast.error(t("calendar.customerHoursError"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveForm = async () => {
    if (!formCustomerId) return;
    const hours = parseFloat(formHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    const projectId = formProjectId || null;

    // Kombination Kunde+Projekt darf pro Monat nur einmal vorkommen (von der
    // Route mit 409 abgelehnt) — hier vorab prüfen, damit der Nutzer statt
    // einer Fehlermeldung direkt zur bestehenden Zeile geleitet wird.
    const duplicate = rows.find((r) => r.id !== editingId && r.customerId === formCustomerId && (r.projectId ?? null) === projectId);
    if (duplicate) {
      toast.error(t("calendar.customerHoursDuplicate"));
      openEdit(duplicate);
      return;
    }

    const nextRows = editingId
      ? rows.map((r) => (r.id === editingId ? { ...r, customerId: formCustomerId, projectId, hours } : r))
      : [...rows, { id: `new-${Date.now()}`, customerId: formCustomerId, projectId, hours }];

    const ok = await persistRows(nextRows);
    if (ok) {
      toast.success(t("calendar.customerHoursSaved"));
      setModalOpen(false);
    }
  };

  const deleteRow = async (id: string) => {
    const nextRows = rows.filter((r) => r.id !== id);
    const ok = await persistRows(nextRows);
    if (ok) toast.success(t("calendar.customerHoursDeleted"));
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-sm font-medium">
            {t("calendar.customerHours")}: {totalHours > 0 ? `${totalHours.toFixed(1)}h` : t("calendar.noEntries")}
          </span>
          {!locked && customers.length > 0 && (
            <button
              onClick={openAdd}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {t("calendar.addCustomer")}
            </button>
          )}
        </div>

        {customers.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center">{t("calendar.customerHoursNoCustomers")}</p>
        ) : rows.length > 0 ? (
          <div className={`space-y-1.5 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-medium truncate">{customerName(row.customerId)}</span>
                  {row.projectId && <span className="text-muted-foreground truncate">{projectName(row.projectId)}</span>}
                  <span className="text-muted-foreground shrink-0">{row.hours}h</span>
                </div>
                {!locked && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition" title={t("calendar.editCustomer")}><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteRow(row.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition" title={t("calendar.deleteCustomer")}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">{t("calendar.noEntries")}</p>
        )}
      </motion.div>

      <AnimatePresence>
        {modalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-md" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold">{t("calendar.customerHours")}</h3>
                <button onClick={() => setModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-3">
                <select
                  value={formCustomerId}
                  onChange={(e) => { setFormCustomerId(e.target.value); setFormProjectId(""); }}
                  className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                >
                  <option value="">{t("calendar.customerHoursSelectCustomer")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                {formCustomerId && projectsForCustomer(formCustomerId).length > 0 && (
                  <select
                    value={formProjectId}
                    onChange={(e) => setFormProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  >
                    <option value="">{t("calendar.customerHoursSelectProject")}</option>
                    {projectsForCustomer(formCustomerId).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}

                <div>
                  <label htmlFor="cm-hours" className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.customerHoursHoursLabel")}</label>
                  <input
                    id="cm-hours"
                    type="number"
                    min="0"
                    step="0.25"
                    value={formHours}
                    onChange={(e) => setFormHours(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  />
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground font-medium hover:bg-accent transition text-sm">{t("calendar.cancel")}</button>
                  <button
                    onClick={saveForm}
                    disabled={saving || !formCustomerId || !(parseFloat(formHours) > 0)}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 text-sm"
                  >
                    {saving ? t("common.loading") : t("calendar.save")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
