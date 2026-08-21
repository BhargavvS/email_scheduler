-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "batches_idempotency_key_key" ON "batches"("idempotency_key");