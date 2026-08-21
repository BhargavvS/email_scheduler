import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const seedSenders = [
  { name: 'Sales Team Alpha', email: 'sales.alpha@example.com' },
  { name: 'Sales Team Beta', email: 'sales.beta@example.com' },
  { name: 'Sales Team Gamma', email: 'sales.gamma@example.com' },
];

async function main(): Promise<void> {
  for (const sender of seedSenders) {
    const existing = await prisma.sender.findUnique({ where: { email: sender.email } });
    if (existing) {
      console.log(`Skip existing sender ${sender.email}`);
      continue;
    }
    await prisma.sender.create({
      data: {
        name: sender.name,
        email: sender.email,
        smtpConfig: {
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          user: 'ethereal.user',
          pass: 'ethereal.pass',
        },
      },
    });
    console.log(`Created sender ${sender.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());