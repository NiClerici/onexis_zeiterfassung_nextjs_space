export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Healthcheck (MIGRATION.md Punkt 11) — für Docker/Caddy/Uptime-Monitoring.
// Bewusst ohne requireOrg()/Session-Prüfung: ein Healthcheck muss auch dann
// antworten, wenn NextAuth oder die Session-Konfiguration selbst kaputt
// ist — genau das will man bei einem Deployment-Problem zuerst wissen.
// Prüft die einzige externe Abhängigkeit dieser App (PostgreSQL) mit einer
// minimalen Query statt eines echten Modellzugriffs, damit der Check auch
// nach einer fehlgeschlagenen Migration (fehlende Tabelle) noch aussage-
// kräftig bleibt.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" }, { status: 200 });
  } catch (error: any) {
    console.error("Healthcheck failed:", error);
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
