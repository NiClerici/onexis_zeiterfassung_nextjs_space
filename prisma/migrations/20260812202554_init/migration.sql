-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 42,
    "pensum" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "baseWeeklyHours" DOUBLE PRECISION,
    "basePensum" DOUBLE PRECISION,
    "vacationDays" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "startDate" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'de',
    "role" TEXT NOT NULL DEFAULT 'user',
    "stdHoursMon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursTue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursWed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursThu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursFri" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursSat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stdHoursSun" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PensumChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pensum" DOUBLE PRECISION NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PensumChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "SecurityQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'work',

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimePayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerHour" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CustomerHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PensumChange_userId_effectiveFrom_idx" ON "PensumChange"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SecurityQuestion_userId_idx" ON "SecurityQuestion"("userId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_date_idx" ON "TimeEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_userId_date_key" ON "TimeEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "OvertimePayout_userId_date_idx" ON "OvertimePayout"("userId", "date");

-- CreateIndex
CREATE INDEX "CustomerHour_userId_year_month_idx" ON "CustomerHour"("userId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerHour_userId_year_month_customerName_key" ON "CustomerHour"("userId", "year", "month", "customerName");

-- AddForeignKey
ALTER TABLE "PensumChange" ADD CONSTRAINT "PensumChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityQuestion" ADD CONSTRAINT "SecurityQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimePayout" ADD CONSTRAINT "OvertimePayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerHour" ADD CONSTRAINT "CustomerHour_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
