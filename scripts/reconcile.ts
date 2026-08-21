import { logger } from '../src/config/logger.js';
import { prisma } from '../src/db/prisma.js';
import { closeQueueConnections } from '../src/queues/emailQueue.js';
import { runReconciliation } from '../src/services/reconcileService.js';

// Manual one-shot reconciliation (B6). Useful for an on-demand sweep without
// waiting for the worker's periodic interval, and for the B6.5 verification
// checklist ("run reconciliation twice — the second is a safe no-op").
runReconciliation()
  .then((summary) => {
    logger.info({ summary }, 'Manual reconciliation finished');
  })
  .catch((err) => {
    logger.fatal({ err }, 'Manual reconciliation failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeQueueConnections();
    process.exit();
  });