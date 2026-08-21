import nodemailer from 'nodemailer';

import { logger } from '../src/config/logger.js';
import { prisma } from '../src/db/prisma.js';

/**
 * Creates a single Ethereal test account and points every sender's smtp_config
 * at it, so the worker can send real (deliverable-to-inbox) test emails whose
 * preview URLs surface via GET /api/emails/:jobId.
 */
async function main(): Promise<void> {
  const account = await nodemailer.createTestAccount();

  const senders = await prisma.sender.findMany();
  for (const sender of senders) {
    await prisma.sender.update({
      where: { id: sender.id },
      data: {
        smtpConfig: {
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          user: account.user,
          pass: account.pass,
        },
      },
    });
  }

  logger.info(
    {
      sendersUpdated: senders.length,
      user: account.user,
      inbox: 'https://ethereal.email/messages',
    },
    'Ethereal test account created and senders updated',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.fatal({ err }, 'Ethereal setup failed');
  process.exit(1);
});
