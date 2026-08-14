"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useI18n } from "@/lib/i18n";
import { ChevronLeft, ChevronRight, X, CalendarClock, Palmtree } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";
import { sollStundenTag, stundenAusEintrag, type EintragTyp, type Profil, type PensumChangeInput, type HolidayInput } from "@/lib/calc";
import { DayEntryDialog, type DayTimeEntry, type DayCustomer, type DayProject } from "@/components/day-entry-dialog";

interface UserProfile {
  firstName: string;
  weeklyHours: number;
  pensum: number;
  // Historische Basis vor der ersten Pensumsänderung — das ist der Wert, den
  // pensumAt() als Fallback für frühere Daten braucht.
  baseWeeklyHours: number | null;
  basePensum: number | null;
  vacationDays: number;
  startDate: string | null;
  exitDate: string | null;
  maxWeeklyHours: number;
  standardWeek?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number };
}

interface PensumChange {
  id: string;
  pensum: number;
  weeklyHours: number;
  effectiveFrom: string;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  canton: string | null;
  halfDay: boolean;
}

const TYPE_DOT_COLOR: Record<string, string> = {
  arbeit: "bg-green-500",
  ferien: "bg-sky-400",
  feiertag: "bg-purple-400",
  krank: "bg-red-400",
  militaer: "bg-orange-400",
  unbezahlt: "bg-gray-400",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function CalendarPage() {
  const { data: session } = useSession() || {};
  const { t } = useI18n();
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [entries, setEntries] = useState<DayTimeEntry[]>([]);
  const [customers, setCustomers] = useState<DayCustomer[]>([]);
  const [projects, setProjects] = useState<DayProject[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pensumChanges, setPensumChanges] = useState<PensumChange[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);

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

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setProfile({
          firstName: data?.firstName ?? "",
          weeklyHours: data?.weeklyHours ?? 42,
          pensum: data?.pensum ?? 100,
          baseWeeklyHours: data?.baseWeeklyHours ?? null,
          basePensum: data?.basePensum ?? null,
          vacationDays: data?.vacationDays ?? 25,
          startDate: data?.startDate ?? null,
          exitDate: data?.exitDate ?? null,
          maxWeeklyHours: data?.maxWeeklyHours ?? 45,
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

  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch("/api/holidays");
      if (res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setHolidays(data?.holidays ?? []);
      }
    } catch (err: any) { console.error(err); }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchProfile(); fetchPensumChanges(); fetchHolidays(); fetchCustomers(); fetchProjects(); }, [fetchProfile, fetchPensumChanges, fetchHolidays, fetchCustomers, fetchProjects]);

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

  const buildDateStr = (day: number) => `${currentDate?.year}-${String(currentDate?.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const getEntriesForDay = (day: number): DayTimeEntry[] => {
    const dateStr = buildDateStr(day);
    return entries?.filter?.((e) => e?.date?.startsWith?.(dateStr)) ?? [];
  };

  // basePensum/baseWeeklyHours zuerst: Profil ist der Fallback von pensumAt()
  // für Daten vor der ersten Pensumsänderung, also die historische Basis.
  const profil: Profil | null = profile
    ? {
        pensum: profile.basePensum ?? profile.pensum,
        wochenstunden: profile.baseWeeklyHours ?? profile.weeklyHours,
        startDate: profile.startDate,
        exitDate: profile.exitDate,
        ferientage: profile.vacationDays,
        maxWeeklyHours: profile.maxWeeklyHours,
      }
    : null;
  const changes: PensumChangeInput[] = pensumChanges.map((c) => ({ effectiveFrom: c.effectiveFrom, pensum: c.pensum, wochenstunden: c.weeklyHours }));
  const holidayInputs: HolidayInput[] = holidays.map((h) => ({ date: h.date, halfDay: h.halfDay }));

  const getHolidayForDay = (day: number): Holiday | null => {
    const dateStr = buildDateStr(day);
    return holidays.find((h) => h.date === dateStr) ?? null;
  };

  const getTagesSoll = (day: number): number => {
    if (!profil) return 0;
    return sollStundenTag(buildDateStr(day), profil, changes, holidayInputs);
  };

  const getDayTotalHours = (day: number, dayEntries: DayTimeEntry[], tagesSoll: number): number => {
    return dayEntries.reduce(
      (sum, e) => sum + stundenAusEintrag({ typ: e.type as EintragTyp, von: e.von, bis: e.bis, pauseMin: e.pauseMin, hours: e.hours }, tagesSoll),
      0
    );
  };

  const isToday = (day: number) => {
    const now = new Date();
    return now.getFullYear() === currentDate?.year && now.getMonth() + 1 === currentDate?.month && now.getDate() === day;
  };

  const openDayModal = (day: number) => {
    setSelectedDay(day);
    setDayModalOpen(true);
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

  const selectedDayEntries = selectedDay !== null ? getEntriesForDay(selectedDay) : [];
  const selectedDayTagesSoll = selectedDay !== null ? getTagesSoll(selectedDay) : 0;
  const selectedDayLabel = selectedDay !== null ? `${selectedDay}. ${t(`month.${currentDate?.month}`)} ${currentDate?.year}` : "";
  const selectedDateStr = selectedDay !== null ? buildDateStr(selectedDay) : "";

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
            {week?.map?.((day: number | null, di: number) => {
              if (day === null) {
                return <button key={di} disabled className="invisible py-2 rounded-xl" />;
              }
              const dayEntries = getEntriesForDay(day);
              const tagesSoll = getTagesSoll(day);
              const totalHours = getDayTotalHours(day, dayEntries, tagesSoll);
              const distinctTypes = Array.from(new Set(dayEntries.map((e) => e.type)));
              const weekday = new Date(currentDate.year, currentDate.month - 1, day).getDay();
              const isWorkday = weekday !== 0 && weekday !== 6;
              const isMissing = dayEntries.length === 0 && isWorkday && tagesSoll > 0;
              const holiday = getHolidayForDay(day);

              return (
                <button
                  key={di}
                  onClick={() => openDayModal(day)}
                  title={holiday ? `${holiday.name}${holiday.halfDay ? " (halber Tag)" : ""}` : undefined}
                  className={`relative flex flex-col items-center justify-center py-2 rounded-xl transition text-sm hover:bg-accent cursor-pointer ${isToday(day) ? 'ring-2 ring-primary/30' : ''} ${holiday ? 'bg-purple-50 dark:bg-purple-950/30' : ''}`}
                >
                  <span className={`font-medium ${isToday(day) ? 'text-primary font-bold' : holiday ? 'text-purple-600' : di >= 5 ? 'text-muted-foreground/60' : ''}`}>
                    {day}
                  </span>
                  {distinctTypes.length > 0 && (
                    <span className="flex items-center gap-0.5 mt-0.5">
                      {distinctTypes.map((typ) => (
                        <span key={typ} className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT_COLOR[typ] ?? 'bg-gray-300'}`} />
                      ))}
                    </span>
                  )}
                  {dayEntries.length === 0 && !isMissing && (
                    <span className="w-1.5 h-1.5 rounded-full mt-0.5 bg-gray-300" />
                  )}
                  <span className={`text-[10px] font-mono mt-0.5 leading-none ${isMissing ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                    {dayEntries.length > 0 ? `${round1(totalHours)}h` : isMissing ? `${round1(tagesSoll)}h` : ' '}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </motion.div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" /> {t("calendar.noEntries")}</span>
        {Object.entries(TYPE_DOT_COLOR).map(([typ, color]) => (
          <span key={typ} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${color}`} /> {t(`calendar.type.${typ}`)}</span>
        ))}
      </div>

      {/* Day Entry Dialog */}
      <DayEntryDialog
        open={dayModalOpen}
        onClose={() => setDayModalOpen(false)}
        dateStr={selectedDateStr}
        dayLabel={selectedDayLabel}
        entries={selectedDayEntries}
        customers={customers}
        projects={projects}
        tagesSoll={selectedDayTagesSoll}
        onChanged={fetchEntries}
      />

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
