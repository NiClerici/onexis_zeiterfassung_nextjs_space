"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut, useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { User, Briefcase, Lock, Download, LogOut, CheckCircle, Shield, TrendingUp, Trash2, AlertTriangle, Plus, CalendarClock, Banknote, Users, Pencil, X, FileSpreadsheet, FileText, Upload, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import { downloadBlob } from "@/lib/download-blob";
import { PensumPreview } from "@/components/pensum-preview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ProfileData {
  firstName: string;
  lastName: string;
  weeklyHours: number;
  pensum: number;
  vacationDays: number;
  startDate: string | null;
  kuerzel?: string | null;
  language: string;
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
  hourlyRate: number | null;
}

interface ProjectData {
  id: string;
  customerId: string;
  name: string;
  hourlyRate: number | null;
  budgetHours: number | null;
  externalRef: string | null;
  active: boolean;
}
const clampNumInput = (value: string, min: number, max: number): string => {
  if (value === "") return "";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (num < min) return String(min);
  if (num > max) return String(max);
  return value;
};


interface TeamMemberOption {
  userId: string;
  firstName: string;
  lastName: string;
}

export default function ProfilePage() {
  const { t } = useI18n();
  const { data: session } = useSession() || {};
  const role = (session?.user as any)?.role as "owner" | "admin" | "manager" | "member" | undefined;
  const isOrgAdmin = role === "owner" || role === "admin";
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [pensum, setPensum] = useState("");
  const [vacationDays, setVacationDays] = useState("");
  const [startDate, setStartDate] = useState("");
  const [kuerzel, setKuerzel] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

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
  const [newCustomerRate, setNewCustomerRate] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [customerPendingDelete, setCustomerPendingDelete] = useState<CustomerData | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerRate, setEditCustomerRate] = useState("");

  // Project management state (MIGRATION.md Punkt 5)
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [newProjectCustomerId, setNewProjectCustomerId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRate, setNewProjectRate] = useState("");
  const [newProjectBudget, setNewProjectBudget] = useState("");
  const [newProjectExternalRef, setNewProjectExternalRef] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<ProjectData | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectRate, setEditProjectRate] = useState("");
  const [editProjectBudget, setEditProjectBudget] = useState("");
  const [editProjectExternalRef, setEditProjectExternalRef] = useState("");

  // Kundenstunden monatlich (Migration/Übersicht, unabhängig von der
  // Tageserfassung). cmDirectHours: Stunden direkt beim Kunden (CustomerMonth
  // ohne projectId), cmProjectHours: Stunden pro Projekt (mit projectId) —
  // beides kann parallel befüllt sein, siehe app/api/team/route.ts Kommentar
  // zu CustomerMonth-Aggregation.
  const [cmMonth, setCmMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; });
  const [cmDirectHours, setCmDirectHours] = useState<Record<string, string>>({});
  const [cmProjectHours, setCmProjectHours] = useState<Record<string, string>>({});
  const [cmExpanded, setCmExpanded] = useState<Record<string, boolean>>({});
  const [cmArbeitsstunden, setCmArbeitsstunden] = useState(0);
  const [cmLoading, setCmLoading] = useState(false);
  const [cmSaving, setCmSaving] = useState(false);

  // Overtime payouts state
  const [overtimePayouts, setOvertimePayouts] = useState<OvertimePayoutData[]>([]);
  const [payoutDate, setPayoutDate] = useState("");
  const [payoutHours, setPayoutHours] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);

  // Export state
  const [exportType, setExportType] = useState("month");
  const [exportMonth, setExportMonth] = useState(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; });
  const [exportYear, setExportYear] = useState(() => new Date().getFullYear());
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  // Bereich (MIGRATION.md Punkt 7) — "person"/"org" nur für admin/owner
  // sichtbar; Personen-Liste kommt aus /api/admin/team (bereits admin/owner-
  // gated), deshalb hier bewusst kein Manager-Zugriff auf fremde Exporte —
  // eine Team-Mitgliederliste für manager gibt es erst mit Punkt 8 (Teamsicht).
  const [exportScope, setExportScope] = useState<"self" | "person" | "org">("self");
  const [exportTargetUserId, setExportTargetUserId] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [exportingArgControl, setExportingArgControl] = useState(false);
  const [payrollYear, setPayrollYear] = useState(() => new Date().getFullYear());
  const [payrollMonth, setPayrollMonth] = useState(() => new Date().getMonth() + 1);
  const [exportingPayroll, setExportingPayroll] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    imported: number; skippedExisting: number; skippedLocked: number; totalRows: number;
    dateFrom: string | null; dateTo: string | null;
    importedCustomerMonths: number; skippedExistingCustomerMonths: number; skippedLockedCustomerMonths: number; totalCustomerMonthRows: number;
    errors: { rowNumber: number; message: string; sheet: string }[];
  } | null>(null);

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
        setKuerzel(data?.kuerzel ?? "");
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

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setProjects(data?.projects ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/team");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setTeamMembers((data?.members ?? []).map((m: any) => ({ userId: m.userId, firstName: m.firstName, lastName: m.lastName })));
      }
    } catch (err: any) { console.error(err); }
  }, []);

  const fetchCustomerMonth = useCallback(async (month: string) => {
    setCmLoading(true);
    try {
      const [y, m] = month.split("-");
      const res = await fetch(`/api/customer-months?year=${y}&month=${parseInt(m, 10)}`);
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        const direct: Record<string, string> = {};
        const proj: Record<string, string> = {};
        for (const r of data?.rows ?? []) {
          if (r.projectId) proj[r.projectId] = String(r.hours);
          else direct[r.customerId] = String(r.hours);
        }
        setCmDirectHours(direct);
        setCmProjectHours(proj);
        setCmArbeitsstunden(data?.arbeitsstunden ?? 0);
      }
    } catch (err: any) { console.error(err); } finally { setCmLoading(false); }
  }, []);

  useEffect(() => { fetchProfile(); fetchPensumChanges(); fetchOvertimePayouts(); fetchCustomers(); fetchProjects(); }, [fetchProfile, fetchPensumChanges, fetchOvertimePayouts, fetchCustomers, fetchProjects]);

  useEffect(() => { if (isOrgAdmin) fetchTeamMembers(); }, [isOrgAdmin, fetchTeamMembers]);

  useEffect(() => { fetchCustomerMonth(cmMonth); }, [cmMonth, fetchCustomerMonth]);

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
          // startDate NICHT mitschicken — wirkt in sollStundenTag() (lib/
          // calc.ts) spiegelbildlich zu exitDate und ist deshalb wie dieses
          // nur noch über /admin/team änderbar (siehe app/api/profile/route.ts).
          kuerzel: kuerzel?.trim?.() || null,
        }),
      });
      if (res?.ok) { toast.success(t("profile.saved")); await fetchProfile(); }
      else { toast.error(t("profile.error")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (newPassword !== confirmNewPassword) {
      toast.error(t("register.error.passwordMismatch"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res?.ok) { toast.success(t("profile.saved")); setCurrentPassword(""); setNewPassword(""); setConfirmNewPassword(""); }
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
        body: JSON.stringify({ name: newCustomerName.trim(), hourlyRate: newCustomerRate || undefined }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(t("profile.customerSaved"));
        setNewCustomerName("");
        setNewCustomerRate("");
        await fetchCustomers();
      } else { toast.error(data?.error ?? t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); }
  };

  const startEditCustomer = (customer: CustomerData) => {
    setEditingCustomerId(customer.id);
    setEditCustomerName(customer.name);
    setEditCustomerRate(customer.hourlyRate != null ? String(customer.hourlyRate) : "");
  };

  const saveEditCustomer = async () => {
    if (!editingCustomerId || !editCustomerName.trim()) return;
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCustomerId, name: editCustomerName.trim(), hourlyRate: editCustomerRate || null }),
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
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) { toast.success(t("profile.customerDeleted")); await fetchCustomers(); }
      // data?.error trägt bei 409 die konkrete Zahl betroffener Zeiteinträge/
      // Monatswerte (siehe lib/entity-deletion.ts) — nicht durch die generische
      // Meldung ersetzen, sonst verschwindet genau die Information, die den
      // Nutzer davon abhält, es einfach nochmal zu versuchen.
      else { toast.error(data?.error ?? t("profile.customerError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerError")); } finally { setSavingCustomer(false); setCustomerPendingDelete(null); }
  };

  const addProject = async () => {
    if (!newProjectCustomerId || !newProjectName.trim()) return;
    setSavingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: newProjectCustomerId,
          name: newProjectName.trim(),
          hourlyRate: newProjectRate || undefined,
          budgetHours: newProjectBudget || undefined,
          externalRef: newProjectExternalRef || undefined,
        }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(t("profile.projectSaved"));
        setNewProjectName(""); setNewProjectRate(""); setNewProjectBudget(""); setNewProjectExternalRef("");
        await fetchProjects();
      } else { toast.error(data?.error ?? t("profile.projectError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.projectError")); } finally { setSavingProject(false); }
  };

  const startEditProject = (project: ProjectData) => {
    setEditingProjectId(project.id);
    setEditProjectName(project.name);
    setEditProjectRate(project.hourlyRate != null ? String(project.hourlyRate) : "");
    setEditProjectBudget(project.budgetHours != null ? String(project.budgetHours) : "");
    setEditProjectExternalRef(project.externalRef ?? "");
  };

  const saveEditProject = async () => {
    if (!editingProjectId || !editProjectName.trim()) return;
    setSavingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingProjectId,
          name: editProjectName.trim(),
          hourlyRate: editProjectRate || null,
          budgetHours: editProjectBudget || null,
          externalRef: editProjectExternalRef || null,
        }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(t("profile.projectSaved"));
        setEditingProjectId(null);
        await fetchProjects();
      } else { toast.error(data?.error ?? t("profile.projectError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.projectError")); } finally { setSavingProject(false); }
  };

  const toggleProjectActive = async (project: ProjectData) => {
    setSavingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.id, active: !project.active }),
      });
      if (res?.ok) { await fetchProjects(); }
      else { toast.error(t("profile.projectError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.projectError")); } finally { setSavingProject(false); }
  };

  const deleteProject = async (id: string) => {
    setSavingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) { toast.success(t("profile.projectDeleted")); await fetchProjects(); }
      else { toast.error(data?.error ?? t("profile.projectError")); }
    } catch (err: any) { console.error(err); toast.error(t("profile.projectError")); } finally { setSavingProject(false); setProjectPendingDelete(null); }
  };

  const toggleCmExpanded = (customerId: string) => setCmExpanded((prev) => ({ ...prev, [customerId]: !prev[customerId] }));

  const cmTotalEntered =
    Object.values(cmDirectHours).reduce((s, v) => s + (parseFloat(v) || 0), 0) +
    Object.values(cmProjectHours).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const saveCustomerMonth = async () => {
    setCmSaving(true);
    try {
      const [y, m] = cmMonth.split("-");
      const rows: { customerId: string; projectId?: string; hours: number }[] = [];
      for (const c of customers) {
        const h = parseFloat(cmDirectHours[c.id]);
        if (Number.isFinite(h) && h > 0) rows.push({ customerId: c.id, hours: h });
      }
      for (const p of projects) {
        const h = parseFloat(cmProjectHours[p.id]);
        if (Number.isFinite(h) && h > 0) rows.push({ customerId: p.customerId, projectId: p.id, hours: h });
      }
      const res = await fetch("/api/customer-months", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: parseInt(y, 10), month: parseInt(m, 10), rows }),
      });
      if (res?.ok) {
        toast.success(t("profile.customerMonthSaved"));
        await fetchCustomerMonth(cmMonth);
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error || t("profile.customerMonthError"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.customerMonthError")); } finally { setCmSaving(false); }
  };

  // Zeitraum-Query-String, gemeinsam für alle drei Export-Endpunkte
  // (MIGRATION.md Punkt 7) — dieselbe type=month|year|custom-Logik wie schon
  // vorher, nur extrahiert statt dreimal dupliziert.
  const buildRangeQuery = () => {
    if (exportType === "month") {
      const [y, m] = (exportMonth ?? "").split("-");
      return `type=month&year=${y}&month=${m}`;
    } else if (exportType === "year") {
      return `type=year&year=${exportYear}`;
    }
    return `type=custom&from=${exportFrom}&to=${exportTo}`;
  };

  // scope=person/org nur für admin/owner sichtbar (siehe exportScope-Deklaration).
  const buildScopeQuery = () => {
    if (exportScope === "org") return "&scope=org";
    if (exportScope === "person" && exportTargetUserId) return `&scope=person&userId=${exportTargetUserId}`;
    return "";
  };

  const handleExport = async () => {
    const url = `/api/export?${buildRangeQuery()}${buildScopeQuery()}`;
    await downloadBlob(url, `zeiterfassung_${exportType}_${Date.now()}.xlsx`, (msg) => toast.error(msg), t("profile.error"));
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportFile(e?.target?.files?.[0] ?? null);
    setImportPreview(null);
    setImportDone(false);
  };

  // Zwei Aufrufe derselben Route (Betrieb.md Punkt 4): erst "preview"
  // (schreibt nichts), erst nach Bestätigung "commit" — beide mit derselben
  // Datei aus dem State, damit man nicht zweimal auswählen muss.
  const runImport = async (mode: "preview" | "commit") => {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.set("file", importFile);
      fd.set("mode", mode);
      const res = await fetch("/api/import/timesheet", { method: "POST", body: fd });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        setImportPreview(data);
        if (mode === "commit") {
          setImportDone(true);
          toast.success(t("profile.importDone", { count: String(data?.imported ?? 0) }));
        }
      } else {
        toast.error(data?.error ?? t("profile.importFileError"));
      }
    } catch (err: any) {
      console.error(err);
      toast.error(t("profile.importFileError"));
    } finally {
      setImportLoading(false);
    }
  };

  const handleArgControlExport = async () => {
    setExportingArgControl(true);
    const url = `/api/export/arg-control?${buildRangeQuery()}${buildScopeQuery()}`;
    await downloadBlob(url, `arg_kontrollexport_${Date.now()}.xlsx`, (msg) => toast.error(msg), t("profile.error"));
    setExportingArgControl(false);
  };

  const handlePayrollExport = async () => {
    setExportingPayroll(true);
    const url = `/api/export/payroll?year=${payrollYear}&month=${payrollMonth}`;
    await downloadBlob(url, `lohnexport_${payrollYear}-${String(payrollMonth).padStart(2, "0")}.csv`, (msg) => toast.error(msg), t("profile.error"));
    setExportingPayroll(false);
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
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground mb-1 block">{t("register.startDate")}</label>
            <input type="date" value={startDate} disabled title={t("profile.startDateReadOnly")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm text-muted-foreground cursor-not-allowed" />
            <p className="text-[11px] text-muted-foreground mt-1">{t("profile.startDateReadOnly")}</p>
          </div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("profile.kuerzel")}</label><input type="text" maxLength={10} value={kuerzel} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKuerzel(e?.target?.value ?? "")} placeholder={t("profile.kuerzelPlaceholder")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
        </div>
        <PensumPreview weeklyHours={weeklyHours} pensum={pensum} />
        <button onClick={saveProfile} disabled={saving} className="mt-3 w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5">
          {saving ? t("common.loading") : <><CheckCircle className="w-4 h-4" /> {t("profile.save")}</>}
        </button>
      </motion.div>

      {/* Pensum Change */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> {t("profile.pensumChange")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.pensumChangeDesc")}</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="min-w-0">
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
        <PensumPreview weeklyHours={newWeeklyHours} pensum={newPensum} />
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
                    <span className="text-muted-foreground ml-2">{basePensum}% · {baseWeeklyHours}h (100%){basePensum !== 100 ? ` → ${((baseWeeklyHours ?? 0) * (basePensum ?? 100) / 100).toFixed(1)}h/Woche` : ""}</span>
                  </div>
                </div>
              )}
              {pensumChanges.map((pc) => (
                <div key={pc.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{new Date(pc.effectiveFrom).toLocaleDateString('de-CH')}</span>
                    <span className="text-muted-foreground ml-2">{pc.pensum}% · {pc.weeklyHours}h (100%){pc.pensum !== 100 ? ` → ${(pc.weeklyHours * pc.pensum / 100).toFixed(1)}h/Woche` : ""}</span>
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
          <div className="min-w-0">
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
        {/* 7 Spalten statt 4+3 — die 4er-Reihe liess in der zweiten Reihe
            eine leere Luecke stehen (Kalender-Monatsraster geht mit demselben
            grid-cols-7 als Vorbild). Enger Gap/Padding auf Mobile, weil bei
            16px Feldschrift (iOS-Zoom-Fix) sonst der letzte Wochentag knapp
            wird. */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-3">
          {([
            { key: "weekday.mo", val: stdMon, set: setStdMon },
            { key: "weekday.tu", val: stdTue, set: setStdTue },
            { key: "weekday.we", val: stdWed, set: setStdWed },
            { key: "weekday.th", val: stdThu, set: setStdThu },
            { key: "weekday.fr", val: stdFri, set: setStdFri },
            { key: "weekday.sa", val: stdSat, set: setStdSat },
            { key: "weekday.su", val: stdSun, set: setStdSun },
          ] as const).map((d) => (
            <div key={d.key} className="min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block text-center">{t(d.key)}</label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="24"
                value={d.val}
                onChange={(e) => d.set(clampNumInput(e.target.value, 0, 24))}
                className="w-full px-1 sm:px-2 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
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

        {/* HARDENING.md C2: bei 375px erzwang das feste w-28-Zahlenfeld
            plus der nicht umbrechende Button einen Zeilenumbruch-freien
            Rest fürs Namensfeld — die Zeile lief auf ~425px über den
            Viewport. flex-wrap statt eines starren flex-Rows, dasselbe
            Muster wie die übrigen Toolbar-Zeilen dieser Seite
            (z.B. Zeile 905 „flex gap-3 flex-wrap"). */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text"
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
            placeholder={t("profile.customerNamePlaceholder")}
            className="flex-1 min-w-[160px] px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
          <input
            type="number"
            min="0"
            step="5"
            value={newCustomerRate}
            onChange={(e) => setNewCustomerRate(e.target.value)}
            placeholder={t("profile.hourlyRate")}
            className="w-28 px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
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
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={editCustomerRate}
                      onChange={(e) => setEditCustomerRate(e.target.value)}
                      placeholder={t("profile.hourlyRate")}
                      className="w-24 px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                    <button onClick={saveEditCustomer} disabled={savingCustomer} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition"><CheckCircle className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingCustomerId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="font-medium flex-1 min-w-0 truncate">{c.name}{c.hourlyRate != null && <span className="text-muted-foreground font-normal"> · {c.hourlyRate.toFixed(0)} CHF/h</span>}</span>
                    <button onClick={() => startEditCustomer(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setCustomerPendingDelete(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">{t("profile.noCustomers")}</p>
        )}
      </motion.div>

      <AlertDialog open={!!customerPendingDelete} onOpenChange={(open) => { if (!open) setCustomerPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.deleteCustomerTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {customerPendingDelete && t("profile.deleteCustomerConfirm", { name: customerPendingDelete.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("profile.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingCustomer}
              onClick={(e) => { e.preventDefault(); if (customerPendingDelete) deleteCustomer(customerPendingDelete.id); }}
            >
              {t("profile.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Project Management (MIGRATION.md Punkt 5) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><Banknote className="w-4 h-4 text-primary" /> {t("profile.projects")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.projectsDesc")}</p>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <select
            value={newProjectCustomerId}
            onChange={(e) => setNewProjectCustomerId(e.target.value)}
            className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          >
            <option value="">{t("profile.selectCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder={t("profile.projectNamePlaceholder")}
            className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
          <input
            type="number"
            min="0"
            step="5"
            value={newProjectRate}
            onChange={(e) => setNewProjectRate(e.target.value)}
            placeholder={t("profile.hourlyRate")}
            className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
          <input
            type="number"
            min="0"
            step="5"
            value={newProjectBudget}
            onChange={(e) => setNewProjectBudget(e.target.value)}
            placeholder={t("profile.budgetHours")}
            className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
          />
          <input
            type="text"
            value={newProjectExternalRef}
            onChange={(e) => setNewProjectExternalRef(e.target.value)}
            placeholder={t("profile.projectExternalRef")}
            className="px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition col-span-2"
          />
        </div>
        <button
          onClick={addProject}
          disabled={savingProject || !newProjectCustomerId || !newProjectName.trim()}
          className="w-full mb-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> {t("profile.addProject")}
        </button>

        {projects.length > 0 ? (
          <div className="space-y-1.5">
            {projects.map((p) => {
              const customerName = customers.find((c) => c.id === p.customerId)?.name ?? "";
              if (editingProjectId === p.id) {
                return (
                  <div key={p.id} className="bg-secondary rounded-xl px-3 py-2 text-sm space-y-2">
                    <div className="text-xs text-muted-foreground">{customerName}</div>
                    <input
                      type="text"
                      value={editProjectName}
                      onChange={(e) => setEditProjectName(e.target.value)}
                      className="w-full px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      autoFocus
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        step="5"
                        value={editProjectRate}
                        onChange={(e) => setEditProjectRate(e.target.value)}
                        placeholder={t("profile.hourlyRate")}
                        className="px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      />
                      <input
                        type="number"
                        min="0"
                        step="5"
                        value={editProjectBudget}
                        onChange={(e) => setEditProjectBudget(e.target.value)}
                        placeholder={t("profile.budgetHours")}
                        className="px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      />
                    </div>
                    <input
                      type="text"
                      value={editProjectExternalRef}
                      onChange={(e) => setEditProjectExternalRef(e.target.value)}
                      placeholder={t("profile.projectExternalRef")}
                      className="w-full px-2 py-1 rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={saveEditProject} disabled={savingProject} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition"><CheckCircle className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditingProjectId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={p.id} className={`flex items-center justify-between bg-secondary rounded-xl px-3 py-2 text-sm gap-2 ${!p.active ? "opacity-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {customerName}
                      {p.hourlyRate != null && ` · ${p.hourlyRate.toFixed(0)} CHF/h`}
                      {p.budgetHours != null && ` · Budget ${p.budgetHours.toFixed(0)}h`}
                      {p.externalRef && ` · ${p.externalRef}`}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
                    <input type="checkbox" checked={p.active} onChange={() => toggleProjectActive(p)} className="accent-primary" />
                    {t("profile.active")}
                  </label>
                  <button onClick={() => startEditProject(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setProjectPendingDelete(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">{t("profile.noProjects")}</p>
        )}
      </motion.div>

      <AlertDialog open={!!projectPendingDelete} onOpenChange={(open) => { if (!open) setProjectPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.deleteProjectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {projectPendingDelete && t("profile.deleteProjectConfirm", { name: projectPendingDelete.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("profile.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingProject}
              onClick={(e) => { e.preventDefault(); if (projectPendingDelete) deleteProject(projectPendingDelete.id); }}
            >
              {t("profile.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Kundenstunden monatlich (statt am Tageseintrag) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> {t("profile.customerMonth")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.customerMonthDesc")}</p>

        <div className="mb-3">
          <MonthYearPicker value={cmMonth} onChange={setCmMonth} />
        </div>

        {customers.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center">{t("profile.noCustomers")}</p>
        ) : (
          <div className={`space-y-1.5 ${cmLoading ? "opacity-50 pointer-events-none" : ""}`}>
            {customers.map((c) => {
              const customerProjects = projects.filter((p) => p.customerId === c.id);
              const expanded = !!cmExpanded[c.id];
              return (
                <div key={c.id} className="bg-secondary rounded-xl px-3 py-2">
                  {/* flex-wrap statt starrer Einzeiler: der Kundenname war auf
                      375px zwischen Stunden-Input und "Auf Projekte
                      aufteilen"-Button auf ein paar Buchstaben zusammen-
                      gequetscht. Auf Mobile bekommt der Name seine eigene
                      Zeile, ab sm bleibt der bisherige Einzeiler erhalten. */}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium w-full sm:w-auto sm:flex-1 min-w-0 truncate">{c.name}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={cmDirectHours[c.id] ?? ""}
                      onChange={(e) => setCmDirectHours((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="0"
                      className="w-24 px-2 py-1 rounded-lg bg-card text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">h</span>
                    {customerProjects.length > 0 && (
                      <button
                        onClick={() => toggleCmExpanded(c.id)}
                        className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg px-2 py-1 shrink-0 transition"
                      >
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expanded ? t("profile.customerMonthCollapse") : t("profile.customerMonthSplit")}
                      </button>
                    )}
                  </div>
                  {expanded && customerProjects.length > 0 && (
                    <div className="mt-1.5 pl-3 space-y-1 border-l-2 border-border">
                      {customerProjects.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">{p.name}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={cmProjectHours[p.id] ?? ""}
                            onChange={(e) => setCmProjectHours((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="0"
                            className="w-24 px-2 py-1 rounded-lg bg-card text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                          />
                          <span className="text-xs text-muted-foreground shrink-0">h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {customers.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 mb-3 px-1">
              <span>{t("profile.customerMonthEntered", { hours: cmTotalEntered.toFixed(2) })}</span>
              <span>{t("profile.customerMonthWorked", { hours: cmArbeitsstunden.toFixed(2) })}</span>
            </div>
            <button
              onClick={saveCustomerMonth}
              disabled={cmSaving || cmLoading}
              className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" /> {cmSaving ? t("common.loading") : t("profile.customerMonthSave")}
            </button>
          </>
        )}
      </motion.div>

      {/* Change Password */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> {t("profile.changePassword")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("profile.currentPassword")}</label><input type="password" value={currentPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" autoComplete="current-password" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">{t("profile.newPassword")}</label><input type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" autoComplete="new-password" /></div>
        </div>
        <div className="mt-3"><label className="text-xs text-muted-foreground mb-1 block">{t("register.confirmPassword")}</label><input type="password" value={confirmNewPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmNewPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" autoComplete="new-password" /></div>
        <p className="text-xs text-muted-foreground mt-2">{t("register.passwordHint")}</p>
        <button onClick={changePassword} disabled={saving || !currentPassword || !newPassword || !confirmNewPassword} className="mt-3 w-full py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50">{t("profile.changePassword")}</button>
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
          {exportType === "month" && <MonthYearPicker value={exportMonth} onChange={setExportMonth} />}
          {exportType === "year" && <input type="number" min="2020" max="2030" value={exportYear} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportYear(parseInt(e?.target?.value) || 2026)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary/30" />}
          {exportType === "custom" && (
            <>
              <input type="date" value={exportFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportFrom(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <input type="date" value={exportTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExportTo(e?.target?.value ?? "")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </>
          )}
        </div>
        {isOrgAdmin && (
          <div className="flex gap-3 flex-wrap mb-3">
            <select value={exportScope} onChange={(e) => setExportScope(e.target.value as "self" | "person" | "org")} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="self">{t("profile.exportScopeSelf")}</option>
              <option value="person">{t("profile.exportScopePerson")}</option>
              <option value="org">{t("profile.exportScopeOrg")}</option>
            </select>
            {exportScope === "person" && (
              <select value={exportTargetUserId} onChange={(e) => setExportTargetUserId(e.target.value)} className="px-3 py-1.5 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">{t("profile.exportSelectPerson")}</option>
                {teamMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <button onClick={handleExport} className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5"><Download className="w-4 h-4" /> {t("profile.exportButton")}</button>
        <button
          onClick={handleArgControlExport}
          disabled={exportingArgControl}
          title={t("profile.exportArgControlHint")}
          className="w-full mt-2 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> {exportingArgControl ? t("common.loading") : t("profile.exportArgControl")}
        </button>
      </motion.div>

      {/* Alt-Import (Betrieb.md Punkt 4) — nur für das eigene Konto,
          kein Admin-Import für Dritte. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><Upload className="w-4 h-4 text-primary" /> {t("profile.import")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("profile.importHint")}</p>
        <input
          type="file"
          accept=".xlsx"
          onChange={handleImportFileChange}
          className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-secondary file:text-foreground file:text-sm file:font-medium hover:file:bg-accent file:transition"
        />
        {importFile && !importPreview && (
          <button
            onClick={() => runImport("preview")}
            disabled={importLoading}
            className="w-full mt-3 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50"
          >
            {importLoading ? t("common.loading") : t("profile.importPreview")}
          </button>
        )}
        {importPreview && (
          <div className="mt-3 bg-secondary rounded-xl p-3 text-sm space-y-1.5">
            <p>{t("profile.importPreviewCount", { imported: String(importPreview.imported), total: String(importPreview.totalRows) })}</p>
            {importPreview.dateFrom && importPreview.dateTo && (
              <p className="text-xs text-muted-foreground">{importPreview.dateFrom} – {importPreview.dateTo}</p>
            )}
            {importPreview.skippedExisting > 0 && (
              <p className="text-xs text-muted-foreground">{t("profile.importSkippedExisting", { count: String(importPreview.skippedExisting) })}</p>
            )}
            {importPreview.skippedLocked > 0 && (
              <p className="text-xs text-muted-foreground">{t("profile.importSkippedLocked", { count: String(importPreview.skippedLocked) })}</p>
            )}
            {importPreview.totalCustomerMonthRows > 0 && (
              <p>{t("profile.importCustomerMonthCount", { imported: String(importPreview.importedCustomerMonths), total: String(importPreview.totalCustomerMonthRows) })}</p>
            )}
            {importPreview.skippedExistingCustomerMonths > 0 && (
              <p className="text-xs text-muted-foreground">{t("profile.importSkippedExisting", { count: String(importPreview.skippedExistingCustomerMonths) })}</p>
            )}
            {importPreview.skippedLockedCustomerMonths > 0 && (
              <p className="text-xs text-muted-foreground">{t("profile.importSkippedLocked", { count: String(importPreview.skippedLockedCustomerMonths) })}</p>
            )}
            {importPreview.errors.length > 0 && (
              <details className="text-xs text-destructive">
                <summary className="cursor-pointer">{t("profile.importErrors", { count: String(importPreview.errors.length) })}</summary>
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {importPreview.errors.slice(0, 30).map((e, i) => (
                    <li key={i}>{e.sheet} · Zeile {e.rowNumber}: {e.message}</li>
                  ))}
                </ul>
              </details>
            )}
            {!importDone && (importPreview.imported > 0 || importPreview.importedCustomerMonths > 0) && (
              <button
                onClick={() => runImport("commit")}
                disabled={importLoading}
                className="w-full mt-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {importLoading ? t("common.loading") : t("profile.importCommit", { count: String(importPreview.imported + importPreview.importedCustomerMonths) })}
              </button>
            )}
            {importDone && (
              <p className="text-primary font-medium flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> {t("profile.importDone", { count: String(importPreview.imported + importPreview.importedCustomerMonths) })}</p>
            )}
          </div>
        )}
      </motion.div>


      {isOrgAdmin && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.27 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-sm font-display font-semibold mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {t("profile.exportPayroll")}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t("profile.exportPayrollDesc")}</p>
          <div className="flex gap-3 flex-wrap mb-3">
            {/* HARDENING.md C7f: dieselbe Monat/Jahr-Komponente wie die
                übrigen Zeitraum-Auswahlen in der App, statt einer eigenen
                Select/Number-Kombination — payrollMonth/payrollYear bleiben
                als separate Zahlen bestehen (handlePayrollExport baut die
                Query-Params daraus), nur die Darstellung ist gebündelt. */}
            <MonthYearPicker
              value={`${payrollYear}-${String(payrollMonth).padStart(2, "0")}`}
              onChange={(v) => {
                const [y, m] = v.split("-");
                setPayrollYear(parseInt(y, 10) || payrollYear);
                setPayrollMonth(parseInt(m, 10) || payrollMonth);
              }}
            />
          </div>
          <button
            onClick={handlePayrollExport}
            disabled={exportingPayroll}
            className="w-full py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" /> {exportingPayroll ? t("common.loading") : t("profile.exportPayrollButton")}
          </button>
        </motion.div>
      )}

      {/* Logout */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="w-full py-3 rounded-2xl bg-card text-destructive text-sm font-medium hover:bg-destructive/5 transition flex items-center justify-center gap-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <LogOut className="w-4 h-4" /> {t("profile.logout")}
        </button>
      </motion.div>
    </div>
  );
}