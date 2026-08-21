-- AlterTable
ALTER TABLE "email_jobs" ADD COLUMN     "from_email" TEXT,
ADD COLUMN     "attachments" JSONB;