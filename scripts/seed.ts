import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("johndoe123", 10);
  const hashedCode = await bcrypt.hash("1234", 10);

  const user = await prisma.user.upsert({
    where: { email: "john@doe.com" },
    update: {},
    create: {
      email: "john@doe.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Doe",
      code: hashedCode,
      weeklyHours: 42,
      pensum: 100,
      vacationDays: 25,
      language: "de",
      role: "admin",
    },
  });

  // Upsert security questions for test user
  const existingQuestions = await prisma.securityQuestion.findMany({
    where: { userId: user.id },
  });

  if ((existingQuestions?.length ?? 0) === 0) {
    await prisma.securityQuestion.create({
      data: {
        userId: user.id,
        question: "sq.pet",
        answer: "rex",
      },
    });
    await prisma.securityQuestion.create({
      data: {
        userId: user.id,
        question: "sq.city",
        answer: "zürich",
      },
    });
  }

  console.log("Seed completed");
}

main()
  .catch((e: any) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
