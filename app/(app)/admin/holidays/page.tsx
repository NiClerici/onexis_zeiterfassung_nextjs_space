"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Trash2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface Holiday {
  id: string;
  date: string;
  name: string;
  canton: string | null;
  halfDay: boolean;
}

const CANTON_OPTIONS = [
  { value: "", label: "Kein Kanton (nur Basissatz)" },
  { value: "ZH", label: "Zürich" },
  { value: "BE", label: "Bern" },
  { value: "SO", label: "Solothurn" },
  { value: "AG", label: "Aargau" },
  { value: "LU", label: "Luzern" },
  { value: "UR", label: "Uri" },
  { value: "SZ", label: "Schwyz" },
  { value: "TI", label: "Tessin" },
  { value: "VS", label: "Wallis" },
  { value: "JU", label: "Jura" },
];

function fmtDate(d: string): string {
  const [y, m, dd] = d.split("-");
  return `${dd}.${m}.${y}`;
}

export default function HolidaysAdminPage() {
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const role = (session?.user as any)?.role;

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);

  const [genYear, setGenYear] = useState(() => new Date().getFullYear());
  const [genCanton, setGenCanton] = useState("");
  const [generating, setGenerating] = useState(false);

  const [customDate, setCustomDate] = useState("");
  const [customName, setCustomName] = useState("");
  const [customHalfDay, setCustomHalfDay] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);

  useEffect(() => {
    if (sessionStatus === "authenticated" && role && role !== "owner" && role !== "admin") {
      router.replace("/calendar");
    }
  }, [sessionStatus, role, router]);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/holidays");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setHolidays((data?.holidays ?? []).slice().sort((a: Holiday, b: Holiday) => a.date.localeCompare(b.date)));
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const generateYear = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateYear: genYear, canton: genCanton || undefined }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(`${data?.created ?? 0} Feiertage für ${genYear} angelegt (${data?.total ?? 0} insgesamt geprüft)`);
        fetchHolidays();
      } else {
        toast.error(data?.error ?? "Fehler beim Generieren");
      }
    } catch (err: any) { toast.error("Fehler beim Generieren"); } finally { setGenerating(false); }
  };

  const addCustomHoliday = async () => {
    if (!customDate || !customName.trim()) { toast.error("Datum und Name erforderlich"); return; }
    setAddingCustom(true);
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: customDate, name: customName.trim(), halfDay: customHalfDay }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success("Feiertag hinzugefügt");
        setCustomDate("");
        setCustomName("");
        setCustomHalfDay(false);
        fetchHolidays();
      } else {
        toast.error(data?.error ?? "Fehler beim Hinzufügen");
      }
    } catch (err: any) { toast.error("Fehler beim Hinzufügen"); } finally { setAddingCustom(false); }
  };

  const deleteHoliday = async (id: string) => {
    try {
      const res = await fetch("/api/holidays", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) {
        toast.success("Feiertag gelöscht");
        setHolidays((prev) => prev.filter((h) => h.id !== id));
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? "Fehler beim Löschen");
      }
    } catch (err: any) { toast.error("Fehler beim Löschen"); }
  };

  if (sessionStatus === "loading") return null;
  if (role && role !== "owner" && role !== "admin") return null;

  return (
    <div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 mb-4">
        <CalendarDays className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-display font-semibold tracking-tight">Feiertage</h1>
      </motion.div>

      {/* Generieren */}
      <div className="bg-card rounded-2xl p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Schweizer Feiertage generieren
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Legt den Basissatz (Neujahr, Karfreitag, Ostermontag, Auffahrt, Pfingstmontag, Bundesfeier, Weihnachten, Stephanstag)
          und optional die kantonalen Feiertage für ein Jahr an. Bereits vorhandene Einträge werden übersprungen.
        </p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label htmlFor="holiday-gen-year" className="text-xs font-medium text-muted-foreground mb-1 block">Jahr</label>
            <input id="holiday-gen-year" type="number" min="2020" max="2100" value={genYear} onChange={(e) => setGenYear(parseInt(e.target.value) || genYear)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-28 focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label htmlFor="holiday-gen-canton" className="text-xs font-medium text-muted-foreground mb-1 block">Kanton</label>
            <select id="holiday-gen-canton" value={genCanton} onChange={(e) => setGenCanton(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              {CANTON_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <button onClick={generateYear} disabled={generating} className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
            {generating ? "…" : "Generieren"}
          </button>
        </div>
      </div>

      {/* Manuell ergänzen */}
      <div className="bg-card rounded-2xl p-4 mb-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> Feiertag manuell ergänzen
        </h2>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label htmlFor="holiday-custom-date" className="text-xs font-medium text-muted-foreground mb-1 block">Datum</label>
            <input id="holiday-custom-date" type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label htmlFor="holiday-custom-name" className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <input id="holiday-custom-name" type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="z.B. Betriebsferien" className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <label className="flex items-center gap-2 text-sm pb-1.5">
            <input type="checkbox" checked={customHalfDay} onChange={(e) => setCustomHalfDay(e.target.checked)} />
            Halbtag
          </label>
          <button onClick={addCustomHoliday} disabled={addingCustom} className="px-4 py-1.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50">
            {addingCustom ? "…" : "Hinzufügen"}
          </button>
        </div>
      </div>

      {/* Liste */}
      <div className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3">Alle Feiertage ({holidays.length})</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Lädt…</p>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Noch keine Feiertage angelegt.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-mono text-sm">{fmtDate(h.date)}</span>{" "}
                  <span className="text-sm">{h.name}</span>{" "}
                  {h.halfDay && <span className="text-xs text-muted-foreground">(halber Tag)</span>}{" "}
                  {h.canton ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{h.canton}</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">Basissatz</span>
                  )}
                </div>
                <button onClick={() => deleteHoliday(h.id)} className="p-1.5 rounded-lg hover:bg-accent transition text-muted-foreground hover:text-red-500" title="Löschen">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
