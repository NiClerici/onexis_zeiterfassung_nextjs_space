// Zugriffshelfer für Mandantenfähigkeit (MIGRATION.md Punkt 3c). Jede
// API-Route muss über orgId scopen und darf nie ohne Prüfung auf fremde
// userId zugreifen — diese Helfer sind der einzige Weg dorthin, damit sich
// die Prüfung nicht in 14 Routen unterschiedlich buggy wiederholt.
//
// Nutzung in einer Route (passt zum bestehenden try/catch-Stil):
//
//   try {
//     const { userId, orgId, role } = await requireOrg();
//     requireRole(role, ["admin", "manager"]);
//     const rows = await prisma.timeEntry.findMany({ where: scopeToOrg(orgId, { userId }) });
//     ...
//   } catch (error: any) {
//     if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
//     console.error(error);
//     return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
//   }

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export type Role = "owner" | "admin" | "manager" | "member";

export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OrgContext {
  userId: string;
  orgId: string;
  role: Role;
}

// Wirft 401, wenn keine gültige Session vorliegt.
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new AccessError(401, "Unauthorized");
  return session;
}

// Wirft 401 ohne Session, 403 ohne Organisation (z.B. ein Nutzer ohne
// Membership — sollte es nach Punkt 4 nicht mehr geben, aber Punkt 3 baut
// noch keine vollständige Registrierung/Einladung).
export async function requireOrg(): Promise<OrgContext> {
  const session = await requireSession();
  const userId = (session.user as any)?.id;
  const orgId = (session.user as any)?.orgId;
  const role = (session.user as any)?.role as Role | undefined;
  if (!userId || !orgId || !role) throw new AccessError(403, "Keine Organisation zugeordnet");
  return { userId, orgId, role };
}

// Wirft 403, wenn die Rolle nicht in der erlaubten Liste ist.
export function requireRole(role: Role, allowed: Role[]): void {
  if (!allowed.includes(role)) throw new AccessError(403, "Forbidden");
}

// Hängt orgId an ein Prisma-where — Kurzform, damit kein Aufruf vergisst zu scopen.
export function scopeToOrg<T extends Record<string, unknown>>(orgId: string, where?: T): T & { orgId: string } {
  return { ...(where ?? ({} as T)), orgId };
}

// Monatsabschluss (MIGRATION.md Punkt 6e). Existenz einer MonthLock-Zeile
// heisst "gesperrt".
export async function isMonthLocked(orgId: string, userId: string, date: Date): Promise<boolean> {
  const lock = await prisma.monthLock.findUnique({
    where: {
      orgId_userId_year_month: {
        orgId,
        userId,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
      },
    },
  });
  return Boolean(lock);
}

// Wirft 403, wenn role "member" ist und der Monat von date gesperrt ist.
// Bewusst nur "member" betroffen — der Punkt-Text sagt ausdrücklich
// "Gesperrte Monate sind für member read-only" und nennt manager/admin/owner
// nicht; die sollen weiterhin auch in gesperrten Monaten korrigieren können,
// ohne vorher extra entsperren zu müssen (siehe Notizen des Loops zu 6e).
export async function assertMonthEditable(orgId: string, userId: string, role: Role, date: Date): Promise<void> {
  if (role !== "member") return;
  if (await isMonthLocked(orgId, userId, date)) {
    throw new AccessError(403, "Dieser Monat ist abgeschlossen und für dich schreibgeschützt.");
  }
}

// member: nur sich selbst. manager: sich selbst + direkt unterstellte
// Mitglieder (Membership.managerId zeigt auf die eigene Membership).
// admin/owner: alle in der Organisation.
export async function canSeeUser(ctx: OrgContext, targetUserId: string): Promise<boolean> {
  if (ctx.userId === targetUserId) return true;
  if (ctx.role === "admin" || ctx.role === "owner") return true;
  if (ctx.role === "manager") {
    const [ownMembership, targetMembership] = await Promise.all([
      prisma.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } }),
      prisma.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: targetUserId } } }),
    ]);
    return Boolean(ownMembership && targetMembership && targetMembership.managerId === ownMembership.id);
  }
  return false;
}

// Liste statt Einzelprüfung derselben Sichtbarkeits-Hierarchie wie
// canSeeUser() — gebraucht von Routen, die eine ganze Team-Übersicht bauen
// (/api/team, /api/export?scope=org, /api/absence-requests?scope=team,
// /api/absences/calendar, MIGRATION.md Punkt 8/9). Rückgabe `null` bedeutet
// "keine Einschränkung" (admin/owner sehen die ganze Organisation) statt
// einer expliziten, potenziell sehr langen userId-Liste — Aufrufer müssen
// `null` deshalb gesondert behandeln (kein Prisma-`userId: { in: [] }`,
// das null Zeilen träfe).
export async function listVisibleUserIds(ctx: OrgContext): Promise<string[] | null> {
  if (ctx.role === "admin" || ctx.role === "owner") return null;
  if (ctx.role === "manager") {
    const ownMembership = await prisma.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } });
    if (!ownMembership) return [ctx.userId];
    const reports = await prisma.membership.findMany({ where: { orgId: ctx.orgId, managerId: ownMembership.id }, select: { userId: true } });
    return [ctx.userId, ...reports.map((r) => r.userId)];
  }
  return [ctx.userId];
}
