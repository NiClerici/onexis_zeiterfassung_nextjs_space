// Passwortregeln: mindestens 10 Zeichen, nicht auf der Blockliste häufiger
// Passwörter (lib/common-passwords.ts). Reine Funktion, keine DB-Zugriffe —
// von Signup, Reset-Password und Profil-Passwortänderung gemeinsam genutzt.

import { isCommonPassword } from "@/lib/common-passwords";

export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordCheck {
  ok: boolean;
  error?: string;
}

export function checkPasswordPolicy(password: unknown): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Passwort erforderlich" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` };
  }
  if (isCommonPassword(password)) {
    return { ok: false, error: "Dieses Passwort ist zu häufig verwendet — bitte ein anderes wählen" };
  }
  return { ok: true };
}
