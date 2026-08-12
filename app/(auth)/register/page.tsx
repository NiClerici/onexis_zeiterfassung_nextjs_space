"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { User, Lock, HelpCircle, Briefcase, Calendar, Info } from "lucide-react";
import { useI18n, securityQuestionKeys } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [q1Key, setQ1Key] = useState(securityQuestionKeys?.[0] ?? "sq.pet");
  const [q1Custom, setQ1Custom] = useState("");
  const [a1, setA1] = useState("");
  const [q2Key, setQ2Key] = useState(securityQuestionKeys?.[1] ?? "sq.city");
  const [q2Custom, setQ2Custom] = useState("");
  const [a2, setA2] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [pensum, setPensum] = useState("");
  const [vacationDays, setVacationDays] = useState("");
  const [startDate, setStartDate] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (!firstName?.trim?.() || !lastName?.trim?.()) { setError(t("register.error.required")); return; }
    if ((code?.length ?? 0) < 4 || (code?.length ?? 0) > 8) { setError(t("register.error.codeFormat")); return; }
    if (code !== confirmCode) { setError(t("register.error.codeMismatch")); return; }
    const question1 = q1Key === "sq.custom" ? q1Custom?.trim?.() ?? "" : q1Key;
    const question2 = q2Key === "sq.custom" ? q2Custom?.trim?.() ?? "" : q2Key;
    if (!question1 || !a1?.trim?.() || !question2 || !a2?.trim?.()) { setError(t("register.error.securityQuestions")); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName?.trim?.(), lastName: lastName?.trim?.(), code: code?.trim?.(),
          securityQuestions: [
            { question: question1, answer: a1?.trim?.()?.toLowerCase?.() ?? "" },
            { question: question2, answer: a2?.trim?.()?.toLowerCase?.() ?? "" },
          ],
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
      const result = await signIn("credentials", { redirect: false, code: code?.trim?.(), email: "", password: "" });
      if (result?.ok) { router.replace("/calendar"); } else { router.replace("/login"); }
    } catch (err: any) { console.error(err); setError(t("common.error")); } finally { setLoading(false); }
  };

  const questionOptions = securityQuestionKeys?.map?.((key: string) => ({ value: key, label: t(key) })) ?? [];

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
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="text" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.lastName")} *</label>
                <input type="text" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.code")} *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="password" maxLength={8} value={code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.confirmCode")} *</label>
                <input type="password" maxLength={8} value={confirmCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmCode(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
              </div>
            </div>
            {/* Security Question 1 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" /> {t("register.question1")} *</label>
              <select value={q1Key} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setQ1Key(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition mb-2">
                {questionOptions?.map?.((opt: any) => (<option key={opt?.value} value={opt?.value}>{opt?.label}</option>))}
              </select>
              {q1Key === "sq.custom" && <input type="text" value={q1Custom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ1Custom(e?.target?.value ?? "")} placeholder={t("register.customQuestion")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition mb-2" />}
              <input type="text" value={a1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setA1(e?.target?.value ?? "")} placeholder={t("register.answer1")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
            </div>
            {/* Security Question 2 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" /> {t("register.question2")} *</label>
              <select value={q2Key} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setQ2Key(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition mb-2">
                {questionOptions?.map?.((opt: any) => (<option key={opt?.value} value={opt?.value}>{opt?.label}</option>))}
              </select>
              {q2Key === "sq.custom" && <input type="text" value={q2Custom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ2Custom(e?.target?.value ?? "")} placeholder={t("register.customQuestion")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition mb-2" />}
              <input type="text" value={a2} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setA2(e?.target?.value ?? "")} placeholder={t("register.answer2")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
            </div>
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
