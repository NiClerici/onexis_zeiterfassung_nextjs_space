"use client";

// Erzeugt für ein Mitglied einen Passwort-Reset-Link, ohne dass SMTP
// konfiguriert ist (löst BETRIEB.md Punkt 5). Ruft POST
// /api/dev/users/[id]/reset-link auf und zeigt den Link im selben
// Kopier-Dialog-Muster wie die Einladungslinks in
// app/(app)/admin/team/page.tsx ("Link im Dialog statt Mail",
// Betrieb.md Punkt 3).

import { useState } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function ResetLinkButton({ userId, email }: { userId: string; email: string }) {
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    try {
      const res = await fetch(`/api/dev/users/${userId}/reset-link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Link konnte nicht erzeugt werden");
        return;
      }
      setLink(data.resetUrl);
      setCopied(false);
    } catch (err) {
      console.error(err);
      toast.error("Link konnte nicht erzeugt werden");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch (err) {
      console.error(err);
      toast.error("Kopieren fehlgeschlagen");
    }
  }

  return (
    <>
      <Button size="xs" variant="ghost" disabled={pending} onClick={generate}>
        <KeyRound className="w-3.5 h-3.5" />
        Reset-Link
      </Button>

      <Dialog open={Boolean(link)} onOpenChange={(open) => { if (!open) setLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passwort-Reset-Link für {email}</DialogTitle>
            <DialogDescription>Gültig 60 Minuten, nur einmal verwendbar. Sicher an die Person übermitteln, nicht öffentlich teilen.</DialogDescription>
          </DialogHeader>
          <code className="block w-full px-3 py-2 rounded-xl bg-secondary text-xs break-all">{link}</code>
          <button
            onClick={copyLink}
            className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Kopiert" : "Link kopieren"}
          </button>
          <DialogFooter>
            <button onClick={() => setLink(null)} className="px-4 py-2 rounded-xl bg-secondary text-sm font-medium hover:opacity-80 transition">
              Schliessen
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
