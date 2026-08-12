export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

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
      const questions = await prisma.securityQuestion.findMany({ where: { userId }, orderBy: { id: "asc" } });
      if ((questions?.length ?? 0) === 0) {
        return NextResponse.json({ error: "No security questions" }, { status: 400 });
      }
      // Case-sensitive comparison. User only needs to answer one question correctly.
      let anyCorrect = false;
      for (let i = 0; i < (questions?.length ?? 0); i++) {
        const expected = questions?.[i]?.answer?.trim?.() ?? "";
        const given = answers?.[i]?.trim?.() ?? "";
        if (given !== "" && expected === given) {
          anyCorrect = true;
          break;
        }
      }
      if (!anyCorrect) {
        return NextResponse.json({ error: "Wrong answers" }, { status: 401 });
      }
      return NextResponse.json({ success: true });
    }

    if (step === 3) {
      const { userId, newCode } = body ?? {};
      if ((newCode?.length ?? 0) < 4 || (newCode?.length ?? 0) > 8) {
        return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
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
