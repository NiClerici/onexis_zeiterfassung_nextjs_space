-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "warnPauseZuKurz" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "warnSonntagsarbeit" BOOLEAN NOT NULL DEFAULT false;
