"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Lock, Eye, EyeOff, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    if (!code?.trim?.() || !firstName?.trim?.()) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        code: code?.trim?.() ?? "",
        firstName: firstName?.trim?.() ?? "",
        email: "",
        password: "",
      });
      if (result?.ok) {
        router.replace("/calendar");
      } else {
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
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t("login.firstName")}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={firstName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")}
                  placeholder={t("login.firstNamePlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t("login.code")}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showCode ? "text" : "password"}
                  maxLength={8}
                  value={code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e?.target?.value ?? "")}
                  placeholder={t("login.codePlaceholder")}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-secondary text-foreground text-center tracking-[0.3em] font-mono text-lg placeholder:tracking-normal placeholder:text-sm placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                />
                <button type="button" onClick={() => setShowCode(!showCode)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition">
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <button type="submit" disabled={loading || (code?.length ?? 0) < 4 || !firstName?.trim?.()} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">
              {loading ? t("common.loading") : t("login.submit")}
            </button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/forgot-code" className="text-sm text-primary hover:underline">{t("login.forgotCode")}</Link>
          </div>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          {t("login.noAccount")} <Link href="/register" className="text-primary font-medium hover:underline">{t("login.register")}</Link>
        </p>
      </motion.div>
    </div>
  );
}
