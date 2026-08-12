"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Clock, Pencil, CalendarClock, Palmtree } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";

interface TimeEntry {
  id: string;
  date: string;
  hours: number;
  type: string;
}

interface CustomerHourEntry {
  id: string;
  customerName: string;
  hours: number;
}

interface UserProfile {
  firstName: string;
  weeklyHours: number;
  pensum: number;
  baseWeeklyHours?: number | null;
  basePensum?: number | null;
  standardWeek?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number };
}

interface PensumChange {
  id: string;
  pensum: number;
  weeklyHours: number;
  effectiveFrom: string;
}

export default function CalendarPage() {
  const { data: session } = useSession() || {};
  const { t } = useI18n();
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [customerHours, setCustomerHours] = useState<CustomerHourEntry[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pensumChanges, setPensumChanges] = useState<PensumChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // Day modal state
  const [dayHours, setDayHours] = useState("0.00");
  const [dayType, setDayType] = useState("work");
  const [dayEntryId, setDayEntryId] = useState<string | null>(null);

  // Customer edit modal state
  const [editingCustomer, setEditingCustomer] = useState<CustomerHourEntry | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerHours, setEditCustomerHours] = useState("");
  const [editCustomerModalOpen, setEditCustomerModalOpen] = useState(false);

  // New customer modal state
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerHours, setNewCustomerHours] = useState("");
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);

  // Apply Standardwoche modal
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyFrom, setApplyFrom] = useState("");
  const [applyTo, setApplyTo] = useState("");
  const [applyOverwrite, setApplyOverwrite] = useState(false);
  const [applying, setApplying] = useState(false);

  // Bulk vacation modal
  const [vacModalOpen, setVacModalOpen] = useState(false);
  const [vacFrom, setVacFrom] = useState("");
  const [vacTo, setVacTo] = useState("");
  const [vacOverwrite, setVacOverwrite] = useState(false);
  const [vacApplying, setVacApplying] = useState(false);

  const firstName = session?.user?.name?.split?.(' ')?.[0] ?? '';

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/time-entries?year=${currentDate?.year}&month=${currentDate?.month}`);
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setEntries(data?.entries ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, [currentDate?.year, currentDate?.month]);

  const fetchCustomerHours = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer-hours?year=${currentDate?.year}&month=${currentDate?.month}`);
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setCustomerHours(data?.customerHours ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, [currentDate?.year, currentDate?.month]);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setProfile({
          firstName: data?.firstName ?? "",
          weeklyHours: data?.weeklyHours ?? 42,
          pensum: data?.pensum ?? 100,
          standardWeek: data?.standardWeek ?? { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
        });
      }
    } catch (err: any) { console.error(err); }
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

  useEffect(() => { fetchEntries(); fetchCustomerHours(); }, [fetchEntries, fetchCustomerHours]);
  useEffect(() => { fetchProfile(); fetchPensumChanges(); }, [fetchProfile, fetchPensumChanges]);

  // Close month picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setMonthPickerOpen(false);
      }
    };
    if (monthPickerOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [monthPickerOpen]);

  const prevMonth = () => {
    setCurrentDate((d: any) => d?.month === 1 ? { year: (d?.year ?? 2026) - 1, month: 12 } : { year: d?.year, month: (d?.month ?? 1) - 1 });
  };
  const nextMonth = () => {
    setCurrentDate((d: any) => d?.month === 12 ? { year: (d?.year ?? 2026) + 1, month: 1 } : { year: d?.year, month: (d?.month ?? 1) + 1 });
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month - 1, 1).getDay();
    return day === 0 ? 7 : day;
  };

  const daysInMonth = getDaysInMonth(currentDate?.year ?? 2026, currentDate?.month ?? 1);
  const firstDay = getFirstDayOfMonth(currentDate?.year ?? 2026, currentDate?.month ?? 1);

  const weeks: (number | null)[][] = [];
  let currentWeek: (number | null)[] = [];
  for (let i = 1; i < firstDay; i++) currentWeek.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    currentWeek.push(d);
    if (currentWeek?.length === 7) { weeks.push(currentWeek); currentWeek = []; }
  }
  if (currentWeek?.length > 0) {
    while (currentWeek?.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const getEntryForDay = (day: number) => {
    const dateStr = `${currentDate?.year}-${String(currentDate?.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return entries?.find?.((e: TimeEntry) => e?.date?.startsWith?.(dateStr)) ?? null;
  };

  const getStatusColor = (day: number) => {
    const entry = getEntryForDay(day);
    if (!entry) return "bg-gray-300";
    if ((entry?.hours ?? 0) === 0) return "bg-gray-300";
    if (entry?.type === "vacation" || entry?.type === "holiday") return "bg-sky-400";
    return "bg-green-500";
  };

  const isToday = (day: number) => {
    const now = new Date();
    return now.getFullYear() === currentDate?.year && now.getMonth() + 1 === currentDate?.month && now.getDate() === day;
  };

  // Get pensum/weeklyHours for a specific date (considering pensum changes)
  const getPensumForDate = (dateStr: string) => {
    const date = new Date(dateStr);
    // Basis = Werte vor der ersten Pensumsänderung (nicht die aktuellen Profilwerte)
    let effectivePensum = profile?.basePensum ?? profile?.pensum ?? 100;
    let effectiveWeeklyHours = profile?.baseWeeklyHours ?? profile?.weeklyHours ?? 42;

    // Apply pensum changes in chronological order
    for (const change of pensumChanges) {
      const changeDate = new Date(change.effectiveFrom);
      if (changeDate <= date) {
        effectivePensum = change.pensum;
        effectiveWeeklyHours = change.weeklyHours;
      }
    }

    return { pensum: effectivePensum, weeklyHours: effectiveWeeklyHours };
  };

  const getDailyHoursForDay = (day: number) => {
    const dateStr = `${currentDate?.year}-${String(currentDate?.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const { pensum, weeklyHours } = getPensumForDate(dateStr);
    return (weeklyHours * pensum / 100) / 5;
  };

  const dailyHours = getDailyHoursForDay(selectedDay ?? 1);

  const openDayModal = (day: number) => {
    setSelectedDay(day);
    const entry = getEntryForDay(day);
    const dh = getDailyHoursForDay(day);
    if (entry) {
      setDayHours(entry?.hours?.toFixed?.(2) ?? "0.00");
      setDayType(entry?.type ?? "work");
      setDayEntryId(entry?.id ?? null);
    } else {
      setDayHours("0.00");
      setDayType("work");
      setDayEntryId(null);
    }
    setDayModalOpen(true);
  };

  const handleDayTypeChange = (newType: string) => {
    setDayType(newType);
    if (newType === "vacation" || newType === "holiday") {
      const dh = getDailyHoursForDay(selectedDay ?? 1);
      setDayHours(dh?.toFixed?.(2) ?? "0.00");
    }
  };

  const saveDayEntry = async () => {
    if (selectedDay === null) return;
    setLoading(true);
    try {
      const dateStr = `${currentDate?.year}-${String(currentDate?.month).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
      const res = await fetch("/api/time-entries", {
        method: dayEntryId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dayEntryId, date: dateStr, hours: Math.max(0, Math.min(24, parseFloat(dayHours) || 0)), type: dayType }),
      });
      if (res?.ok) { await fetchEntries(); setDayModalOpen(false); }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };

  const deleteDayEntry = async () => {
    if (!dayEntryId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/time-entries", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: dayEntryId }) });
      if (res?.ok) { await fetchEntries(); setDayModalOpen(false); }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };

  // Customer hours: Edit
  const openEditCustomer = (ch: CustomerHourEntry) => {
    setEditingCustomer(ch);
    setEditCustomerName(ch.customerName);
    setEditCustomerHours(String(ch.hours));
    setEditCustomerModalOpen(true);
  };

  const saveEditCustomer = async () => {
    if (!editingCustomer) return;
    setLoading(true);
    try {
      const res = await fetch("/api/customer-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCustomer.id, customerName: editCustomerName.trim(), hours: parseFloat(editCustomerHours) || 0 }),
      });
      if (res?.ok) { await fetchCustomerHours(); setEditCustomerModalOpen(false); setEditingCustomer(null); }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };

  // Customer hours: Delete
  const deleteCustomerHour = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/customer-hours", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res?.ok) { await fetchCustomerHours(); }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };

  // Customer hours: Add new
  const openAddCustomer = () => {
    // Pre-fill with last entered customer name
    const lastCustomer = customerHours?.length > 0 ? customerHours[customerHours.length - 1]?.customerName ?? "" : "";
    setNewCustomerName(lastCustomer);
    setNewCustomerHours("");
    setAddCustomerModalOpen(true);
  };

  const saveNewCustomer = async () => {
    if (!newCustomerName.trim() || !(parseFloat(newCustomerHours) > 0)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/customer-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: currentDate?.year,
          month: currentDate?.month,
          items: [...customerHours.map(ch => ({ customerName: ch.customerName, hours: ch.hours })), { customerName: newCustomerName.trim(), hours: parseFloat(newCustomerHours) }],
        }),
      });
      if (res?.ok) { await fetchCustomerHours(); setAddCustomerModalOpen(false); }
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };

  // Month picker
  const [pickerYear, setPickerYear] = useState(currentDate.year);
  const selectMonth = (month: number) => {
    setCurrentDate({ year: pickerYear, month });
    setMonthPickerOpen(false);
  };

  // Standardwoche helpers
  const stdWeekSum = (() => {
    const sw = profile?.standardWeek;
    if (!sw) return 0;
    return (sw.mon ?? 0) + (sw.tue ?? 0) + (sw.wed ?? 0) + (sw.thu ?? 0) + (sw.fri ?? 0) + (sw.sat ?? 0) + (sw.sun ?? 0);
  })();
  const hasStdWeek = stdWeekSum > 0;

  const openApplyModal = () => {
    // Prefill: aktueller Monat
    const y = currentDate.year;
    const m = currentDate.month;
    const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const lastOfMonth = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    setApplyFrom(firstOfMonth);
    setApplyTo(lastOfMonth);
    setApplyOverwrite(false);
    setApplyModalOpen(true);
  };

  const applyStandardWeek = async () => {
    if (!applyFrom || !applyTo) return;
    setApplying(true);
    try {
      const res = await fetch("/api/time-entries/bulk-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: applyFrom, toDate: applyTo, overwriteExisting: applyOverwrite }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        const skipped = (data?.skippedExisting ?? 0) + (data?.skippedProtected ?? 0);
        toast.success(
          t("calendar.applyResult", {
            created: String(data?.created ?? 0),
            updated: String(data?.updated ?? 0),
            skipped: String(skipped),
          })
        );
        setApplyModalOpen(false);
        await fetchEntries();
      } else {
        toast.error(data?.error ?? t("calendar.applyError"));
      }
    } catch (err: any) {
      console.error(err);
      toast.error(t("calendar.applyError"));
    } finally {
      setApplying(false);
    }
  };

  // Preview berechnen
  const applyPreview = (() => {
    if (!applyFrom || !applyTo || !profile?.standardWeek) return { days: 0, workDays: 0 };
    const f = new Date(applyFrom);
    const tDate = new Date(applyTo);
    if (isNaN(f.getTime()) || isNaN(tDate.getTime()) || tDate < f) return { days: 0, workDays: 0 };
    const sw = profile.standardWeek;
    const tplByDay = [sw.sun, sw.mon, sw.tue, sw.wed, sw.thu, sw.fri, sw.sat];
    let days = 0;
    let workDays = 0;
    const cur = new Date(f);
    while (cur <= tDate) {
      days++;
      if ((tplByDay[cur.getDay()] ?? 0) > 0) workDays++;
      cur.setDate(cur.getDate() + 1);
    }
    return { days, workDays };
  })();

  // Bulk vacation helpers
  const openVacModal = () => {
    const y = currentDate.year;
    const m = currentDate.month;
    const today = new Date();
    const startDay = (y === today.getFullYear() && m === today.getMonth() + 1)
      ? today.getDate() : 1;
    setVacFrom(`${y}-${String(m).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`);
    setVacTo(`${y}-${String(m).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`);
    setVacOverwrite(false);
    setVacModalOpen(true);
  };

  const vacPreview = (() => {
    if (!vacFrom || !vacTo) return { totalDays: 0, workDays: 0 };
    const f = new Date(vacFrom);
    const tDate = new Date(vacTo);
    if (isNaN(f.getTime()) || isNaN(tDate.getTime()) || tDate < f) return { totalDays: 0, workDays: 0 };
    let totalDays = 0;
    let workDays = 0;
    const cur = new Date(f);
    while (cur <= tDate) {
      totalDays++;
      const day = cur.getDay();
      if (day !== 0 && day !== 6) workDays++;
      cur.setDate(cur.getDate() + 1);
    }
    return { totalDays, workDays };
  })();

  const applyBulkVacation = async () => {
    if (!vacFrom || !vacTo || vacPreview.workDays === 0) return;
    setVacApplying(true);
    try {
      const res = await fetch("/api/time-entries/bulk-vacation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: vacFrom, toDate: vacTo, overwriteExisting: vacOverwrite }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (res?.ok) {
        toast.success(
          t("calendar.vacResult", {
            created: String(data?.created ?? 0),
            updated: String(data?.updated ?? 0),
            skipped: String(data?.skipped ?? 0),
          })
        );
        setVacModalOpen(false);
        await fetchEntries();
      } else {
        toast.error(data?.error ?? t("calendar.vacError"));
      }
    } catch (err: any) {
      console.error(err);
      toast.error(t("calendar.vacError"));
    } finally {
      setVacApplying(false);
    }
  };

  const weekdayKeys = ["weekday.mo", "weekday.tu", "weekday.we", "weekday.th", "weekday.fr", "weekday.sa", "weekday.su"];
  const totalCustomerHours = customerHours?.reduce?.((sum: number, ch: CustomerHourEntry) => sum + (ch?.hours ?? 0), 0) ?? 0;

  return (
    <div>
      {/* Greeting */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          {t("calendar.greeting", { name: firstName })}
        </h1>
      </motion.div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-accent transition"><ChevronLeft className="w-5 h-5" /></button>
        <div className="relative" ref={monthPickerRef}>
          <button
            onClick={() => { setPickerYear(currentDate.year); setMonthPickerOpen(!monthPickerOpen); }}
            className="text-lg font-display font-semibold hover:text-primary transition cursor-pointer px-3 py-1 rounded-xl hover:bg-accent"
          >
            {t(`month.${currentDate?.month}`)} {currentDate?.year}
          </button>

          {/* Month Picker Dropdown */}
          <AnimatePresence>
            {monthPickerOpen && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-card rounded-2xl p-4 z-50 w-72"
                style={{ boxShadow: "var(--shadow-lg)" }}
              >
                {/* Year nav */}
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setPickerYear(y => y - 1)} className="p-1 rounded-lg hover:bg-accent transition"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="font-display font-semibold">{pickerYear}</span>
                  <button onClick={() => setPickerYear(y => y + 1)} className="p-1 rounded-lg hover:bg-accent transition"><ChevronRight className="w-4 h-4" /></button>
                </div>
                {/* Month grid */}
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <button
                      key={m}
                      onClick={() => selectMonth(m)}
                      className={`py-2 rounded-xl text-sm font-medium transition ${
                        currentDate.year === pickerYear && currentDate.month === m
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent text-foreground'
                      }`}
                    >
                      {t(`month.${m}`).substring(0, 3)}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-accent transition"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-2 mb-3">
        <button
          onClick={openVacModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-200/60 text-xs font-medium hover:bg-sky-100 transition"
          title={t("calendar.bulkVacation")}
        >
          <Palmtree className="w-3.5 h-3.5" />
          {t("calendar.bulkVacation")}
        </button>
        <button
          onClick={openApplyModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-accent transition"
          title={t("calendar.applyStdWeek")}
        >
          <CalendarClock className="w-3.5 h-3.5" />
          {t("calendar.applyStdWeek")}
        </button>
      </div>

      {/* Calendar grid */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-md)" }}>
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekdayKeys?.map?.((key: string, i: number) => (
            <div key={key} className={`text-center text-xs font-medium ${i >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
              {t(key)}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks?.map?.((week: (number | null)[], wi: number) => (
          <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
            {week?.map?.((day: number | null, di: number) => (
              <button
                key={di}
                disabled={day === null}
                onClick={() => day !== null && openDayModal(day)}
                className={`relative flex flex-col items-center justify-center py-2 rounded-xl transition text-sm ${
                  day === null ? 'invisible' : 'hover:bg-accent cursor-pointer'
                } ${isToday(day ?? 0) ? 'ring-2 ring-primary/30' : ''}`}
              >
                <span className={`font-medium ${isToday(day ?? 0) ? 'text-primary font-bold' : di >= 5 ? 'text-muted-foreground/60' : ''}`}>
                  {day}
                </span>
                {day !== null && (
                  <span className={`w-1.5 h-1.5 rounded-full mt-1 ${getStatusColor(day)}`} />
                )}
              </button>
            ))}
          </div>
        ))}
      </motion.div>

      {/* Customer hours list with edit/delete */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">{t("calendar.customerHours")}: {totalCustomerHours > 0 ? `${totalCustomerHours?.toFixed?.(1)}h` : t("calendar.noEntries")}</span>
          <button
            onClick={openAddCustomer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> {t("calendar.addCustomer")}
          </button>
        </div>
        {customerHours.length > 0 && (
          <div className="space-y-1.5">
            {customerHours.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between bg-card rounded-xl px-3 py-2 text-sm" style={{ boxShadow: "var(--shadow-sm)" }}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ch.customerName}</span>
                  <span className="text-muted-foreground">{ch.hours}h</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditCustomer(ch)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition" title={t("calendar.editCustomer")}><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteCustomerHour(ch.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition" title={t("calendar.deleteCustomer")}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" /> {t("calendar.noEntries")}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> {t("calendar.work")}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400" /> {t("calendar.vacation")}/{t("calendar.holiday")}</span>
      </div>

      {/* Day Entry Modal */}
      <AnimatePresence>
        {dayModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setDayModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-sm" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold">
                  {selectedDay}. {t(`month.${currentDate?.month}`)} {currentDate?.year}
                </h3>
                <button onClick={() => setDayModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t("calendar.type")}</label>
                  <div className="flex gap-2">
                    {["work", "vacation", "holiday"].map((type: string) => (
                      <button key={type} onClick={() => handleDayTypeChange(type)} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${dayType === type ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-accent'}`}>
                        {t(`calendar.${type}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t("calendar.hours")}</label>
                  <input type="number" step="0.25" min="0" max="24" value={dayHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const v = e?.target?.value ?? "0.00";
                    if (v === "") { setDayHours(""); return; }
                    const num = parseFloat(v);
                    if (isNaN(num)) return;
                    if (num < 0) setDayHours("0");
                    else if (num > 24) setDayHours("24");
                    else setDayHours(v);
                  }} className="w-full px-4 py-2.5 rounded-xl bg-secondary text-center font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <div className="flex gap-2">
                  {dayEntryId && <button onClick={deleteDayEntry} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-destructive/10 text-destructive font-medium hover:bg-destructive/20 transition disabled:opacity-50 flex items-center justify-center gap-1"><Trash2 className="w-4 h-4" /> {t("calendar.delete")}</button>}
                  <button onClick={saveDayEntry} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("calendar.save")}</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Customer Hour Modal */}
      <AnimatePresence>
        {editCustomerModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setEditCustomerModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-sm" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold">{t("calendar.editCustomer")}</h3>
                <button onClick={() => setEditCustomerModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.customerName")}</label>
                  <input type="text" value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.hours")}</label>
                  <input type="number" step="0.5" min="0" value={editCustomerHours} onChange={(e) => setEditCustomerHours(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <button onClick={saveEditCustomer} disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("calendar.save")}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Apply Standardwoche Modal */}
      <AnimatePresence>
        {applyModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setApplyModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-md" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" /> {t("calendar.applyStdWeekTitle")}</h3>
                <button onClick={() => setApplyModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>

              {!hasStdWeek ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <CalendarClock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800">{t("calendar.applyNoTemplate")}</p>
                  </div>
                  <Link
                    href="/profile"
                    className="block w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-center hover:opacity-90 transition text-sm"
                  >
                    {t("calendar.applyGoToProfile")}
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">{t("calendar.applyStdWeekDesc")}</p>

                  {/* Standardwoche preview (read-only) */}
                  {profile?.standardWeek && (
                    <div className="bg-secondary rounded-xl p-3">
                      <div className="grid grid-cols-7 gap-1 text-xs">
                        {([
                          { key: "weekday.mo", val: profile.standardWeek.mon },
                          { key: "weekday.tu", val: profile.standardWeek.tue },
                          { key: "weekday.we", val: profile.standardWeek.wed },
                          { key: "weekday.th", val: profile.standardWeek.thu },
                          { key: "weekday.fr", val: profile.standardWeek.fri },
                          { key: "weekday.sa", val: profile.standardWeek.sat },
                          { key: "weekday.su", val: profile.standardWeek.sun },
                        ] as const).map((d) => (
                          <div key={d.key} className="text-center">
                            <div className="text-muted-foreground">{t(d.key)}</div>
                            <div className={`font-mono font-medium mt-0.5 ${d.val > 0 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{d.val.toFixed(1)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.applyFrom")}</label>
                      <input type="date" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.applyTo")}</label>
                      <input type="date" value={applyTo} onChange={(e) => setApplyTo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                    </div>
                  </div>

                  {/* Preview */}
                  {applyFrom && applyTo && applyPreview.days > 0 && (
                    <div className="text-xs text-muted-foreground px-1">
                      {t("calendar.applyPreviewText", { days: String(applyPreview.days), workDays: String(applyPreview.workDays) })}
                    </div>
                  )}

                  {/* Overwrite checkbox */}
                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={applyOverwrite}
                      onChange={(e) => setApplyOverwrite(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1">
                      <div className="text-sm">{t("calendar.applyOverwrite")}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t("calendar.applyOverwriteHint")}</div>
                    </div>
                  </label>

                  <div className="flex gap-2">
                    <button onClick={() => setApplyModalOpen(false)} className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground font-medium hover:bg-accent transition text-sm">{t("calendar.cancel")}</button>
                    <button
                      onClick={applyStandardWeek}
                      disabled={applying || !applyFrom || !applyTo || applyPreview.workDays === 0}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 text-sm"
                    >
                      {applying ? t("common.loading") : t("calendar.applySubmit")}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Customer Hour Modal */}
      <AnimatePresence>
        {addCustomerModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setAddCustomerModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-sm" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold">{t("calendar.addCustomer")} — {t(`month.${currentDate?.month}`)} {currentDate?.year}</h3>
                <button onClick={() => setAddCustomerModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.customerName")}</label>
                  <input type="text" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder={t("calendar.customerName")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.hours")}</label>
                  <input type="number" step="0.5" min="0" value={newCustomerHours} onChange={(e) => setNewCustomerHours(e.target.value)} placeholder="h" className="w-full px-3 py-2 rounded-xl bg-secondary text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <button onClick={saveNewCustomer} disabled={loading || !newCustomerName.trim() || !(parseFloat(newCustomerHours) > 0)} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("calendar.save")}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Vacation Modal */}
      <AnimatePresence>
        {vacModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm px-4" onClick={() => setVacModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e: React.MouseEvent) => e?.stopPropagation?.()} className="bg-card rounded-2xl p-6 w-full max-w-md" style={{ boxShadow: "var(--shadow-lg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold flex items-center gap-2"><Palmtree className="w-4 h-4 text-sky-600" /> {t("calendar.bulkVacationTitle")}</h3>
                <button onClick={() => setVacModalOpen(false)} className="p-1 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">{t("calendar.bulkVacationDesc")}</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.applyFrom")}</label>
                    <input type="date" value={vacFrom} onChange={(e) => setVacFrom(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("calendar.applyTo")}</label>
                    <input type="date" value={vacTo} onChange={(e) => setVacTo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                  </div>
                </div>

                {/* Preview */}
                {vacFrom && vacTo && vacPreview.totalDays > 0 && (
                  <div className="bg-sky-50 border border-sky-200/60 rounded-xl p-3 text-xs">
                    <div className="flex items-center gap-2 text-sky-700 font-medium mb-1">
                      <Palmtree className="w-3.5 h-3.5" /> {t("calendar.vacPreviewTitle")}
                    </div>
                    <p className="text-sky-800">
                      {t("calendar.vacPreviewText", { totalDays: String(vacPreview.totalDays), workDays: String(vacPreview.workDays) })}
                    </p>
                  </div>
                )}

                {/* Overwrite checkbox */}
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={vacOverwrite}
                    onChange={(e) => setVacOverwrite(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="flex-1">
                    <div className="text-sm">{t("calendar.vacOverwrite")}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t("calendar.vacOverwriteHint")}</div>
                  </div>
                </label>

                <div className="flex gap-2">
                  <button onClick={() => setVacModalOpen(false)} className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground font-medium hover:bg-accent transition text-sm">{t("calendar.cancel")}</button>
                  <button
                    onClick={applyBulkVacation}
                    disabled={vacApplying || !vacFrom || !vacTo || vacPreview.workDays === 0}
                    className="flex-1 py-2.5 rounded-xl bg-sky-600 text-white font-medium hover:bg-sky-700 transition disabled:opacity-50 text-sm"
                  >
                    {vacApplying ? t("common.loading") : t("calendar.vacSubmit")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
