"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { useI18n, securityQuestionKeys } from "@/lib/i18n";
import { User, Briefcase, Calendar, Lock, Download, LogOut, CheckCircle, Shield, TrendingUp, Trash2, AlertTriangle, KeyRound, Plus, CalendarClock, Banknote, Users, Pencil, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface ProfileData {
  firstName: string;
  lastName: string;
  weeklyHours: number;
  pensum: number;
  vacationDays: number;
  startDate: string | null;
  language: string;
  securityQuestions: Array<{ id: string; question: string; answer: string }>;
  standardWeek?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number };
}

interface PensumChange {
  id: string;
  pensum: number;
  weeklyHours: number;
  effectiveFrom: string;
}

interface OvertimePayoutData {
  id: string;
  date: string;
  hours: number;
  note: string | null;
}

interface CustomerData {
  id: string;
  name: string;
  billable: boolean;
}
const clampNumInput = (value: string, min: number, max: number): string => {
  if (value === "") return "";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (num < min) return String(min);
  if (num > max) return String(max);
  return value;
};


export default function ProfilePage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [pensum, setPensum] = useState("");
  const [vacationDays, setVacationDays] = useState("");
  const [startDate, setStartDate] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");

  // Standard week state
  const [stdMon, setStdMon] = useState("0");
  const [stdTue, setStdTue] = useState("0");
  const [stdWed, setStdWed] = useState("0");
  const [stdThu, setStdThu] = useState("0");
  const [stdFri, setStdFri] = useState("0");
  const [stdSat, setStdSat] = useState("0");
  const [stdSun, setStdSun] = useState("0");
  const [savingStdWeek, setSavingStdWeek] = useState(false);

  // Pensum change state
  const [pensumChanges, setPensumChanges] = useState<PensumChange[]>([]);
  const [newPensum, setNewPensum] = useState("");
  const [newWeeklyHours, setNewWeeklyHours] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [basePensum, setBasePensum] = useState<number | null>(null);
  const [baseWeeklyHours, setBaseWeeklyHours] = useState<number | null>(null);
  const [showRetroWarning, setShowRetroWarning] = useState(false);

  // Customer management state
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");

  // Overtime payouts state
  const [overtimePayouts, setOvertimePayouts] = useState<OvertimePayoutData[]>([]);
  const [payoutDate, setPayoutDate] = useState("");
  const [payoutHours, setPayoutHours] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);

  // Security questions editing state
  const [sqEditing, setSqEditing] = useState(false);
  const [sqVerifyCode, setSqVerifyCode] = useState("");
  const [sqVerified, setSqVerified] = useState(false);
  const [sqVerifying, setSqVerifying] = useState(false);
  // Add new question form
  const [addSqKey, setAddSqKey] = useState("");
  const [addSqCustom, setAddSqCustom] = useState("");
  const [addSqAnswer, setAddSqAnswer] = useState("");
  const [showAddSqForm, setShowAddSqForm] = useState(false);

  // Export state
  const [exportType, setExportType] = useState("month");
  const [exportMonth, setExportMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; });
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear());
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setProfile(data ?? null);
        setFirstName(data?.firstName ?? "");
        setLastName(data?.lastName ?? "");
        setWeeklyHours(String(data?.weeklyHours ?? 42));
        setPensum(String(data?.pensum ?? 100));
        setBasePensum(data?.basePensum ?? null);
        setBaseWeeklyHours(data?.baseWeeklyHours ?? null);
        setVacationDays(String(data?.vacationDays ?? 25));
        setStartDate(data?.startDate ? data.startDate.split("T")?.[0] ?? "" : "");
        const sw = data?.standardWeek ?? {};
        setStdMon(String(sw?.mon ?? 0));
        setStdTue(String(sw?.tue ?? 0));
        setStdWed(String(sw?.wed ?? 0));
        setStdThu(String(sw?.thu ?? 0));
        setStdFri(String(sw?.fri ?? 0));
        setStdSat(String(sw?.sat ?? 0));
        setStdSun(String(sw?.sun ?? 0));
      }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  }, []);

  const fetchPensumChanges = useCallback(async () => {
    try {
      const res = await fetch("/api/pensum-changes");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setPensumChanges(data?.changes ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchOvertimePayouts = useCallback(async () => {
    try {
      const res = await fetch("/api/overtime-payouts");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setOvertimePayouts(data?.payouts ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/customers");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setCustomers(data?.customers ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  useEffect(() => { fetchProfile(); fetchPensumChanges(); fetchOvertimePayouts(); fetchCustomers(); }, [fetchProfile, fetchPensumChanges, fetchOvertimePayouts, fetchCustomers]);

  // Check if effectiveFrom is in the past
  useEffect(() => {
    if (effectiveFrom) {
      const selectedDate = new Date(effectiveFrom);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setShowRetroWarning(selectedDate < today);
    } else {
      setShowRetroWarning(false);
    }
  }, [effectiveFrom]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName?.trim?.(), lastName: lastName?.trim?.(),
          weeklyHours: parseFloat(weeklyHours) || 42,
          pensum: parseFloat(pensum) || 100,
          vacationDays: parseFloat(vacationDays) || 25,
          startDate: startDate || null,
        }),
      });
      if (res?.ok) { toast.success(t("profile.saved")); await fetchProfile(); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const changeCode = async () => {
    if (!currentCode || !newCode || newCode.length < 4 || newCode.length > 8) {
      toast.error(t("register.error.codeFormat"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCode, newCode }),
      });
      if (res?.ok) { toast.success(t("profile.saved")); setCurrentCode(""); setNewCode(""); }
      else { const data = await res?.json?.().catch(() => ({})); toast.error(data?.error ?? t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const saveStandardWeek = async () => {
    setSavingStdWeek(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standardWeek: {
            mon: Math.max(0, Math.min(24, parseFloat(stdMon) || 0)),
            tue: Math.max(0, Math.min(24, parseFloat(stdTue) || 0)),
            wed: Math.max(0, Math.min(24, parseFloat(stdWed) || 0)),
            thu: Math.max(0, Math.min(24, parseFloat(stdThu) || 0)),
            fri: Math.max(0, Math.min(24, parseFloat(stdFri) || 0)),
            sat: Math.max(0, Math.min(24, parseFloat(stdSat) || 0)),
            sun: Math.max(0, Math.min(24, parseFloat(stdSun) || 0)),
          },
        }),
      });
      if (res?.ok) { toast.success(t("profile.stdWeekSaved")); await fetchProfile(); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSavingStdWeek(false); }
  };

  const addPensumChange = async () => {
    if (!newPensum || !newWeeklyHours || !effectiveFrom) {
      toast.error(t("profile.error"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/pensum-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pensum: parseFloat(newPensum), weeklyHours: parseFloat(newWeeklyHours), effectiveFrom }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        setNewPensum("");
        setNewWeeklyHours("");
        setEffectiveFrom("");
        setShowRetroWarning(false);
        await fetchPensumChanges();
        await fetchProfile();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const deletePensumChange = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/pensum-changes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        await fetchPensumChanges();
        await fetchProfile();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const addOvertimePayout = async () => {
    const hours = parseFloat(payoutHours);
    if (!payoutDate || !hours || hours <= 0) {
      toast.error(t("profile.error"));
      return;
    }
    setSavingPayout(true);
    try {
      const res = await fetch("/api/overtime-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: payoutDate, hours, note: payoutNote }),
      });
      if (res?.ok) {
        toast.success(t("profile.payoutSaved"));
        setPayoutDate("");
        setPayoutHours("");
        setPayoutNote("");
        await fetchOvertimePayouts();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSavingPayout(false); }
  };

  const deleteOvertimePayout = async (id: string) => {
    setSavingPayout(true);
    try {
      const res = await fetch("/api/overtime-payouts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        await fetchOvertimePayouts();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSavingPayout(false); }
  };

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return;
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCustomerName.trim() }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(t("profile.customerSaved"));
        setNewCustomerName("");
        await fetchCustomers();
      } else { toast.error(data?.error ?? t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); }
  };

  const toggleCustomerBillable = async (customer: CustomerData) => {
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: customer.id, billable: !customer.billable }),
      });
      if (res?.ok) { await fetchCustomers(); }
      else { toast.error(t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); }
  };

  const startEditCustomer = (customer: CustomerData) => {
    setEditingCustomerId(customer.id);
    setEditCustomerName(customer.name);
  };

  const saveEditCustomer = async () => {
    if (!editingCustomerId || !editCustomerName.trim()) return;
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCustomerId, name: editCustomerName.trim() }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(t("profile.customerSaved"));
        setEditingCustomerId(null);
        await fetchCustomers();
      } else { toast.error(data?.error ?? t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); }
  };

  const deleteCustomer = async (id: string) => {
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) { toast.success(t("profile.customerDeleted")); await fetchCustomers(); }
      else { toast.error(t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); }
  };

  const verifySqCode = async () => {
    if (!sqVerifyCode || sqVerifyCode.length < 4) return;
    setSqVerifying(true);
    try {
      const res = await fetch("/api/profile/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: sqVerifyCode }),
      });
      if (res?.ok) {
        setSqVerified(true);
        setSqVerifyCode("");
      } else {
        toast.error(t("login.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("common.error")); } finally { setSqVerifying(false); }
  };

  const deleteSecurityQuestion = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/security-questions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        await fetchProfile();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const addSecurityQuestion = async () => {
    const question = addSqKey === "sq.custom" ? addSqCustom : t(addSqKey);
    if (!question || !addSqAnswer) {
      toast.error(t("register.error.required"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile/security-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer: addSqAnswer }),
      });
      if (res?.ok) {
        toast.success(t("profile.saved"));
        setAddSqKey(""); setAddSqCustom(""); setAddSqAnswer("");
        setShowAddSqForm(false);
        await fetchProfile();
      } else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const handleExport = async () => {
    let url = "/api/export?";
    if (exportType === "month") {
      const [y, m] = (exportMonth ?? "").split("-");
      url += `type=month&year=${y}&month=${m}`;
    } else if (exportType === "year") {
      url += `type=year&year=${exportYear}`;
    } else {
      url += `type=custom&from=${exportFrom}&to=${exportTo}`;
    }
    try {
      const res = await fetch(url);
      if (res?.ok) {
        const blob = await res?.blob?.();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob ?? new Blob());
        a.download = `zeiterfassung_${exportType}_${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err: any) { console.error(err); }
  };

  if (loading) return <div className="text-center py-12 text-muted-foreground text-sm">{t("common.loading")}</div>;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4">{t("profile.title")}</h1>
      </motion.div>

      {/* Personal Info */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><User className="w-4 h-4 text-primary" /> {t("profile.personalInfo")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.firstName")}</label><input type="text" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.lastName")}</label><input type="text" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
        </div>
      </motion.div>

      {/* Work Settings */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Briefcase className="w-4 h-4 text-primary" /> {t("profile.workSettings")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.weeklyHours")}</label><input type="number" step="0.5" min="0" max="100" value={weeklyHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWeeklyHours(clampNumInput(e?.target?.value ?? "", 0, 100))} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.pensum")}</label><input type="number" step="5" min="0" max="200" value={pensum} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPensum(clampNumInput(e?.target?.value ?? "", 0, 200))} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.vacationDays")}</label><input type="number" step="0.5" min="0" max="100" value={vacationDays} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVacationDays(clampNumInput(e?.target?.value ?? "", 0, 100))} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("register.startDate")}</label><input type="date" value={startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
        </div>
        <button onClick={saveProfile} disabled={saving} className="mt-3 w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5">
          {saving ? t("common.loading") : <><CheckCircle className="w-4 h-4" /> {t("profile.save")}</>}
        </button>
      </motion.div>

      {/* Pensum Change */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> {t("profile.pensumChange")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.pensumChangeDesc")}</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.effectiveFrom")}</label>
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.newPensum")}</label>
            <input type="number" step="5" min="0" max="200" value={newPensum} onChange={(e) => setNewPensum(clampNumInput(e.target.value, 0, 200))} placeholder="80" className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.newWeeklyHours")}</label>
            <input type="number" step="0.5" min="0" max="100" value={newWeeklyHours} onChange={(e) => setNewWeeklyHours(clampNumInput(e.target.value, 0, 100))} placeholder="42" className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
        </div>
        {showRetroWarning && (
          <div className="flex items-start gap-2 p-3 mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-200">{t("profile.retroactiveWarning")}</p>
          </div>
        )}
        <button onClick={addPensumChange} disabled={saving || !effectiveFrom || !newPensum || !newWeeklyHours} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
          {saving ? t("common.loading") : t("profile.addPensumChange")}
        </button>

        {/* History */}
        {pensumChanges.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <h3 className="text-xs font-medium text-muted-foreground mb-2">{t("profile.pensumHistory")}</h3>
            <div className="space-y-1.5">
              {basePensum !== null && baseWeeklyHours !== null && (
                <div className="flex items-center justify-between bg-secondary/60 rounded-xl px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{`bis ${new Date(pensumChanges[0].effectiveFrom).toLocaleDateString('de-CH')}`}</span>
                    <span className="text-muted-foreground ml-2">{basePensum}% · {baseWeeklyHours}h/Woche</span>
                  </div>
                </div>
              )}
              {pensumChanges.map((pc) => (
                <div key={pc.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{new Date(pc.effectiveFrom).toLocaleDateString('de-CH')}</span>
                    <span className="text-muted-foreground ml-2">{pc.pensum}% · {pc.weeklyHours}h/Woche</span>
                  </div>
                  <button onClick={() => deletePensumChange(pc.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Overtime Payouts */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.125 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><Banknote className="w-4 h-4 text-primary" /> {t("profile.overtimePayouts")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.overtimePayoutsDesc")}</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.payoutDate")}</label>
            <input type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.payoutHours")}</label>
            <input type="number" step="0.5" min="0" max="9999" value={payoutHours} onChange={(e) => setPayoutHours(clampNumInput(e.target.value, 0, 9999))} placeholder="40" className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">{t("profile.payoutNote")}</label>
            <input type="text" value={payoutNote} onChange={(e) => setPayoutNote(e.target.value)} placeholder={t("profile.payoutNotePlaceholder")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
          </div>
        </div>
        <button onClick={addOvertimePayout} disabled={savingPayout || !payoutDate || !payoutHours} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
          {savingPayout ? t("common.loading") : t("profile.addPayout")}
        </button>

        {/* Payout History */}
        {overtimePayouts.length > 0 ? (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="space-y-1.5">
              {overtimePayouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{new Date(p.date).toLocaleDateString('de-CH')}</span>
                    <span className="text-muted-foreground ml-2">{p.hours}h</span>
                    {p.note && <span className="text-muted-foreground ml-2 text-xs">— {p.note}</span>}
                  </div>
                  <button onClick={() => deleteOvertimePayout(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0 ml-2"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground text-center">{t("profile.noPayouts")}</p>
        )}
      </motion.div>

      {/* Standard Week Template */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" /> {t("profile.standardWeek")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.standardWeekDesc")}</p>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-3">
          {([
            { key: "weekday.mo", val: stdMon, set: setStdMon },
            { key: "weekday.tu", val: stdTue, set: setStdTue },
            { key: "weekday.we", val: stdWed, set: setStdWed },
            { key: "weekday.th", val: stdThu, set: setStdThu },
            { key: "weekday.fr", val: stdFri, set: setStdFri },
            { key: "weekday.sa", val: stdSat, set: setStdSat },
            { key: "weekday.su", val: stdSun, set: setStdSun },
          ] as const).map((d) => (
            <div key={d.key}>
              <label className="text-xs text-muted-foreground mb-1 block text-center">{t(d.key)}</label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="24"
                value={d.val}
                onChange={(e) => d.set(clampNumInput(e.target.value, 0, 24))}
                className="w-full px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
          <span>{t("profile.stdWeekSum")}:</span>
          <span className="font-mono font-medium text-foreground">
            {(
              (parseFloat(stdMon) || 0) +
              (parseFloat(stdTue) || 0) +
              (parseFloat(stdWed) || 0) +
              (parseFloat(stdThu) || 0) +
              (parseFloat(stdFri) || 0) +
              (parseFloat(stdSat) || 0) +
              (parseFloat(stdSun) || 0)
            ).toFixed(2)}h
          </span>
        </div>
        <button onClick={saveStandardWeek} disabled={savingStdWeek} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5">
          {savingStdWeek ? t("common.loading") : <><CheckCircle className="w-4 h-4" /> {t("profile.stdWeekSave")}</>}
        </button>
      </motion.div>

      {/* Customer Management */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> {t("profile.customers")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.customersDesc")}</p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
            placeholder={t("profile.customerNamePlaceholder")}
            className="flex-1 px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
          <button
            onClick={addCustomer}
            disabled={savingCustomer || !newCustomerName.trim()}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> {t("profile.addCustomer")}
          </button>
        </div>

        {customers.length > 0 ? (
          <div className="space-y-1.5">
            {customers.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm gap-2">
                {editingCustomerId === c.id ? (
                  <>
                    <input
                      type="text"
                      value={editCustomerName}
                      onChange={(e) => setEditCustomerName(e.target.value)}
                      className="flex-1 px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      autoFocus
                    />
                    <button onClick={saveEditCustomer} disabled={savingCustomer} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition"><CheckCircle className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingCustomerId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="font-medium flex-1 min-w-0 truncate">{c.name}</span>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
                      <input type="checkbox" checked={c.billable} onChange={() => toggleCustomerBillable(c)} className="accent-primary" />
                      {t("profile.billable")}
                    </label>
                    <button onClick={() => startEditCustomer(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteCustomer(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">{t("profile.noCustomers")}</p>
        )}
      </motion.div>

      {/* Security Questions */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> {t("profile.securityQuestions")}</h2>
        
        {/* Show current questions */}
        {profile?.securityQuestions && profile.securityQuestions.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {profile.securityQuestions.map((sq, i) => {
              // Translate key like "sq.pet" to actual text, or use as-is if it's a custom question
              const questionText = sq.question?.startsWith?.("sq.") ? t(sq.question) : sq.question;
              return (
                <div key={sq.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div><span className="text-muted-foreground">{i + 1}.</span> <span className="font-medium">{questionText}</span></div>
                    <div className="text-muted-foreground text-xs mt-0.5">{sq.answer}</div>
                  </div>
                  {sqVerified && (
                    <button onClick={() => deleteSecurityQuestion(sq.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0 ml-2"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!sqEditing ? (
          <button onClick={() => setSqEditing(true)} className="w-full py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition">
            {t("profile.editSecurityQuestions")}
          </button>
        ) : !sqVerified ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("profile.verifyCode")}</p>
            <input type="password" maxLength={8} value={sqVerifyCode} onChange={(e) => setSqVerifyCode(e.target.value)} placeholder={t("login.codePlaceholder")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
            <div className="flex gap-2">
              <button onClick={() => { setSqEditing(false); setSqVerifyCode(""); }} className="flex-1 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition">{t("calendar.cancel")}</button>
              <button onClick={verifySqCode} disabled={sqVerifying || sqVerifyCode.length < 4} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                {sqVerifying ? t("common.loading") : t("profile.verifyCode")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Add new question form */}
            {!showAddSqForm ? (
              <button onClick={() => setShowAddSqForm(true)} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4" /> {t("profile.addQuestion")}
              </button>
            ) : (
              <div className="bg-secondary rounded-xl p-3 space-y-2">
                <select value={addSqKey} onChange={(e) => setAddSqKey(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition">
                  <option value="">{t("register.securityQuestion")}</option>
                  {securityQuestionKeys.map((key) => <option key={key} value={key}>{t(key)}</option>)}
                </select>
                {addSqKey === "sq.custom" && <input type="text" value={addSqCustom} onChange={(e) => setAddSqCustom(e.target.value)} placeholder={t("register.customQuestion")} className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />}
                <input type="text" value={addSqAnswer} onChange={(e) => setAddSqAnswer(e.target.value)} placeholder={t("register.securityAnswer")} className="w-full px-3 py-2 rounded-xl bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowAddSqForm(false); setAddSqKey(""); setAddSqCustom(""); setAddSqAnswer(""); }} className="flex-1 py-2 rounded-xl bg-card text-foreground text-sm font-medium hover:bg-accent transition">{t("calendar.cancel")}</button>
                  <button onClick={addSecurityQuestion} disabled={saving || !addSqKey || !addSqAnswer} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
                    {saving ? t("common.loading") : t("profile.save")}
                  </button>
                </div>
              </div>
            )}
            <button onClick={() => { setSqEditing(false); setSqVerified(false); setShowAddSqForm(false); }} className="w-full py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition">{t("calendar.cancel")}</button>
          </div>
        )}
      </motion.div>

      {/* Change Code */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> {t("profile.changeCode")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("profile.currentCode")}</label><input type="password" maxLength={8} value={currentCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentCode(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("profile.newCode")}</label><input type="password" maxLength={8} value={newCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCode(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
        </div>
        <button onClick={changeCode} disabled={saving || !currentCode || !newCode} className="mt-3 w-full py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50">{t("profile.changeCode")}</button>
      </motion.div>

      {/* CSV Export */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Download className="w-4 h-4 text-primary" /> {t("profile.export")}</h2>
        <div className="flex gap-2 mb-3">
          {["month", "year", "custom"].map((et: string) => (
            <button key={et} onClick={() => setExportType(et)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${exportType === et ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-accent'}`}>
              {t(`profile.export${et.charAt(0).toUpperCase() + et.slice(1)}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap mb-3">
          {exportType === "month" && <input type="month" value={exportMonth} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportMonth(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />}
          {exportType === "year" && <input type="number" min="2020" max="2030" value={exportYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportYear(parseInt(e?.target?.value) || 2026)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary/30" />}
          {exportType === "custom" && (
            <>
              <input type="date" value={exportFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportFrom(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <input type="date" value={exportTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportTo(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </>
          )}
        </div>
        <button onClick={handleExport} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5"><Download className="w-4 h-4" /> {t("profile.exportButton")}</button>
      </motion.div>

      {/* Logout */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="w-full py-3 rounded-2xl bg-card text-destructive text-sm font-medium hover:bg-destructive/5 transition flex items-center justify-center gap-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <LogOut className="w-4 h-4" /> {t("profile.logout")}
        </button>
      </motion.div>
    </div>
  );
}