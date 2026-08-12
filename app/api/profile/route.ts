export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { securityQuestions: { select: { id: true, question: true, answer: true } } },
    });

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      weeklyHours: user?.weeklyHours ?? 42,
      pensum: user?.pensum ?? 100,
      baseWeeklyHours: user?.baseWeeklyHours ?? null,
      basePensum: user?.basePensum ?? null,
      vacationDays: user?.vacationDays ?? 25,
      startDate: user?.startDate?.toISOString?.() ?? null,
      language: user?.language ?? "de",
      standardWeek: {
        mon: user?.stdHoursMon ?? 0,
        tue: user?.stdHoursTue ?? 0,
        wed: user?.stdHoursWed ?? 0,
        thu: user?.stdHoursThu ?? 0,
        fri: user?.stdHoursFri ?? 0,
        sat: user?.stdHoursSat ?? 0,
        sun: user?.stdHoursSun ?? 0,
      },
      securityQuestions: user?.securityQuestions ?? [],
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const updateData: any = {};

    if (body?.firstName !== undefined) updateData.firstName = body.firstName;
    if (body?.lastName !== undefined) updateData.lastName = body.lastName;
    if (body?.weeklyHours !== undefined) updateData.weeklyHours = body.weeklyHours;
    if (body?.pensum !== undefined) updateData.pensum = body.pensum;
    if (body?.vacationDays !== undefined) updateData.vacationDays = body.vacationDays;
    if (body?.startDate !== undefined) updateData.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body?.language !== undefined) updateData.language = body.language;

    // Standard week (Stunden pro Wochentag, 0-24 clamped)
    const clampDay = (v: any) => Math.max(0, Math.min(24, Number(v) || 0));
    if (body?.standardWeek && typeof body.standardWeek === "object") {
      const sw = body.standardWeek;
      if (sw.mon !== undefined) updateData.stdHoursMon = clampDay(sw.mon);
      if (sw.tue !== undefined) updateData.stdHoursTue = clampDay(sw.tue);
      if (sw.wed !== undefined) updateData.stdHoursWed = clampDay(sw.wed);
      if (sw.thu !== undefined) updateData.stdHoursThu = clampDay(sw.thu);
      if (sw.fri !== undefined) updateData.stdHoursFri = clampDay(sw.fri);
      if (sw.sat !== undefined) updateData.stdHoursSat = clampDay(sw.sat);
      if (sw.sun !== undefined) updateData.stdHoursSun = clampDay(sw.sun);
    }

    const user = await prisma.user.update({ where: { id: userId }, data: updateData });
    return NextResponse.json({ success: true, user: { firstName: user?.firstName, lastName: user?.lastName } });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { currentCode, newCode } = body ?? {};

    if (!currentCode || !newCode) {
      return NextResponse.json({ error: "Missing codes" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if ((newCode?.length ?? 0) < 4 || (newCode?.length ?? 0) > 8) {
      return NextResponse.json({ error: "Code must be 4-8 characters" }, { status: 400 });
    }

    const isValid = await bcrypt.compare(currentCode, user?.code ?? "");
    if (!isValid) {
      return NextResponse.json({ error: "Invalid current code" }, { status: 401 });
    }

    const hashedCode = await bcrypt.hash(newCode, 10);
    await prisma.user.update({ where: { id: userId }, data: { code: hashedCode, password: hashedCode } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
