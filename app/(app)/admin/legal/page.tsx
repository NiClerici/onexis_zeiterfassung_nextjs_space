"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { FileText, Download, AlertTriangle, ShieldAlert, BellOff, Image as ImageIcon, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

const LEGAL_DOCS = [
  { href: "/legal/avv-vorlage.md", labelKey: "legal.docAvv" },
  { href: "/legal/bearbeitungsverzeichnis-vorlage.md", labelKey: "legal.docRecords" },
  { href: "/legal/datenschutzerklaerung.md", labelKey: "legal.docPrivacy" },
];

export default function LegalPage() {
  const { t } = useI18n();
  const { data: session, status: sessionStatus } = useSession() || {};
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const isOwner = role === "owner";
  const isOrgAdmin = role === "owner" || role === "admin";

  const [orgName, setOrgName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState<"json" | "excel" | null>(null);
  const [warnPauseZuKurz, setWarnPauseZuKurz] = useState(true);
  const [warnSonntagsarbeit, setWarnSonntagsarbeit] = useState(false);
  const [savingWarnings, setSavingWarnings] = useState<"warnPauseZuKurz" | "warnSonntagsarbeit" | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionStatus === "authenticated" && role && !isOrgAdmin) {
      router.replace("/calendar");
    }
  }, [sessionStatus, role, isOrgAdmin, router]);

  useEffect(() => {
    if (!isOrgAdmin) return;
    fetch("/api/admin/organization")
      .then((r) => (r?.ok ? r.json() : null))
      .then((d) => {
        if (d?.name) setOrgName(d.name);
        if (d) {
          setWarnPauseZuKurz(d.warnPauseZuKurz ?? true);
          setWarnSonntagsarbeit(d.warnSonntagsarbeit ?? false);
        }
      })
      .catch((err) => console.error(err));
    fetch("/api/admin/organization/logo")
      .then((r) => (r?.ok ? r.json() : null))
      .then((d) => setLogoDataUrl(d?.dataUrl ?? null))
      .catch((err) => console.error(err));
  }, [isOrgAdmin]);

  const handleLogoUpload = async (file: File) => {
    setLogoLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/admin/organization/logo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (res?.ok) {
        setLogoDataUrl(dataUrl);
        toast.success(t("legal.logoSaved"));
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("legal.logoInvalid"));
      }
    } catch (err: any) {
      console.error(err);
      toast.error(t("legal.logoInvalid"));
    } finally {
      setLogoLoading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleLogoRemove = async () => {
    setLogoLoading(true);
    try {
      const res = await fetch("/api/admin/organization/logo", { method: "DELETE" });
      if (res?.ok) {
        setLogoDataUrl(null);
        toast.success(t("legal.logoRemoved"));
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) {
      console.error(err);
      toast.error(t("profile.error"));
    } finally {
      setLogoLoading(false);
    }
  };

  const handleToggleWarning = async (key: "warnPauseZuKurz" | "warnSonntagsarbeit", value: boolean) => {
    const setter = key === "warnPauseZuKurz" ? setWarnPauseZuKurz : setWarnSonntagsarbeit;
    const previous = key === "warnPauseZuKurz" ? warnPauseZuKurz : warnSonntagsarbeit;
    setter(value);
    setSavingWarnings(key);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res?.ok) {
        setter(previous);
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
      }
    } catch (err: any) {
      console.error(err);
      setter(previous);
      toast.error(t("profile.error"));
    } finally {
      setSavingWarnings(null);
    }
  };

  const handleExport = async (format: "json" | "excel") => {
    setExporting(format);
    try {
      const res = await fetch(`/api/admin/organization/export?format=${format}`);
      if (res?.ok) {
        const blob = await res?.blob?.();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob ?? new Blob());
        a.download = `organisation_export.${format === "excel" ? "xlsx" : "json"}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        toast.error(t("profile.error"));
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); } finally { setExporting(null); }
  };

  const handleDelete = async () => {
    if (confirmName !== orgName) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });
      if (res?.ok) {
        toast.success(t("legal.orgDeleted"));
        // Die Organisation (und damit die Membership dieser Person) ist
        // weg — das JWT der laufenden Session ist jetzt stale (gleiche
        // Einschränkung wie bei "deaktivieren" in Punkt 4c: bestehende
        // Sessions bleiben bis zum JWT-Ablauf technisch gültig). Ein
        // erzwungener Sign-out ist deshalb die einzig saubere Reaktion.
        await signOut({ callbackUrl: "/login" });
      } else {
        const data = await res?.json?.().catch(() => ({}));
        toast.error(data?.error ?? t("profile.error"));
        setDeleting(false);
      }
    } catch (err: any) { console.error(err); toast.error(t("profile.error")); setDeleting(false); }
  };

  if (sessionStatus === "loading" || (role && !isOrgAdmin)) return null;

  return (
    <div className="space-y-4 pb-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-display font-semibold tracking-tight mb-4 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" /> {t("legal.title")}</h1>
      </motion.div>

      {/* Rechtliche Dokumente */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {t("legal.documentsTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("legal.documentsHint")}</p>
        <div className="space-y-1.5">
          {LEGAL_DOCS.map((doc) => (
            <a key={doc.href} href={doc.href} download className="flex items-center justify-between bg-secondary/60 rounded-xl px-3 py-2 text-sm hover:bg-accent transition">
              <span>{t(doc.labelKey)}</span>
              <Download className="w-4 h-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      </motion.div>

      {/* Organisationsexport */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1">{t("legal.exportTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("legal.exportHint")}</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => handleExport("json")} disabled={exporting !== null} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50">
            <Download className="w-4 h-4" /> {exporting === "json" ? t("common.loading") : t("legal.exportJson")}
          </button>
          <button onClick={() => handleExport("excel")} disabled={exporting !== null} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50">
            <Download className="w-4 h-4" /> {exporting === "excel" ? t("common.loading") : t("legal.exportExcel")}
          </button>
        </div>
      </motion.div>

      {/* Firmenlogo für den Kundenrapport-PDF */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-primary" /> {t("legal.logoTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("legal.logoHint")}</p>
        <div className="flex items-center gap-3 flex-wrap">
          {logoDataUrl && (
            <div className="bg-secondary/60 rounded-xl p-2 flex items-center justify-center" style={{ width: 120, height: 60 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoDataUrl} alt="" className="max-w-full max-h-full object-contain" />
            </div>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoUpload(file);
            }}
          />
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={logoLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-accent transition disabled:opacity-50"
          >
            <ImageIcon className="w-4 h-4" /> {logoLoading ? t("common.loading") : t("legal.logoUpload")}
          </button>
          {logoDataUrl && (
            <button
              onClick={handleLogoRemove}
              disabled={logoLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition text-sm font-medium disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> {t("legal.logoRemove")}
            </button>
          )}
        </div>
      </motion.div>

      {/* ArG-Warnungen */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="bg-card rounded-2xl p-4" style={{ boxShadow: "var(--shadow-sm)" }}>
        <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2"><BellOff className="w-4 h-4 text-primary" /> {t("legal.warningsTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3">{t("legal.warningsHint")}</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">{t("legal.warnPauseZuKurzLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("legal.warnPauseZuKurzHint")}</p>
            </div>
            <Switch
              checked={warnPauseZuKurz}
              disabled={savingWarnings !== null}
              onCheckedChange={(checked) => handleToggleWarning("warnPauseZuKurz", checked)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">{t("legal.warnSonntagsarbeitLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("legal.warnSonntagsarbeitHint")}</p>
            </div>
            <Switch
              checked={warnSonntagsarbeit}
              disabled={savingWarnings !== null}
              onCheckedChange={(checked) => handleToggleWarning("warnSonntagsarbeit", checked)}
            />
          </div>
        </div>
      </motion.div>

      {/* Gefahrenzone: Organisation löschen — nur owner */}
      {isOwner && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl p-4 border border-red-200 dark:border-red-900/50" style={{ boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-sm font-display font-semibold mb-1 flex items-center gap-2 text-red-600"><AlertTriangle className="w-4 h-4" /> {t("legal.dangerZoneTitle")}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t("legal.dangerZoneHint")}</p>
          <label className="text-xs text-muted-foreground mb-1 block">{t("legal.confirmNameLabel", { name: orgName })}</label>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={orgName}
            className="w-full px-3 py-2 rounded-xl bg-secondary text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            onClick={handleDelete}
            disabled={!orgName || confirmName !== orgName || deleting}
            className="w-full py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
          >
            {deleting ? t("common.loading") : t("legal.deleteButton")}
          </button>
        </motion.div>
      )}
    </div>
  );
}
