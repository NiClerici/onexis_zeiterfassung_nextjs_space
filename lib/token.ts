// Gemeinsamer Hash für signierte, einmal verwendbare Tokens (Passwort-Reset,
// Einladungen). Nur der Hash landet in der DB — der Klartext-Token existiert
// ausschliesslich im Link, der per Mail verschickt wird.

import crypto from "crypto";

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
