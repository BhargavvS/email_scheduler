import { Pool } from 'pg';

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://scheduler:scheduler@localhost:5432/reachindox_db',
    max: 1,
  });
  await pool.query(
    'ALTER TABLE "email_jobs" ADD COLUMN IF NOT EXISTS "reschedule_count" INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "preview_url" TEXT',
  );
  await pool.query(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
     VALUES (gen_random_uuid()::text, 'manual', NOW(), '20260820100000_add_reschedule_and_preview', NULL, NULL, NOW(), 0)`,
  );
  await pool.query(
    'ALTER TABLE "email_jobs" ADD COLUMN IF NOT EXISTS "from_email" TEXT, ADD COLUMN IF NOT EXISTS "attachments" JSONB',
  );
  await pool.query(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
     VALUES (gen_random_uuid()::text, 'manual', NOW(), '20260820110000_add_from_email_and_attachments', NULL, NULL, NOW(), 0)`,
  );
  console.log('migration applied');
  await pool.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});