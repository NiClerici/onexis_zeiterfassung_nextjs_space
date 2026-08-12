-- DropIndex
DROP INDEX "TimeEntry_userId_date_key";

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "bis" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "notiz" TEXT,
ADD COLUMN     "pauseMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "projekt" TEXT,
ADD COLUMN     "von" TEXT,
ALTER COLUMN "hours" DROP NOT NULL,
ALTER COLUMN "type" SET DEFAULT 'arbeit';

-- DataMigration: Bestands-Typwerte auf die 6 neuen Werte übernehmen
UPDATE "TimeEntry" SET "type" = 'arbeit' WHERE "type" = 'work';
UPDATE "TimeEntry" SET "type" = 'ferien' WHERE "type" = 'vacation';
UPDATE "TimeEntry" SET "type" = 'feiertag' WHERE "type" = 'holiday';

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_name_key" ON "Customer"("userId", "name");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: bestehende CustomerHour-Kundennamen (dedupliziert pro User) nach Customer übernehmen
INSERT INTO "Customer" ("id", "userId", "name", "billable")
SELECT gen_random_uuid()::text, "userId", "customerName", true
FROM (SELECT DISTINCT "userId", "customerName" FROM "CustomerHour") AS distinct_customers
ON CONFLICT ("userId", "name") DO NOTHING;
