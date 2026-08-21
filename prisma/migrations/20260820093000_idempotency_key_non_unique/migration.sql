-- DropIndex
DROP INDEX "batches_idempotency_key_key";

-- CreateIndex
CREATE INDEX "batches_idempotency_key_idx" ON "batches"("idempotency_key");