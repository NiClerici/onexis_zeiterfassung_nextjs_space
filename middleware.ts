import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isTrialExpired } from "@/lib/billing-rules";

// Bisherige Seiten-Auth (vorher next-auth/middleware withAuth) — hier
// manuell nachgebildet, damit dieselbe Middleware-Datei zusätzlich die
// Trial-Ablauf-Prüfung unten übernehmen kann (Next.js erlaubt nur eine
// middleware.ts). Verhalten unverändert: ohne gültiges Token auf /login
// umleiten, mit callbackUrl zurück zur ursprünglich angefragten Seite.
// /dev (Developer-Übersicht, lib/dev-access.ts) steht hier nur für den
// Login-Redirect — die eigentliche E-Mail-Allowlist (DEVELOPER_EMAILS) wird
// bewusst NICHT hier geprüft: die Edge-Runtime bekommt process.env beim
// BUILD eingefroren, nicht zur Laufzeit von docker-compose. requireDeveloper()
// in app/(dev)/dev/page.tsx prüft sie stattdessen serverseitig (Node-Runtime,
// echte Laufzeit-ENV) und liefert 404 für jede nicht gelistete E-Mail.
const PROTECTED_PAGE_PREFIXES = ["/calendar", "/analytics", "/profile", "/set-password", "/dev"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Diese API-Pfade bleiben immer nutzbar, auch für eine read-only
// Organisation (abgelaufener Trial, MIGRATION.md Punkt 12): Auth/Signup
// laufen ausserhalb einer bestehenden Mitgliedschaft, Health ist ein
// reiner Infrastruktur-Check ohne Org-Bezug. /api/dev betrifft NICHT die
// eigene Organisation des Aufrufenden, sondern verändert eine FREMDE
// (lib/dev-actions.ts, z.B. Trial dieser fremden Org verlängern) — ohne
// diese Ausnahme könnte ein abgelaufener Trial der EIGENEN Organisation des
// Betreibers genau die Aktion blockieren, mit der ein anderer Trial
// verlängert werden soll.
const READONLY_EXEMPT_PREFIXES = ["/api/auth", "/api/signup", "/api/health", "/api/dev"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req });

  if (PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!token) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Trial-Ablauf (MIGRATION.md Punkt 12): mutierende API-Aufrufe einer
  // Organisation im abgelaufenen Trial blockieren. Bewusst NUR dieser eine
  // zusätzliche Fall — nicht authentifizierte oder nicht-read-only-Aufrufe
  // laufen unverändert weiter zur Route, die ihre eigene 401/403-Antwort
  // liefert (requireOrg() in lib/access.ts), keine Middleware-Umleitung.
  if (
    pathname.startsWith("/api/") &&
    MUTATING_METHODS.has(req.method) &&
    !READONLY_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    if (token && isTrialExpired((token as any).plan, (token as any).trialEndsAt)) {
      return NextResponse.json(
        { error: "Der Testzeitraum ist abgelaufen. Diese Organisation ist schreibgeschützt, bis ein Plan gewählt wird." },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/calendar/:path*", "/analytics/:path*", "/profile/:path*", "/set-password/:path*", "/dev/:path*", "/api/:path*"],
};
