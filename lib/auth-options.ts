import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getClientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();
        const ip = getClientIp(req);

        try {
          // Max. 10 Fehlversuche pro E-Mail und IP in 15 Minuten (lib/rate-limit.ts).
          // Bewusst KEINE weitere Zeile in LoginAttempt, solange die Sperre schon
          // aktiv ist — sonst könnte ein andauernder Angriff die Tabelle fluten.
          if (await isRateLimited("login", email, ip)) {
            return null;
          }

          const user = await prisma.user.findUnique({ where: { email } });
          const isValid = user ? await bcrypt.compare(credentials.password, user.password) : false;
          await recordAttempt("login", email, ip, isValid);
          if (!user || !isValid) return null;

          // Ein Mensch kann später in mehreren Organisationen sein (MIGRATION.md
          // Punkt 3) — hier wird bewusst die zuerst beigetretene genommen, bis
          // eine Org-Wechsel-UI existiert (nicht Teil von Punkt 3/4). Deaktivierte
          // Mitgliedschaften (status "inaktiv", Punkt 4c) zählen dabei nicht —
          // sonst würde "deaktivieren" in /admin/team nichts bewirken.
          const membership = await prisma.membership.findFirst({
            where: { userId: user.id, status: "aktiv" },
            orderBy: { createdAt: "asc" },
          });

          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`.trim(),
            mustSetPassword: user.mustSetPassword,
            orgId: membership?.orgId ?? null,
            role: membership?.role ?? null,
          } as any;
        } catch (error: any) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,   // 24 Stunden
    updateAge: 60 * 60,      // Token stündlich erneuern
  },
  callbacks: {
    async jwt({ token, user, trigger, session }: any) {
      if (user) {
        token.id = user?.id;
        token.mustSetPassword = user?.mustSetPassword ?? false;
        token.orgId = user?.orgId ?? null;
        token.role = user?.role ?? null;
      }
      // Wird von set-password/page.tsx nach erfolgreichem Setzen des neuen
      // Passworts über useSession().update() ausgelöst, damit die Sperre ohne
      // Neu-Login verschwindet.
      if (trigger === "update" && session?.mustSetPassword !== undefined) {
        token.mustSetPassword = session.mustSetPassword;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        (session.user as any).id = token?.id;
        (session.user as any).mustSetPassword = token?.mustSetPassword ?? false;
        (session.user as any).orgId = token?.orgId ?? null;
        (session.user as any).role = token?.role ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
