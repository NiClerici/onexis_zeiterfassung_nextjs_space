export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

// Case-sensitive Vergleich. Ein korrekt beantwortetes Frage genügt.
async function hasCorrectAnswer(userId: string, answers: unknown): Promise<boolean> {
  const questions = await prisma.securityQuestion.findMany({ where: { userId }, orderBy: { id: "asc" } });
  if ((questions?.length ?? 0) === 0) return false;
  for (let i = 0; i < questions.length; i++) {
    const expected = questions[i]?.answer?.trim?.() ?? "";
    const given = (answers as any)?.[i]?.trim?.() ?? "";
    if (given !== "" && expected === given) return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const body = await req?.json?.().catch(() => ({}));
    const { step } = body ?? {};

    if (step === 1) {
      const { firstName, lastName } = body ?? {};
      const user = await prisma.user.findFirst({
        where: {
          firstName: { equals: firstName?.trim?.() ?? "", mode: "insensitive" },
          lastName: { equals: lastName?.trim?.() ?? "", mode: "insensitive" },
        },
        include: { securityQuestions: { select: { question: true } } },
      });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ userId: user.id, questions: user?.securityQuestions ?? [] });
    }

    if (step === 2) {
      const { userId, answers } = body ?? {};
      if (!(await hasCorrectAnswer(userId, answers))) {
        return NextResponse.json({ error: "Wrong answers" }, { status: 401 });
      }
      return NextResponse.json({ success: true });
    }

    if (step === 3) {
      const { userId, answers, newCode } = body ?? {};
      if ((newCode?.length ?? 0) < 4 || (newCode?.length ?? 0) > 8) {
        return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
      }
      // Sicherheitsfrage hier erneut prüfen — Schritt 2 hinterlässt keinen Server-seitigen
      // Zustand, ein Client könnte Schritt 3 sonst direkt mit einer erratenen/bekannten
      // userId aufrufen und die Frage komplett umgehen (userId ist aus Schritt 1 kein Geheimnis).
      if (!(await hasCorrectAnswer(userId, answers))) {
        return NextResponse.json({ error: "Wrong answers" }, { status: 401 });
      }
      const hashedCode = await bcrypt.hash(newCode, 10);
      await prisma.user.update({ where: { id: userId }, data: { code: hashedCode, password: hashedCode } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  } catch (error: any) {
    console.error("Forgot code error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
