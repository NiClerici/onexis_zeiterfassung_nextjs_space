"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, CheckCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    if (!email?.trim?.()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Der Server antwortet bewusst immer mit derselben generischen Meldung,
      // egal ob die E-Mail existiert — kein Rätselraten hier über res?.ok hinaus.
      if (res?.ok) {
        setSent(true);
      } else {
        const data = await res?.json?.().catch(() => ({}));
        setError(data?.error ?? t("common.error"));
      }
    } catch (err: any) {
      console.error(err);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6"><div className="relative w-36 h-12 mb-1"><Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority /></div></div>
        <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <h1 className="text-xl font-display font-semibold text-center mb-5">{t("forgot.title")}</h1>
          {sent ? (
            <div className="text-center space-y-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-sm">{t("forgot.sent")}</p>
              <Link href="/login" className="inline-block px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">{t("forgot.backToLogin")}</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">{t("forgot.description")}</p>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("forgot.email")}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoFocus autoComplete="email" />
                </div>
              </div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <button type="submit" disabled={loading || !email?.trim?.()} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("forgot.submit")}</button>
            </form>
          )}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6"><Link href="/login" className="text-primary font-medium hover:underline">{t("forgot.backToLogin")}</Link></p>
      </motion.div>
    </div>
  );
}
