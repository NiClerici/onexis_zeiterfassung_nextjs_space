import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        code: { label: "Code", type: "text" },
        firstName: { label: "First Name", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) return null;

        try {
          // Code-based login with firstName (app UI)
          if (credentials.code && credentials.code.trim() !== "" && credentials.firstName && credentials.firstName.trim() !== "") {
            const users = await prisma.user.findMany({
              where: {
                firstName: {
                  equals: credentials.firstName.trim(),
                  mode: "insensitive",
                },
              },
              take: 5,
            });
            for (const user of users) {
              const isValid = await bcrypt.compare(credentials.code, user?.code ?? "");
              if (isValid) {
                return {
                  id: user.id,
                  email: user.email,
                  name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
                };
              }
            }
            return null;
          }

          // Email+password login (test framework)
          if (credentials.email && credentials.password) {
            const user = await prisma.user.findUnique({
              where: { email: credentials.email },
            });
            if (!user) return null;
            const isValid = await bcrypt.compare(credentials.password, user?.password ?? "");
            if (!isValid) return null;
            return {
              id: user.id,
              email: user.email,
              name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
            };
          }

          return null;
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
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user?.id;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        (session.user as any).id = token?.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
