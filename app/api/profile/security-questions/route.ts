export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

// Add a single security question
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { question, answer } = body ?? {};

    if (!question || !answer) {
      return NextResponse.json({ error: "Question and answer required" }, { status: 400 });
    }

    const sq = await prisma.securityQuestion.create({
      data: { userId, question, answer: answer.toLowerCase().trim() },
    });

    return NextResponse.json({ success: true, id: sq.id, question: sq.question });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Delete a single security question
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { id } = body ?? {};

    if (!id) {
      return NextResponse.json({ error: "Question ID required" }, { status: 400 });
    }

    await prisma.securityQuestion.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Bulk replace (kept for backward compatibility)
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = (session.user as any)?.id;

    const body = await req?.json?.().catch(() => ({}));
    const { questions } = body ?? {};

    if (!questions || !Array.isArray(questions) || questions.length < 2) {
      return NextResponse.json({ error: "Two security questions required" }, { status: 400 });
    }

    await prisma.securityQuestion.deleteMany({ where: { userId } });

    for (const q of questions) {
      if (!q.question || !q.answer) continue;
      await prisma.securityQuestion.create({
        data: { userId, question: q.question, answer: q.answer.toLowerCase().trim() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
