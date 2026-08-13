"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { User, HelpCircle, Lock, CheckCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";

export default function ForgotCodePage() {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [questions, setQuestions] = useState<Array<{ question: string }>>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [userId, setUserId] = useState("");

  const handleStep1 = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 1, firstName: firstName?.trim?.(), lastName: lastName?.trim?.() }) });
      const data = await res?.json?.().catch(() => ({}));
      if (!res?.ok) { setError(data?.error ?? t("forgot.error.userNotFound")); } else { setQuestions(data?.questions ?? []); setAnswers(new Array(data?.questions?.length ?? 0).fill("")); setUserId(data?.userId ?? ""); setStep(2); }
    } catch (err: any) { console.error(err); setError(t("common.error")); } finally { setLoading(false); }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 2, userId, answers: answers?.map?.((a: string) => a?.trim?.() ?? "") ?? [] }) });
      const data = await res?.json?.().catch(() => ({}));
      if (!res?.ok) { setError(data?.error ?? t("forgot.error.wrongAnswers")); } else { setStep(3); }
    } catch (err: any) { console.error(err); setError(t("common.error")); } finally { setLoading(false); }
  };

  const handleStep3 = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (newCode !== confirmCode) { setError(t("register.error.codeMismatch")); return; }
    if ((newCode?.length ?? 0) < 4 || (newCode?.length ?? 0) > 8) { setError(t("register.error.codeFormat")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 3, userId, answers: answers?.map?.((a: string) => a?.trim?.() ?? "") ?? [], newCode }) });
      if (!res?.ok) { const data = await res?.json?.().catch(() => ({})); setError(data?.error ?? t("common.error")); } else { setSuccess(true); }
    } catch (err: any) { console.error(err); setError(t("common.error")); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6"><div className="relative w-36 h-12 mb-1"><Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority /></div></div>
        <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
          <h1 className="text-xl font-display font-semibold text-center mb-5">{t("forgot.title")}</h1>
          {success ? (
            <div className="text-center space-y-4"><CheckCircle className="w-12 h-12 text-green-500 mx-auto" /><p className="text-sm font-medium">{t("forgot.success")}</p><Link href="/login" className="inline-block px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">{t("forgot.backToLogin")}</Link></div>
          ) : step === 1 ? (
            <form onSubmit={handleStep1} className="space-y-4">
              <p className="text-xs text-muted-foreground font-medium">{t("forgot.step1")}</p>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("forgot.firstName")}</label><div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input type="text" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required /></div></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("forgot.lastName")}</label><input type="text" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required /></div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("forgot.next")}</button>
            </form>
          ) : step === 2 ? (
            <form onSubmit={handleStep2} className="space-y-4">
              <p className="text-xs text-muted-foreground font-medium">{t("forgot.step2")}</p>
              <div className="bg-primary/5 rounded-xl p-3 space-y-1">
                <p className="text-xs text-primary">{t("forgot.answerOne")}</p>
                <p className="text-xs text-primary">{t("forgot.caseSensitive")}</p>
              </div>
              {questions?.map?.((q: any, i: number) => (<div key={i}><label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><HelpCircle className="w-3.5 h-3.5" />{q?.question?.startsWith?.("sq.") ? t(q.question) : q?.question}</label><input type="text" value={answers?.[i] ?? ""} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const na = [...(answers ?? [])]; na[i] = e?.target?.value ?? ""; setAnswers(na); }} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" /></div>)) ?? null}
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <button type="submit" disabled={loading || !(answers?.some?.((a: string) => (a?.trim?.()?.length ?? 0) > 0))} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("forgot.next")}</button>
            </form>
          ) : (
            <form onSubmit={handleStep3} className="space-y-4">
              <p className="text-xs text-muted-foreground font-medium">{t("forgot.step3")}</p>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> {t("forgot.newCode")}</label><input type="password" maxLength={8} value={newCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCode(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("forgot.confirmCode")}</label><input type="password" maxLength={8} value={confirmCode} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmCode(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required /></div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">{loading ? t("common.loading") : t("forgot.submit")}</button>
            </form>
          )}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6"><Link href="/login" className="text-primary font-medium hover:underline">{t("forgot.backToLogin")}</Link></p>
      </motion.div>
    </div>
  );
}
