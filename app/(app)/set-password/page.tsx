"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Lock, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

// Erzwungener Passwort-Wechsel für Bestandsnutzer nach der Migration von
// Vorname+Code auf E-Mail+Passwort (MIGRATION.md Punkt 2). session.user.mustSetPassword
// wird von app/(app)/layout.tsx geprüft, das hierher umleitet, bis das neue
// Passwort gesetzt ist.
export default function SetPasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { update } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e?.preventDefault?.();
    setError("");
    if (newPassword !== confirmPassword) { setError(t("register.error.passwordMismatch")); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res?.ok) {
        const data = await res?.json?.().catch(() => ({}));
        setError(data?.error ?? t("common.error"));
        setLoading(false);
        return;
      }
      // JWT-Flag ohne erneuten Login aktualisieren (lib/auth-options.ts jwt-Callback,
      // trigger === "update").
      await update?.({ mustSetPassword: false });
      toast.success(t("setPassword.success"));
      router.replace("/calendar");
    } catch (err: any) {
      console.error(err);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto py-8">
      <div className="bg-card rounded-2xl p-6" style={{ boxShadow: "var(--shadow-md)" }}>
        <div className="flex flex-col items-center mb-5 text-center">
          <ShieldAlert className="w-10 h-10 text-primary mb-2" />
          <h1 className="text-lg font-display font-semibold">{t("setPassword.title")}</h1>
          <p className="text-xs text-muted-foreground mt-2">{t("setPassword.description")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> {t("setPassword.currentPassword")}</label>
            <input type="password" value={currentPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoFocus autoComplete="current-password" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("reset.newPassword")}</label>
            <input type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("register.confirmPassword")}</label>
            <input type="password" value={confirmPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e?.target?.value ?? "")} className="w-full px-3 py-2 rounded-xl bg-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition" required autoComplete="new-password" />
          </div>
          <p className="text-xs text-muted-foreground">{t("register.passwordHint")}</p>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button type="submit" disabled={loading || !currentPassword || !newPassword} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50">
            {loading ? t("common.loading") : t("setPassword.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
