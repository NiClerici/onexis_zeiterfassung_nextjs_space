export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOrg, requireRole, AccessError } from "@/lib/access";
import { logError } from "@/lib/error-log";
import { parseLogoDataUrl } from "@/lib/org-logo";

// Firmenlogo für den Kundenrapport-PDF (app/api/export/stundenrapport/route.ts
// → lib/pdf-stundenrapport.ts). JSON-Body statt multipart/form-data: der
// Client liest die Datei über FileReader.readAsDataURL, damit bleibt diese
// Route beim gleichen Stil wie alle anderen Routen im Projekt und braucht
// keinen Multipart-Parser.

export async function GET() {
  try {
    const { orgId } = await requireOrg();
    const logo = await prisma.organizationLogo.findUnique({ where: { orgId } });
    if (!logo) return NextResponse.json({ dataUrl: null });
    return NextResponse.json({ dataUrl: `data:${logo.mimeType};base64,${Buffer.from(logo.data).toString("base64")}` });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GET organization logo error:", error);
    await logError("GET /api/admin/organization/logo", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    const body = await req?.json?.().catch(() => ({}));
    const parsed = parseLogoDataUrl(body?.dataUrl);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    await prisma.organizationLogo.upsert({
      where: { orgId },
      create: { orgId, data: parsed.data, mimeType: parsed.mimeType },
      update: { data: parsed.data, mimeType: parsed.mimeType },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("PUT organization logo error:", error);
    await logError("PUT /api/admin/organization/logo", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { orgId, role } = await requireOrg();
    requireRole(role, ["owner", "admin"]);

    await prisma.organizationLogo.deleteMany({ where: { orgId } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("DELETE organization logo error:", error);
    await logError("DELETE /api/admin/organization/logo", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
