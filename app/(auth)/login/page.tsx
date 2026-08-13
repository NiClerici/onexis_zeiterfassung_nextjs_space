"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Lock, Eye, EyeOff, Mail } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    if (!email?.trim?.() || !password) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email: email?.trim?.() ?? "",
        password: password ?? "",
      });
      if (result?.ok) {
        router.replace("/calendar");
      } else {
        // NextAuth v4 gibt bei jedem authorize()-Fehlschlag denselben generischen
        // Code zurück (egal ob falsches Passwort oder Rate-Limit) — bewusst eine
        // einzige Meldung statt eines Rätselratens anhand des Codes.
        setError(t("login.error"));
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError(t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="relative w-40 h-14 mb-2">
            <Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority />
          </div>
          <p className="text-sm text-muted-foreground">Zeiterfassung</p>
        </div>

        <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <h1 className="text-xl font-display font-semibold text-center mb-6">{t("login.title")}</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t("login.email")}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e?.target?.value ?? "")}
                  placeholder={t("login.emailPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  autoFocus
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t("login.password")}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e?.target?.value ?? "")}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-secondary text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <button type="submit" disabled={loading || !password || !email?.trim?.()} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">
              {loading ? t("common.loading") : t("login.submit")}
            </button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">{t("login.forgotPassword")}</Link>
          </div>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          {t("login.noAccount")} <Link href="/register" className="text-primary font-medium hover:underline">{t("login.register")}</Link>
        </p>
      </motion.div>
    </div>
  );
}
