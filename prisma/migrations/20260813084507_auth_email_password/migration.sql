-- MIGRATION.md Punkt 2: E-Mail + Passwort statt Vorname + Code.
--
-- Vorher/nachher (Stand dieser Migration, lokale Dev-DB):
--   User:              1 Zeile  — bleibt 1 Zeile, "code" entfällt,
--                                 "mustSetPassword" wird für alle
--                                 bestehenden Zeilen auf true gesetzt.
--   SecurityQuestion:  2 Zeilen — Tabelle wird vollständig entfernt.
--   PasswordResetToken: neu, 0 Zeilen.
--   LoginAttempt:       neu, 0 Zeilen.
--
-- WICHTIG — nicht vom Prisma-Diff automatisch erzeugt, sondern per Hand
-- ergänzt: Der reine Schema-Diff würde "mustSetPassword" für ALLE Zeilen
-- (auch bestehende) auf den Spalten-Default false backfillen. Damit
-- bestehende Nutzer (deren password-Hash noch aus der alten Code-Ära
-- stammt) beim nächsten Login zum Setzen eines neuen, richtlinienkonformen
-- Passworts gezwungen werden, wird direkt nach dem ADD COLUMN explizit auf
-- true gesetzt — für alle Zeilen, die zum Zeitpunkt dieser Migration
-- existieren. Neu angelegte Nutzer (nach dieser Migration) behalten den
-- Spalten-Default false.

-- DropForeignKey
ALTER TABLE "SecurityQuestion" DROP CONSTRAINT "SecurityQuestion_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "code",
ADD COLUMN     "mustSetPassword" BOOLEAN NOT NULL DEFAULT false;

-- DataMigration: alle zum Migrationszeitpunkt bestehenden Nutzer müssen beim
-- nächsten Login ein neues Passwort setzen (siehe Kommentar oben).
UPDATE "User" SET "mustSetPassword" = true;

-- DropTable
DROP TABLE "SecurityQuestion";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'login',
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_action_email_createdAt_idx" ON "LoginAttempt"("action", "email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_action_ip_createdAt_idx" ON "LoginAttempt"("action", "ip", "createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
