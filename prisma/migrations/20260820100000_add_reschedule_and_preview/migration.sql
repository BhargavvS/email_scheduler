-- AlterTable
ALTER TABLE "email_jobs" ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preview_url" TEXT;