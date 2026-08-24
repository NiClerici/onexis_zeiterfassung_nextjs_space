// Mailversand-Abstraktion mit SMTP-Config aus ENV. Bewusst KEIN US-Dienst
// (kein SendGrid, Postmark, Resend) — der Kunde kauft Schweizer Datenhaltung.
// Default in .env.example ist Infomaniak-SMTP.
//
// Ohne konfigurierten SMTP-Host (z.B. lokale Entwicklung ohne Mail-Account)
// wird die Mail NICHT verschickt, sondern nur ins Server-Log geschrieben —
// so bleibt der Reset-Flow lokal testbar (Link aus dem Log kopieren), ohne
// den Token jemals über die API-Response zurückzugeben (das würde die
// "signiert, einmal verwendbar"-Eigenschaft des Tokens aushebeln).

import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

// Exportiert, damit lib/dev-metrics.ts (Developer-Übersicht /dev) denselben
// Konfigurationsstatus anzeigen kann, den lib/mail.ts tatsächlich verwendet
// — keine zweite, potenziell abweichende ENV-Prüfung an anderer Stelle.
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function getTransport() {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return cachedTransport;
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (!isSmtpConfigured()) {
    console.warn(
      `[lib/mail] SMTP nicht konfiguriert (SMTP_HOST/SMTP_USER/SMTP_PASSWORD fehlen) — Mail wird nur geloggt, nicht verschickt.\n` +
        `[lib/mail] An: ${message.to} | Betreff: ${message.subject}\n${message.text}`
    );
    return;
  }
  const from = process.env.SMTP_FROM ?? "ONEXIS Zeiterfassung <no-reply@example.ch>";
  await getTransport().sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
