"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, Briefcase, Calendar, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [pensum, setPensum] = useState("");
  const [vacationDays, setVacationDays] = useState("");
  const [startDate, setStartDate] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (!firstName?.trim?.() || !lastName?.trim?.() || !email?.trim?.()) { setError(t("register.error.required")); return; }
    if ((password?.length ?? 0) < MIN_PASSWORD_LENGTH) { setError(t("register.error.passwordFormat")); return; }
    if (password !== confirmPassword) { setError(t("register.error.passwordMismatch")); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName?.trim?.(), lastName: lastName?.trim?.(), email: email?.trim?.(), password,
          weeklyHours: weeklyHours ? parseFloat(weeklyHours) : undefined,
          pensum: pensum ? parseFloat(pensum) : undefined,
          vacationDays: vacationDays ? parseFloat(vacationDays) : undefined,
          startDate: startDate || undefined,
        }),
      });
      if (!res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setError(data?.error ?? t("common.error"));
        setLoading(false);
        return;
      }
      const result = await signIn("credentials", { redirect: false, email: email?.trim?.() ?? "", password });
      if (result?.ok) { router.replace("/calendar"); } else { router.replace("/login"); }
    } catch (err: any) { console.error(err); setError(t("common.error")); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="relative w-36 h-12 mb-1"><Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority /></div>
          <p className="text-sm text-muted-foreground">Zeiterfassung</p>
        </div>
        <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <h1 className="text-xl font-display font-semibold text-center mb-5">{t("register.title")}</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.firstName")} *</label>
                <input type="text" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.lastName")} *</label>
                <input type="text" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.email")} *</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="email" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.password")} *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.confirmPassword")} *</label>
                <input type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("register.passwordHint")}</p>
            {/* Optional */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> {t("register.optional")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.weeklyHours")}</label>
                  <div className="relative"><Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="number" step="0.5" min="0" max="100" value={weeklyHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const v = e?.target?.value ?? "";
                    if (v === "") { setWeeklyHours(""); return; }
                    const n = parseFloat(v);
                    if (isNaN(n)) return;
                    setWeeklyHours(n < 0 ? "0" : n > 100 ? "100" : v);
                  }} placeholder="42" className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.pensum")}</label>
                  <input type="number" step="5" min="0" max="200" value={pensum} onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const v = e?.target?.value ?? "";
                    if (v === "") { setPensum(""); return; }
                    const n = parseFloat(v);
                    if (isNaN(n)) return;
                    setPensum(n < 0 ? "0" : n > 200 ? "200" : v);
                  }} placeholder="100" className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.vacationDays")}</label>
                  <div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="number" step="0.5" min="0" max="100" value={vacationDays} onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const v = e?.target?.value ?? "";
                    if (v === "") { setVacationDays(""); return; }
                    const n = parseFloat(v);
                    if (isNaN(n)) return;
                    setVacationDays(n < 0 ? "0" : n > 100 ? "100" : v);
                  }} placeholder="25" className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.startDate")}</label>
                  <input type="date" value={startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
                </div>
              </div>
            </div>
            <div className="bg-primary/5 rounded-xl p-3"><p className="text-xs text-primary flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{t("register.note")}</p></div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("register.submit")}</button>
          </form>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">{t("register.hasAccount")} <Link href="/login" className="text-primary font-medium hover:underline">{t("register.login")}</Link></p>
      </motion.div>
    </div>
  );
}
