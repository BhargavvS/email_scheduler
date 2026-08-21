-- AlterTable
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT,
ALTER COLUMN "google_id" DROP NOT NULL;
