/*
  Warnings:

  - You are about to drop the `CustomerHour` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CustomerHour" DROP CONSTRAINT "CustomerHour_userId_fkey";

-- DropTable
DROP TABLE "CustomerHour";
