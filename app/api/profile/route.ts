export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { requireOrg, AccessError } from "@/lib/access";

export async function GET() {
  try {
    const { userId, orgId } = await requireOrg();

    const [user, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } }),
    ]);

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      weeklyHours: membership?.weeklyHours ?? 42,
      pensum: membership?.pensum ?? 100,
      baseWeeklyHours: membership?.baseWeeklyHours ?? null,
      basePensum: membership?.basePensum ?? null,
      vacationDays: membership?.vacationDays ?? 25,
      // Kürzel für den Stundenrapport-Export (app/api/export/stundenrapport)
      // — frei pflegbar, keine Ableitung aus dem Namen.
      kuerzel: membership?.kuerzel ?? "",
      // Gesetzliche Höchstarbeitszeit der Organisation (Art. 12/13 ArG,
      // MIGRATION.md Punkt 6a) — für die Kalender-Kennzahlenberechnung.
      maxWeeklyHours: (membership as any)?.org?.maxWeeklyHours ?? 45,
      startDate: membership?.startDate?.toISOString?.() ?? null,
      // Nur lesend — Austrittsdatum wird ausschliesslich über /admin/team
      // gesetzt (MIGRATION.md Punkt 4c), nicht von der Person selbst.
      exitDate: membership?.exitDate?.toISOString?.() ?? null,
      language: user?.language ?? "de",
      standardWeek: {
        mon: membership?.stdHoursMon ?? 0,
        tue: membership?.stdHoursTue ?? 0,
        wed: membership?.stdHoursWed ?? 0,
        thu: membership?.stdHoursThu ?? 0,
        fri: membership?.stdHoursFri ?? 0,
        sat: membership?.stdHoursSat ?? 0,
        sun: membership?.stdHoursSun ?? 0,
      },
    });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { userId, orgId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const userUpdateData: any = {};
    const membershipUpdateData: any = {};

    // Identität bleibt auf User, Arbeitseinstellungen wandern auf Membership
    // (MIGRATION.md Punkt 3a).
    if (body?.firstName !== undefined) userUpdateData.firstName = body.firstName;
    if (body?.lastName !== undefined) userUpdateData.lastName = body.lastName;
    if (body?.language !== undefined) userUpdateData.language = body.language;

    if (body?.weeklyHours !== undefined) membershipUpdateData.weeklyHours = body.weeklyHours;
    if (body?.pensum !== undefined) membershipUpdateData.pensum = body.pensum;
    if (body?.vacationDays !== undefined) membershipUpdateData.vacationDays = body.vacationDays;
    if (body?.startDate !== undefined) membershipUpdateData.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body?.kuerzel !== undefined) membershipUpdateData.kuerzel = body.kuerzel?.trim?.() || null;

    // Standard week (Stunden pro Wochentag, 0-24 clamped)
    const clampDay = (v: any) => Math.max(0, Math.min(24, Number(v) || 0));
    if (body?.standardWeek && typeof body.standardWeek === "object") {
      const sw = body.standardWeek;
      if (sw.mon !== undefined) membershipUpdateData.stdHoursMon = clampDay(sw.mon);
      if (sw.tue !== undefined) membershipUpdateData.stdHoursTue = clampDay(sw.tue);
      if (sw.wed !== undefined) membershipUpdateData.stdHoursWed = clampDay(sw.wed);
      if (sw.thu !== undefined) membershipUpdateData.stdHoursThu = clampDay(sw.thu);
      if (sw.fri !== undefined) membershipUpdateData.stdHoursFri = clampDay(sw.fri);
      if (sw.sat !== undefined) membershipUpdateData.stdHoursSat = clampDay(sw.sat);
      if (sw.sun !== undefined) membershipUpdateData.stdHoursSun = clampDay(sw.sun);
    }

    const [user] = await Promise.all([
      Object.keys(userUpdateData).length > 0
        ? prisma.user.update({ where: { id: userId }, data: userUpdateData })
        : prisma.user.findUnique({ where: { id: userId } }),
      Object.keys(membershipUpdateData).length > 0
        ? prisma.membership.update({ where: { orgId_userId: { orgId, userId } }, data: membershipUpdateData })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ success: true, user: { firstName: user?.firstName, lastName: user?.lastName } });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { userId } = await requireOrg();

    const body = await req?.json?.().catch(() => ({}));
    const { currentPassword, newPassword } = body ?? {};

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Missing passwords" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const passwordCheck = checkPasswordPolicy(newPassword);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // mustSetPassword hier immer mitlöschen: dieser Endpunkt ist auch der Weg,
    // über den set-password/page.tsx die erzwungene Passwortänderung nach der
    // Migration abschliesst.
    await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword, mustSetPassword: false } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
