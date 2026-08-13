"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Lock, CheckCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";

function ResetPasswordForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const token = searchParams?.get?.("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (!token) { setError(t("reset.error.noToken")); return; }
    if (newPassword !== confirmPassword) { setError(t("register.error.passwordMismatch")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setError(data?.error ?? t("common.error"));
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      console.error(err);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
      <h1 className="text-xl font-display font-semibold text-center mb-5">{t("reset.title")}</h1>
      {success ? (
        <div className="text-center space-y-4">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <p className="text-sm font-medium">{t("reset.success")}</p>
          <Link href="/login" className="inline-block px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">{t("forgot.backToLogin")}</Link>
        </div>
      ) : !token ? (
        <p className="text-sm text-destructive text-center">{t("reset.error.noToken")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> {t("reset.newPassword")}</label>
            <input type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoFocus autoComplete="new-password" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.confirmPassword")}</label>
            <input type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
          </div>
          <p className="text-xs text-muted-foreground">{t("register.passwordHint")}</p>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("reset.submit")}</button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6"><div className="relative w-36 h-12 mb-1"><Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority /></div></div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
