export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkPasswordPolicy } from "@/lib/password-policy";

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { firstName, lastName, email, password, weeklyHours, pensum, vacationDays, startDate } = body ?? {};

    if (!firstName?.trim?.() || !lastName?.trim?.() || !email?.trim?.()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const passwordCheck = checkPasswordPolicy(password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        mustSetPassword: false,
        weeklyHours: weeklyHours ?? 42,
        pensum: pensum ?? 100,
        vacationDays: vacationDays ?? 25,
        startDate: startDate ? new Date(startDate) : null,
        language: "de",
      },
    });

    return NextResponse.json({ id: user.id, email: user.email });
  } catch (error: any) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
