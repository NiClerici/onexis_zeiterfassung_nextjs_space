"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { User, Lock, CheckCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";
import { signIn } from "next-auth/react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Mitglied",
};

function InvitePreview({
  token,
  onLoaded,
}: {
  token: string;
  onLoaded: (data: { email: string; role: string; organizationName: string; accountExists: boolean } | null) => void;
}) {
  useEffect(() => {
    if (!token) {
      onLoaded(null);
      return;
    }
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => onLoaded(data))
      .catch(() => onLoaded(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return null;
}

function InviteForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get?.("token") ?? "";

  const [preview, setPreview] = useState<{ email: string; role: string; organizationName: string; accountExists: boolean } | null | undefined>(undefined);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (!preview?.accountExists && password !== confirmPassword) {
      setError(t("register.error.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, firstName: firstName?.trim?.(), lastName: lastName?.trim?.(), password }),
      });
      const data = await res?.json?.().catch(() => ({}));
      if (!res?.ok) {
        setError(data?.error ?? t("common.error"));
        setLoading(false);
        return;
      }
      if (!data?.accountExists && preview?.email) {
        const result = await signIn("credentials", { redirect: false, email: preview.email, password });
        if (result?.ok) {
          router.replace("/calendar");
          return;
        }
      }
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
      <InvitePreview token={token} onLoaded={setPreview} />
      <h1 className="text-xl font-display font-semibold text-center mb-5">{t("invite.title")}</h1>
      {preview === undefined ? (
        <p className="text-sm text-muted-foreground text-center">{t("common.loading")}</p>
      ) : preview === null ? (
        <p className="text-sm text-destructive text-center">{t("invite.error.invalid")}</p>
      ) : success ? (
        <div className="text-center space-y-4">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
          <p className="text-sm font-medium">{preview.accountExists ? t("invite.successExisting") : t("invite.success")}</p>
          <Link href="/login" className="inline-block px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition">{t("forgot.backToLogin")}</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-primary/5 rounded-xl p-3 text-sm text-primary">
            {t("invite.description", { org: preview.organizationName, role: ROLE_LABELS[preview.role] ?? preview.role })}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("login.email")}</label>
            <input type="email" value={preview.email} disabled className="w-full px-3 py-2 rounded-xl bg-secondary/50 text-sm text-muted-foreground" />
          </div>
          {preview.accountExists ? (
            <p className="text-xs text-muted-foreground">{t("invite.accountExistsHint")}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.firstName")} *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="text" value={firstName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e?.target?.value ?? "")} className="w-full pl-10 pr-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoFocus />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.lastName")} *</label>
                  <input type="text" value={lastName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> {t("register.password")} *</label>
                <input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.confirmPassword")} *</label>
                <input type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
              </div>
              <p className="text-xs text-muted-foreground">{t("register.passwordHint")}</p>
            </>
          )}
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">
            {loading ? t("common.loading") : preview.accountExists ? t("invite.acceptExisting") : t("invite.submit")}
          </button>
        </form>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6"><div className="relative w-36 h-12 mb-1"><Image src="/logo-onexis.png" alt="ONEXIS Logo" fill className="object-contain" priority /></div></div>
        <Suspense fallback={null}>
          <InviteForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
