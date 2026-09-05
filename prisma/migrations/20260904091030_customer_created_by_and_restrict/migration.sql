-- DropForeignKey
ALTER TABLE "CustomerMonth" DROP CONSTRAINT "CustomerMonth_customerId_fkey";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "createdBy" TEXT;

-- AddForeignKey
ALTER TABLE "CustomerMonth" ADD CONSTRAINT "CustomerMonth_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
