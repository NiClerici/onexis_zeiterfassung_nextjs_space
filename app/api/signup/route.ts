export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { logError } from "@/lib/error-log";

const TRIAL_DAYS = 14;

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { firstName, lastName, email, password, companyName, weeklyHours, pensum, vacationDays, startDate } = body ?? {};

    if (!firstName?.trim?.() || !lastName?.trim?.() || !email?.trim?.() || !companyName?.trim?.()) {
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

    // Slug aus dem Firmennamen, nicht mehr aus der E-Mail — der Firmenname ist
    // das, was tatsächlich in der Organisation angezeigt wird.
    const slugBase = companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
    let slug = slugBase;
    let counter = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${slugBase}-${counter}`;
      counter++;
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: companyName.trim(), slug, plan: "trial", trialEndsAt },
      });
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          mustSetPassword: false,
          language: "de",
        },
      });
      await tx.membership.create({
        data: {
          orgId: org.id,
          userId: user.id,
          role: "owner",
          entryDate: startDate ? new Date(startDate) : new Date(),
          weeklyHours: weeklyHours ?? 42,
          pensum: pensum ?? 100,
          vacationDays: vacationDays ?? 25,
          startDate: startDate ? new Date(startDate) : null,
        },
      });
      return { user };
    });

    return NextResponse.json({ id: user.id, email: user.email });
  } catch (error: any) {
    console.error("Signup error:", error);
    await logError("POST /api/signup", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
