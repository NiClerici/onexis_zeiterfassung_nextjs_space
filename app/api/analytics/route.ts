export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

function getWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const url = new URL(req.url);
    const type = url?.searchParams?.get?.("type") ?? "month";
    let startDate: Date;
    let endDate: Date;

    const now = new Date();
    const year = parseInt(url?.searchParams?.get?.("year") ?? String(now.getFullYear()));
    const month = parseInt(url?.searchParams?.get?.("month") ?? String(now.getMonth() + 1));

    if (type === "month") {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else if (type === "quarter") {
      const quarter = parseInt(url?.searchParams?.get?.("quarter") ?? "1");
      const qStart = (quarter - 1) * 3;
      startDate = new Date(year, qStart, 1);
      endDate = new Date(year, qStart + 3, 0);
    } else if (type === "year") {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31);
    } else {
      const fromStr = url?.searchParams?.get?.("from") ?? "";
      const toStr = url?.searchParams?.get?.("to") ?? "";
      startDate = fromStr ? new Date(fromStr) : new Date(year, 0, 1);
      endDate = toStr ? new Date(toStr) : new Date(year, 11, 31);
    }

    // Fetch pensum changes for accurate target hour calculation
    const pensumChanges = await prisma.pensumChange.findMany({
      where: { userId },
      orderBy: { effectiveFrom: "asc" },
    });

    // Helper: get daily rate for a specific date considering pensum changes
    function getDailyRateForDate(date: Date): number {
      // Basis = Werte vor der ersten Pensumsänderung (nicht die aktuellen Profilwerte)
      let effectivePensum = user?.basePensum ?? user?.pensum ?? 100;
      let effectiveWeeklyHours = user?.baseWeeklyHours ?? user?.weeklyHours ?? 42;
      for (const change of pensumChanges) {
        const changeDate = new Date(change.effectiveFrom);
        if (changeDate <= date) {
          effectivePensum = change.pensum;
          effectiveWeeklyHours = change.weeklyHours;
        }
      }
      return (effectiveWeeklyHours * effectivePensum / 100) / 5;
    }

    // Calculate target hours considering pensum changes per day
    function getTargetHoursForRange(start: Date, end: Date): number {
      let total = 0;
      const current = new Date(start);
      while (current <= end) {
        const day = current.getDay();
        if (day !== 0 && day !== 6) {
          total += getDailyRateForDate(current);
        }
        current.setDate(current.getDate() + 1);
      }
      return total;
    }

    // Cap the end date for target hours at "today" so Sollarbeitszeit reflects current progress,
    // not the full month/period. This way overtime and billing rate are meaningful at any point in time.
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const effectiveEndDate = endDate > todayEnd ? todayEnd : endDate;
    // If the whole period is in the future, effectiveEndDate may be before startDate → target 0
    const targetHours = effectiveEndDate >= startDate ? getTargetHoursForRange(startDate, effectiveEndDate) : 0;
    const workingDays = effectiveEndDate >= startDate ? getWorkingDays(startDate, effectiveEndDate) : 0;

    // Fetch ALL entries in the full range (including future)
    const allEntries = await prisma.timeEntry.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
    });

    // Split entries into past/today and future
    const pastEntries = allEntries.filter((e: any) => new Date(e.date) <= todayEnd);
    const futureEntries = allEntries.filter((e: any) => new Date(e.date) > todayEnd);

    // Ist-Stunden only up to today (symmetrical with Soll-Stunden)
    const workHours = pastEntries?.filter?.((e: any) => e?.type === "work")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const vacationHours = pastEntries?.filter?.((e: any) => e?.type === "vacation")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const holidayHours = pastEntries?.filter?.((e: any) => e?.type === "holiday")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;

    // Future planned hours (for forecast)
    const fcastFutureWork = futureEntries?.filter?.((e: any) => e?.type === "work")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const fcastFutureVac = futureEntries?.filter?.((e: any) => e?.type === "vacation")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const fcastFutureHol = futureEntries?.filter?.((e: any) => e?.type === "holiday")?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const futureHours = fcastFutureWork + fcastFutureVac + fcastFutureHol;

    // Full period target (uncapped, for forecast)
    const fullTargetHours = getTargetHoursForRange(startDate, endDate);
    
    // Use current daily rate for vacation/holiday day count (approximate)
    const currentDailyRate = getDailyRateForDate(new Date());
    const vacationDays = currentDailyRate > 0 ? vacationHours / currentDailyRate : 0;
    const holidays = currentDailyRate > 0 ? holidayHours / currentDailyRate : 0;

    // actualHours = total accounted hours (work + vacation + holiday)
    const actualHours = workHours + vacationHours + holidayHours;
    const overtime = actualHours - targetHours;

    // Forecast: (Ist bis heute + geplante Zukunft) − Soll gesamt
    const forecastOvertime = (actualHours + futureHours) - fullTargetHours;

    // Vacation balance calculation
    // Vacation days are NOT multiplied by pensum - they stay as full days.
    // At 80% pensum, a vacation day is simply fewer hours (e.g. 6.4h instead of 8h).
    // The daily rate (pensum-adjusted) determines how many hours = 1 vacation day.
    const displayYear = startDate.getFullYear();
    const userVacationDaysPerYear = user?.vacationDays ?? 25;

    // Pro-rata calculation based on start date only (NOT pensum)
    const userStartDate = user?.startDate ? new Date(user.startDate) : null;
    let proRataVacation = userVacationDaysPerYear;
    if (userStartDate) {
      const startYear = userStartDate.getFullYear();
      if (startYear === displayYear) {
        const daysInYear = ((displayYear % 4 === 0 && displayYear % 100 !== 0) || displayYear % 400 === 0) ? 366 : 365;
        const startOfYear = new Date(displayYear, 0, 1);
        const diffMs = userStartDate.getTime() - startOfYear.getTime();
        const daysPassed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        const remainingDaysInYear = daysInYear - daysPassed;
        proRataVacation = userVacationDaysPerYear * (remainingDaysInYear / daysInYear);
      } else if (startYear > displayYear) {
        proRataVacation = 0;
      }
    }

    // Calculate carryover from previous year
    let carryoverDays = 0;
    if (displayYear > 2020) {
      const prevYearStart = new Date(displayYear - 1, 0, 1);
      const prevYearEnd = new Date(displayYear - 1, 11, 31);
      let prevYearEntitlement = userVacationDaysPerYear;
      if (userStartDate) {
        const sYear = userStartDate.getFullYear();
        if (sYear === displayYear - 1) {
          const daysInPrevYear = (((displayYear - 1) % 4 === 0 && (displayYear - 1) % 100 !== 0) || (displayYear - 1) % 400 === 0) ? 366 : 365;
          const startOfPrevYear = new Date(displayYear - 1, 0, 1);
          const diffMs = userStartDate.getTime() - startOfPrevYear.getTime();
          const daysPassed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
          const remainingDaysInPrevYear = daysInPrevYear - daysPassed;
          prevYearEntitlement = userVacationDaysPerYear * (remainingDaysInPrevYear / daysInPrevYear);
        } else if (sYear > displayYear - 1) {
          prevYearEntitlement = 0;
        }
      }
      const prevYearVacationEntries = await prisma.timeEntry.findMany({
        where: { userId, type: "vacation", date: { gte: prevYearStart, lte: prevYearEnd } },
      });
      const prevYearVacationHours = prevYearVacationEntries?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
      const prevDailyRate = getDailyRateForDate(prevYearEnd);
      const prevYearUsedDays = prevDailyRate > 0 ? prevYearVacationHours / prevDailyRate : 0;
      carryoverDays = Math.max(0, prevYearEntitlement - prevYearUsedDays);
    }

    // Current year vacation usage - split into past (bezogen) and future (geplant)
    const currentYearStart = new Date(displayYear, 0, 1);
    const currentYearEnd = new Date(displayYear, 11, 31);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const currentYearVacationEntries = await prisma.timeEntry.findMany({
      where: { userId, type: "vacation", date: { gte: currentYearStart, lte: currentYearEnd } },
    });
    
    // Daily rate determines hours per vacation day (pensum-adjusted)
    const yearDailyRate = getDailyRateForDate(new Date(displayYear, 6, 1));
    
    // Past vacation (bezogen): entries up to today
    const pastVacationHours = currentYearVacationEntries?.filter?.((e: any) => new Date(e.date) <= today)?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const usedVacationDays = yearDailyRate > 0 ? pastVacationHours / yearDailyRate : 0;
    
    // Future vacation (geplant): entries after today
    const futureVacationHours = currentYearVacationEntries?.filter?.((e: any) => new Date(e.date) > today)?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
    const plannedVacationDays = yearDailyRate > 0 ? futureVacationHours / yearDailyRate : 0;
    
    const totalVacationDays = proRataVacation + carryoverDays;
    const remainingVacationDays = totalVacationDays - usedVacationDays - plannedVacationDays;

    // Fetch overtime payouts within the selected period
    const overtimePayoutsInRange = await prisma.overtimePayout.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
    });
    const paidOutHours = overtimePayoutsInRange?.reduce?.((s: number, p: any) => s + (p?.hours ?? 0), 0) ?? 0;

    // Also fetch ALL payouts ever (for cumulative total display)
    const allOvertimePayouts = await prisma.overtimePayout.findMany({
      where: { userId },
    });
    const totalPaidOutHours = allOvertimePayouts?.reduce?.((s: number, p: any) => s + (p?.hours ?? 0), 0) ?? 0;

    const customerHoursData = await prisma.customerHour.findMany({
      where: {
        userId,
        OR: (() => {
          const conditions: any[] = [];
          const current = new Date(startDate);
          while (current <= endDate) {
            conditions.push({ year: current.getFullYear(), month: current.getMonth() + 1 });
            current.setMonth(current.getMonth() + 1);
          }
          return conditions?.length > 0 ? conditions : [{ year: 0, month: 0 }];
        })(),
      },
    });

    const totalCustomerHours = customerHoursData?.reduce?.((s: number, ch: any) => s + (ch?.hours ?? 0), 0) ?? 0;
    const billingRate = workHours > 0 ? (totalCustomerHours / workHours) * 100 : 0;

    // Monthly breakdown
    const monthlyData: Array<{ month: string; target: number; actual: number; customer: number }> = [];
    const currentMonth = new Date(startDate);
    while (currentMonth <= endDate) {
      const mYear = currentMonth.getFullYear();
      const mMonth = currentMonth.getMonth() + 1;
      const mStart = new Date(mYear, mMonth - 1, 1);
      const mEnd = new Date(mYear, mMonth, 0);
      const effectiveMEndByRange = mEnd > endDate ? endDate : mEnd;
      // Cap at today so target hours for current/future months only count up to today
      const effectiveMEnd = effectiveMEndByRange > todayEnd ? todayEnd : effectiveMEndByRange;
      const mTarget = effectiveMEnd >= mStart ? getTargetHoursForRange(mStart, effectiveMEnd) : 0;
      // Cap actual hours at today for monthly breakdown (symmetrical with target)
      const effectiveMActualEnd = mEnd > todayEnd ? todayEnd : mEnd;
      const mActual = allEntries?.filter?.((e: any) => {
        const d = new Date(e?.date);
        return d >= mStart && d <= effectiveMActualEnd;
      })?.reduce?.((s: number, e: any) => s + (e?.hours ?? 0), 0) ?? 0;
      const mCustomer = customerHoursData?.filter?.((ch: any) => ch?.year === mYear && ch?.month === mMonth)?.reduce?.((s: number, ch: any) => s + (ch?.hours ?? 0), 0) ?? 0;

      const monthNames = ["Jan", "Feb", "M\u00e4r", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
      monthlyData.push({ month: monthNames?.[mMonth - 1] ?? "", target: Math.round(mTarget * 10) / 10, actual: Math.round(mActual * 10) / 10, customer: Math.round(mCustomer * 10) / 10 });

      currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    // Net overtime = overtime minus paid-out hours (total cumulative)
    const netOvertime = overtime - totalPaidOutHours;

    return NextResponse.json({
      targetHours: Math.round(targetHours * 10) / 10,
      actualHours: Math.round(actualHours * 10) / 10,
      customerHours: Math.round(totalCustomerHours * 10) / 10,
      billingRate: Math.round(billingRate * 10) / 10,
      vacationDays: Math.round(vacationDays * 10) / 10,
      holidays: Math.round(holidays * 10) / 10,
      overtime: Math.round(overtime * 10) / 10,
      paidOutHours: Math.round(totalPaidOutHours * 10) / 10,
      netOvertime: Math.round(netOvertime * 10) / 10,
      // Forecast fields (for Prognose-Info-Box)
      futureHours: Math.round(futureHours * 10) / 10,
      fullTargetHours: Math.round(fullTargetHours * 10) / 10,
      forecastOvertime: Math.round(forecastOvertime * 10) / 10,
      // Vacation balance (for display year)
      vacationBalance: {
        year: displayYear,
        totalDays: Math.round(totalVacationDays * 10) / 10,
        usedDays: Math.round(usedVacationDays * 10) / 10,
        plannedDays: Math.round(plannedVacationDays * 10) / 10,
        remainingDays: Math.round(remainingVacationDays * 10) / 10,
        carryoverDays: Math.round(carryoverDays * 10) / 10,
        pensumAdjustedDays: Math.round(proRataVacation * 10) / 10,
      },
      monthlyData,
    });
  } catch (error: any) {
    console.error("Analytics error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
