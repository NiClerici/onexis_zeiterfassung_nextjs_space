export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { firstName, lastName, code, securityQuestions, weeklyHours, pensum, vacationDays, startDate, email, password } = body ?? {};

    // Standard email+password signup (test framework)
    if (email && password) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ error: "User already exists" }, { status: 400 });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const hashedCode = await bcrypt.hash("0000", 10); // default code
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName: firstName ?? email?.split?.("@")?.[0] ?? "User",
          lastName: lastName ?? "",
          code: hashedCode,
          weeklyHours: weeklyHours ?? 42,
          pensum: pensum ?? 100,
          vacationDays: vacationDays ?? 25,
          startDate: startDate ? new Date(startDate) : null,
          language: "de",
        },
      });
      return NextResponse.json({ id: user.id, email: user.email });
    }

    // Code-based signup (app UI)
    if (!firstName?.trim?.() || !lastName?.trim?.() || !code) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if ((code?.length ?? 0) < 4 || (code?.length ?? 0) > 8) {
      return NextResponse.json({ error: "Code must be 4-8 characters" }, { status: 400 });
    }

    const generatedEmail = `${(firstName ?? "")?.toLowerCase?.()?.replace?.(/\s+/g, "")}.${(lastName ?? "")?.toLowerCase?.()?.replace?.(/\s+/g, "")}@onexis.internal`;
    
    // Check if email already exists, append number if needed
    let finalEmail = generatedEmail;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { email: finalEmail } })) {
      finalEmail = `${(firstName ?? "")?.toLowerCase?.()?.replace?.(/\s+/g, "")}.${(lastName ?? "")?.toLowerCase?.()?.replace?.(/\s+/g, "")}${counter}@onexis.internal`;
      counter++;
    }

    const hashedCode = await bcrypt.hash(code, 10);
    const hashedPassword = await bcrypt.hash(code, 10); // use code as password too

    const user = await prisma.user.create({
      data: {
        email: finalEmail,
        password: hashedPassword,
        firstName: firstName?.trim?.() ?? "",
        lastName: lastName?.trim?.() ?? "",
        code: hashedCode,
        weeklyHours: weeklyHours ?? 42,
        pensum: pensum ?? 100,
        vacationDays: vacationDays ?? 25,
        startDate: startDate ? new Date(startDate) : null,
        language: "de",
      },
    });

    // Create security questions
    if (Array.isArray(securityQuestions)) {
      for (const sq of securityQuestions) {
        if (sq?.question && sq?.answer) {
          await prisma.securityQuestion.create({
            data: {
              userId: user.id,
              question: sq.question,
              answer: sq?.answer?.trim?.()?.toLowerCase?.() ?? "",
            },
          });
        }
      }
    }

    return NextResponse.json({ id: user.id, email: user.email });
  } catch (error: any) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
