# ReachInbox — Email Scheduler

> **Core invariant:** PostgreSQL (`email_jobs`) is the **source of truth** for what is scheduled / sent. **BullMQ + Redis is only the scheduling clock** — a durable `delayed` sorted set that ticks and hands jobs to workers. The frontend never queries Redis; every tab, count, and preview reads the DB.

---

## Table of Contents

1. [Stack](#stack)
2. [Quick Start](#quick-start)
3. [How to Run — Backend](#how-to-run--backend)
4. [How to Run — Frontend](#how-to-run--frontend)
5. [Ethereal Email & Environment](#ethereal-email--environment)
6. [Makefile & Docker Build](#makefile--docker-build)
7. [Architecture Overview](#architecture-overview)
   - [7.1 Data Model](#71-data-model)
   - [7.2 Scheduling Flow (End-to-End)](#72-scheduling-flow-end-to-end)
   - [7.3 Persistence on Restart](#73-persistence-on-restart)
   - [7.4 Rate Limiting & Concurrency](#74-rate-limiting--concurrency)
8. [Features Implemented](#features-implemented)
9. [API Reference (Summary)](#api-reference-summary)
10. [Assumptions, Shortcuts & Trade-offs](#assumptions-shortcuts--trade-offs)
11. [Verification & Troubleshooting](#verification--troubleshooting)

---

## Stack

| Layer | Tech | Version | Purpose |
|-------|------|---------|---------|
| API | Express 4 + TypeScript (ESM `NodeNext`) | `tsx` for dev, `tsc` for build | REST API, auth, batch creation |
| DB | PostgreSQL 16 via **Prisma** (`prisma/schema.prisma:1`) | `binaryTargets native,windows` | `users`, `senders`, `batches`, `email_jobs` |
| Queue | **BullMQ 6** + **Redis 7** (`ioredis`) | `appendonly yes` in `docker-compose.yml:24` | Delayed jobs = scheduling clock |
| Worker | Separate `src/workers/emailWorker.ts:243` process | `WORKER_CONCURRENCY` per sender | Sends via Nodemailer |
| Auth | Google OAuth2 (`google-auth-library`) + `bcryptjs` + `jsonwebtoken` JWT | `session` cookie + `Bearer` header | `requireAuth` (`src/middleware/auth.ts:30`) accepts both |
| Mail | `nodemailer` + **Ethereal** SMTP (`scripts/ethereal-setup.ts:11`) | `host: smtp.ethereal.email:587` | Fake inbox with `previewUrl` |
| Frontend | **Next.js 14** + TypeScript + TipTap | `frontend/package.json:20` | SPA at `:3000` |
| Logs | `pino` + `pino-http` (`src/config/logger.ts`) | structured JSON | Per-job transitions |
| Validation | `zod` (`src/config/env.ts:6`, `src/routes/batches.ts:20`) | fail-fast env + request schemas | No silent `undefined` config |

---

## Quick Start

```bash
# 1) Infra
docker compose up -d              # postgres:5432 + redis:6379 (named volumes pgdata/redisdata)
cp .env.example .env              # fill GOOGLE_* + JWT_SESSION_SECRET (16+ chars)
cp frontend/.env.local.example frontend/.env.local

# 2) Backend install + DB
npm install
npm run migrate                   # prisma migrate dev — creates tables + indexes
npm run db:seed                   # 3 senders: sales.alpha/beta/gamma (@example.com) with placeholder Ethereal creds
npm run ethereal:setup            # creates real Ethereal test account and updates every sender.smtpConfig

# 3) Run (choose one)
npm run dev:all                   # API :4000 + worker together (concurrently)  ← recommended
# or separately:
npm run dev                       # API only — health at http://localhost:4000/health
npm run worker                    # worker only — drains BullMQ delayed set

# 4) Frontend
cd frontend
npm install
npm run dev                       # Next.js :3000 → http://localhost:3000/login

# Docker alternative
make docker-build                 # builds reachinbox-scheduler-backend:latest + frontend
docker compose up -d              # add app services if you extend compose
```

Health: `curl localhost:4000/health` →

```json
{"status":"ok","db":"ok","redis":"ok","worker":"ok"}
```

`worker:stale` means the heartbeat key `worker:heartbeat` in Redis is >90 s old — start `npm run worker`.

---

## How to Run — Backend

### 1. Prerequisites

* Node ≥18.17 (`package.json:7`), Docker + compose, `psql` optional.

### 2. Environment (`src/config/env.ts:6`)

All via `zod` — missing/malformed vars **crash on boot** with exact name (`src/config/env.ts:52`). No `undefined` silently.

| Var | Default | Used |
|-----|---------|------|
| `PORT` | `4000` | API listen |
| `DATABASE_URL` | `postgresql://scheduler:scheduler@localhost:5432/reachindox_db` | Prisma |
| `REDIS_URL` | `redis://localhost:6379` | ioredis + BullMQ |
| `WORKER_CONCURRENCY` | `5` | per-sender `Worker` concurrency (`src/workers/emailWorker.ts:181`) |
| `MIN_DELAY_MS_BETWEEN_EMAILS` | `2000` | queue-level `limiter: {max:1, duration:…}` (`src/workers/emailWorker.ts:182`) — pacing floor |
| `MAX_DELAY_MS_BETWEEN_EMAILS` | `3600000` | max `delayMs` accepted (`src/routes/batches.ts:41`) |
| `MAX_EMAILS_PER_HOUR` | `200` | global Lua cap (`src/services/rateLimiter.ts:66`) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `50` | per-sender cap (or `sender.maxPerHourOverride`) |
| `MAX_RECIPIENTS_PER_BATCH` | `5000` | `recipients` array limit (`src/routes/batches.ts:29`) |
| `SEND_MAX_ATTEMPTS` | `3` | BullMQ `attempts` (`src/queues/emailQueue.ts:12`) |
| `SEND_BACKOFF_MS` | `5000` | exponential backoff |
| `STUCK_PROCESSING_THRESHOLD_MS` | `300000` (5 min) | stuck `processing` → `queued` |
| `RECONCILE_SWEEP_INTERVAL_MS` | `60000` | periodic sweep (`src/services/reconcileService.ts:260`) |
| `GOOGLE_CLIENT_ID/SECRET` | — | `src/config/oauth.ts:5` → `OAuth2Client` |
| `JWT_SESSION_SECRET` | — | `src/config/session.ts:15` `jwt.sign/verify` |
| `FRONTEND_URL` | `http://localhost:3000` | CORS `origin` (`src/app.ts:29`) + OAuth redirect |
| `API_ORIGIN` | `http://localhost:4000` | `OAuth2Client` redirectUri (`src/config/oauth.ts:8`) |
| `SESSION_TTL_DAYS` | `7` | JWT `expiresIn` + cookie `maxAge` |

### 3. Infra

`docker-compose.yml:1` — two services, both `restart: unless-stopped`, named volumes, healthchecks:

* `postgres:16-alpine` with `pg_isready` every 5 s.
* `redis:7-alpine` with `redis-server --appendonly yes` (persistence) — survives `docker stop/start` without deleting the volume. `redis-cli ping` healthcheck.

### 4. DB Schema & Migrations

`prisma/schema.prisma:11` —

```
users (id cuid, googleId unique?, email unique, name, avatarUrl, passwordHash?, createdAt, updatedAt)
senders (id cuid, name, email unique, smtpConfig Json?, maxPerHourOverride?, createdAt, updatedAt)
batches (id cuid, userId?, subject, body, startTime, delayMs, hourlyLimit, idempotencyKey?, createdAt)  @@index([idempotencyKey])
email_jobs (id cuid, batchId FK cascade, senderId? FK, recipient, subject, body, fromEmail?, attachments Json?,
            scheduledAt, status[pending|queued|processing|sent|failed], bullmqJobId unique?, sentAt?, error?, attempts, rescheduleCount, previewUrl?) 
            @@index([batchId]) @@index([status, scheduledAt])
```

Indexes cover `listEmailJobs` sweep (`status+scheduledAt`) and reconciliation. `bullmq_job_id` unique enforces idempotent enqueue.

Migrations in `prisma/migrations/` (6 files) are transactional per-file and idempotent; `npm run migrate` works on a fresh `docker compose up` and on a second run.

Seed `prisma/seed.ts:5` inserts 3 senders with placeholder `ethereal.user/pass` — overwritten by `scripts/ethereal-setup.ts:11` which calls `nodemailer.createTestAccount()` and updates every sender.

### 5. API Process (`src/server.ts:8`)

* Retries DB/Redis connectivity with exponential backoff (`src/lib/retry.ts`) — 5 attempts, capped delay — then exits non-zero for Docker restart policy.
* `createApp()` (`src/app.ts:13`): `etag: false` + `Cache-Control: no-store` (prevents 304 bodiless for auth), `pinoHttp`, `express.json`, `cookieParser`, `cors({origin: FRONTEND_URL, credentials:true, allowedHeaders:[Content-Type, Authorization]})`, routes, `errorHandler` (never leaks stack).
* Graceful `SIGINT/SIGTERM` — `server.close()` then exit.

### 6. Worker Process (`src/workers/emailWorker.ts:243`)

* Separate entrypoint — scales independently. Loads all `senders`, creates **one `Worker` per sender** (`src/workers/emailWorker.ts:178`), cached `sendersById` map, `rateLimitRedis` shared ioredis.
* Each worker: `concurrency: WORKER_CONCURRENCY`, `limiter: {max:1, duration: MIN_DELAY_MS}`.
* On boot: `startHeartbeat()` sets `worker:heartbeat = Date.now()` every 30 s, TTL 90 s — `GET /health` reads it. Then `runReconciliation()` + `startReconciliationSweep()`.
* `unhandledRejection`/`uncaughtException` logged; not crashing on one bad job.
* Graceful `SIGTERM`: `stopReconciliationSweep()`, `stopHeartbeat()`, `Promise.all(workers.map(w=>w.close()))`, `redis.quit()`, `prisma.$disconnect()`.

### 7. Common Backend Commands

```bash
npm run dev          # watch API
npm run worker       # worker
npm run dev:all      # both via concurrently
npm run reconcile    # one-shot sweep (src/services/reconcileService.ts) — also runnable without worker
npm run build && npm run start          # compiled JS in dist/
npm run start:worker                    # compiled worker
npm run typecheck && npm run lint
```

---

## How to Run — Frontend

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                        # http://localhost:3000/login  (Next 14)
npm run build && npm start         # production
```

* `frontend/lib/api.ts:1` — `API_URL = process.env.NEXT_PUBLIC_API_URL` (baked at build time — **rebuild after changing `.env.local`**).
* Auth storage: `localStorage` keys `reachinbox_token` / `reachinbox_user` (`frontend/lib/api.ts:12`). Every request adds `Authorization: Bearer <token>` + `credentials: include` fallback cookie. Bearer wins server-side (`src/middleware/auth.ts:21`).
* `frontend/lib/auth-context.tsx:34` `AuthProvider` wraps app (`frontend/app/layout.tsx:16`), exposes `user`, `initializing`, `login/register/loginWithGoogle/completeGoogleLogin/logout`. On mount it validates `GET /auth/me`; a 401 clears storage. Google flow lands on `FRONTEND_URL/oauth/callback?token=<jwt>` (`frontend/app/oauth/callback/page.tsx:15`) which calls `completeGoogleLogin(token)` → validates → `router.replace('/dashboard')` and scrubs token from URL.
* `frontend/components/auth/ProtectedRoute.tsx:12` redirects unauthenticated to `/login` after `initializing`.

---

## Ethereal Email & Environment

### Why Ethereal

Real SMTP without spamming real inboxes. Every sent email yields a `previewUrl` (`https://ethereal.email/message/...`) stored in `email_jobs.previewUrl` and returned by `GET /api/emails/:jobId`.

### Setup

1.  After `npm run migrate && npm run db:seed`, run:

    ```bash
    npm run ethereal:setup
    # → creates one Ethereal account via nodemailer.createTestAccount()
    # → updates ALL senders.smtpConfig to {host:smtp.ethereal.email, port:587, secure:false, user, pass}
    # → logs user + https://ethereal.email/messages
    ```

2.  If you skip this, `src/lib/mailer.ts:32` detects placeholder `ethereal.user` and falls back to `jsonTransport` (no network, instantly marks `sent`) so local dev still works.

### Env (`src/config/env.ts` + `.env.example`)

Copy `.env.example` → `.env`, fill:

* `GOOGLE_CLIENT_ID/SECRET` from https://console.cloud.google.com → Credentials → OAuth client (Authorized redirect URI must be exactly `${API_ORIGIN}/auth/google/callback`, e.g. `http://localhost:4000/auth/google/callback`).
* `JWT_SESSION_SECRET` ≥16 chars (random base64).
* `DATABASE_URL`/`REDIS_URL` match `docker-compose.yml`.
* All `*_MS`/`*_PER_HOUR`/`*_ATTEMPTS` are optional — defaults are production-sane.

Frontend `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Rebuild frontend after changing it (`next build` bakes it).

---

## Makefile & Docker Build

`make docker-build` is the deliverable from the previous fix.

```bash
make docker-build              # builds both images
make docker-build-backend      # reachinbox-scheduler-backend:latest  (Dockerfile:1)
make docker-build-frontend     # reachinbox-scheduler-frontend:latest (frontend/Dockerfile:1)
make docker-up / docker-down   # compose helpers
make help                      # list targets
```

* **Backend Dockerfile** (`Dockerfile:1`) — multi-stage: `deps` (`npm ci`), `build` (`prisma generate` + `tsc`), `runner` (copies `node_modules`, `.prisma`, `dist`, `prisma`, runs `node dist/server.js`). Override CMD for worker: `docker run ... node dist/workers/emailWorker.js`.
* **Frontend Dockerfile** (`frontend/Dockerfile:1`) — builder (`npm ci` + `next build` with `ARG NEXT_PUBLIC_API_URL`), runner (`nextjs` user, `next start` on `:3000`).
* `.dockerignore` excludes `node_modules`, `dist`, `.next`, `.env`.

---

## Architecture Overview

### 7.1 Data Model

```
users        (id, googleId?, email unique, name, avatarUrl?, passwordHash?, createdAt, updatedAt)
  1 ── n batches
senders      (id, name, email unique, smtpConfig Json?, maxPerHourOverride?)
  1 ── n email_jobs
batches      (id, userId FK→users, subject, body, startTime, delayMs, hourlyLimit, idempotencyKey?, createdAt)
  1 ── n email_jobs
email_jobs   (id, batchId FK cascade, senderId FK, recipient, subject, body, fromEmail?, attachments Json?,
              scheduledAt, status[pending|queued|processing|sent|failed], bullmqJobId unique?, sentAt?, error?, attempts, rescheduleCount, previewUrl?, createdAt, updatedAt)
```

* `email_jobs` is the **sole ground truth** for `GET /api/emails/scheduled|sent` (`src/services/emailJobService.ts:40`) and for `GET /api/emails/:jobId`.
* `status` lifecycle: `pending` (DB-committed) → `queued` (BullMQ accepted) → `processing` (worker picked) → `sent`/`failed` (terminal). `rescheduleCount` tracks rate-limit deferrals.
* `bullmq_job_id = email-{rowId}` (`src/queues/emailQueue.ts:62`) — deterministic, idempotent, BullMQ dedupes; deviation from spec `email:{id}` because `:` is rejected (`Custom Id cannot contain :`).

### 7.2 Scheduling Flow (End-to-End)

**The architecture diagrams are attached under the Architecture folder**

```
Browser Compose             API                          DB (Postgres)              Redis (BullMQ)               Worker
─────────────               ───                          ─────────────              ──────────────               ──────
POST /api/batches ───────► zod + parseRecipients() ─┐
  {subject,body,             recipients: dedupe,      │                         ┌─────────────────┐
   recipients[],             lower, filter invalid    │                         │  per-sender queue│
   startTime ISO,            0 valid→422             │                         │  email-{senderId}│
   delayMs, hourlyLimit,     resolve senderId        │  BEGIN                  └─────────────────┘
   attachments?}             (fromEmail→sender)       │   batches + N email_jobs
                             idempotency check ──────┼─► status=pending         ──────────────────►
                             hash(user+subj+body+    │   scheduledAt =               queue.add(
                              recipients+startTime)   │   startTime + i*delayMs        name=send,
                                                     │  COMMIT ──────────────────►      jobId=email-{rowId},
                                                     │   (ground truth)                 delay = scheduledAt - now,
                                                     │                                attempts=3, backoff=exponential:5s
                               enqueueEmailJobs() ◄───┼───────────────────────────────────────
                                 for each job:        │   status=queued, bullmqJobId
                                 delay=max(0, ...)    │
                               201 {batchId,          │
                                status:scheduled,     │
                                valid/invalid,        │
                                first/lastScheduledAt}│
                                                      │
                          GET /api/emails/scheduled ──┼─► SELECT where batch.userId = req.user.id
                                                      │       AND status IN (pending,queued,processing)
                                                      │       ORDER BY scheduledAt ASC LIMIT 20
                          GET /api/emails/sent ───────┼─► status IN (sent,failed) ORDER BY sentAt DESC
```


**Key ordering in `src/services/batchService.ts:198`:** nested `prisma.batch.create({ emailJobs: { create } })` is one transaction — **DB commit happens before any `queue.add`**. If Redis is down, rows stay `pending`, response is `status: partially_enqueued` (`src/services/batchService.ts:235`), and B6 reconciliation will re-enqueue once Redis returns. Client **never retries** `POST /api/batches` on enqueue failure — it would create a duplicate batch.

**Frontend Compose path** (`frontend/hooks/useComposeEmail.ts:405`): `createBatch()` from `frontend/lib/api.ts:123` validates via `zod` + client parse (`papaparse` for CSV), shows live counts (`RecipientStats`), disables `Schedule` until `recipients>0 && subject && body && startTime future && delay integer`. Attachments go as `multipart/form-data`; otherwise JSON.

### 7.3 Persistence on Restart

* **Redis persistence:** `docker-compose.yml:24` `command: ['redis-server','--appendonly','yes']` + named volume `redisdata:/data` — delayed-set survives `docker stop`/`docker compose restart` without deleting volumes. BullMQ just resumes ticking.
* **DB as ground truth:** even if Redis volume is wiped, `email_jobs` rows remain `pending|queued|processing` with `scheduledAt`. No data loss.
* **Reconciliation sweep** (`src/services/reconcileService.ts`):
  * **Startup:** `src/workers/emailWorker.ts:243` `await runReconciliation()` before `startReconciliationSweep()` (every `RECONCILE_SWEEP_INTERVAL_MS` 60 s, `unref()`).
  * **Three gaps:**
    1.  `reconcilePending`: `status=pending` → `enqueueEmailJobs()` (covers API-crash between commit and enqueue, or Redis-down at enqueue time).
    2.  `reconcileQueued`: `status=queued` where `queue.getJobState(jobId)==='unknown'` → re-enqueue (covers Redis volume loss). **Also handles overdue delayed jobs:** if `scheduledAt < now-5s && state==='delayed'` (worker was down when it became due), promotes by re-adding with `scheduledAt=new Date()` (delay 0) — compensates for the 2 s per-sender limiter that would otherwise drift a 15-job batch 30 s.
    3.  `reconcileStuckProcessing`: `status=processing && updatedAt < now - STUCK_PROCESSING_THRESHOLD_MS (5 min)` → reset to `queued` and re-enqueue if missing.
  * **Fail-closed:** if `checkRedis` fails, whole sweep is skipped (logged) so it never half-repairs.
  * **Manual:** `npm run reconcile` (`scripts/reconcile.ts:9`) for on-demand sweep.
* **Verification:** schedule emails 2 min out, `Ctrl+C` API+worker or `docker stop scheduler-redis`, restart, confirm they still send once and only once (idempotency via `jobId` + DB `status===sent` guard in `src/workers/emailWorker.ts:92`).

### 7.4 Rate Limiting & Concurrency

#### Per-sender pacing (minimum delay between sends)

* **One BullMQ queue per sender** (`src/queues/emailQueue.ts:31` `getQueueForSender(senderId)` → `Queue('email-'+senderId)`), lazily cached in `Map`.
* Each queue's Worker gets `limiter: {max:1, duration: MIN_DELAY_MS_BETWEEN_EMAILS}` (`src/workers/emailWorker.ts:182`) **and** `concurrency: WORKER_CONCURRENCY` (`src/config/env.ts:11`). The limiter is a **floor** (e.g. 2 s) regardless of concurrency; the worker can have 5 `processing` jobs in flight but the queue will not release more than 1 per floor interval to this sender.

#### Global + per-sender + per-batch caps (atomic, multi-worker safe)

BullMQ's built-in limiter throttles a whole queue — the assignment needs **global, sender, and batch** caps safe across multiple worker processes. This uses **Redis Lua**, not in-memory counters:

* **Keys:** `rl:global:{hourBucket}`, `rl:sender:{senderId}:{hourBucket}`, `rl:batch:{batchId}:{hourBucket}` where `hourBucket = YYYY-MM-DDTHH` UTC (`src/services/rateLimiter.ts:39`).
* **Script** `RESERVE_SCRIPT` (`src/services/rateLimiter.ts:25`):
  ```
  g = GET global OR 0; s = GET sender OR 0; b = GET batch OR 0
  if g+1 > globalLimit → return {0,'global'}
  if s+1 > senderLimit → return {0,'sender'}
  if b+1 > batchLimit  → return {0,'batch'}
  INCR global; EXPIRE global 3700
  INCR sender; EXPIRE sender 3700
  INCR batch;  EXPIRE batch 3700
  return {1,'ok'}
  ```
  Atomic read-then-incr — no partial reservation. `RATE_LIMIT_TTL_SECONDS 3700` expires just past the hour.
* **Limits resolve:** `global = MAX_EMAILS_PER_HOUR` (200), `sender = sender.maxPerHourOverride ?? MAX_EMAILS_PER_HOUR_PER_SENDER` (50), `batch = batch.hourlyLimit` (falls back to sender→global in `src/services/batchService.ts:169`).
* **Worker path** (`src/workers/emailWorker.ts:110` `checkAndReserveSlot(rateLimitRedis, senderId, batchId)` with `withTimeout 3000` + `RATE_LIMIT_REDIS_FAIL_MODE=closed`): on `allowed===false` → `deferJob` (`src/workers/emailWorker.ts:41`):
  * `redis_unavailable` → `job.moveToDelayed(now+30000)` (30 s) — never sends unconstrained.
  * cap hit → `nextHour = startOfNextHour(now)` + `stagger = (INCR resched:{batchId}:{hourBucket} -1)*batch.delayMs` → `job.moveToDelayed(nextHour + stagger)` (preserves original spacing within the batch) + `email_jobs.rescheduleCount++` and `scheduledAt` updated. `moveToDelayed` handles both `Missing lock token` fallback (`src/workers/emailWorker.ts:73`).
* **Sending:** after `allowed`, re-check `latest.status===sent` (another worker may have sent while reserving), then `status=processing, attempts++`, `transporter.sendMail({from: row.fromEmail??sender.email})` (`src/lib/mailer.ts:29` cached per sender; placeholder creds → `jsonTransport`), then `status=sent, sentAt, previewUrl`. On throw, `throw err` lets BullMQ retry with `attempts 3 / backoff exponential 5s`; `worker.on('failed')` (`src/workers/emailWorker.ts:186`) marks `failed` only after `attemptsMade >= maxAttempts`.
* **Idempotency:** `processJob` re-reads DB and `if (row.status==='sent') return;` (`src/workers/emailWorker.ts:92`) — a replay (reconciliation, `moveToDelayed`, crash-restart) never double-sends; only residual window is crash between `sendMail` success and `sent` update (Ethereal is fake, so duplicate is harmless; documented as trade-off).

#### Concurrency knobs

* `WORKER_CONCURRENCY=5` controls how many jobs per queue are in `active` simultaneously; the pacing floor still holds.
* Adding a new sender requires a worker restart (no hot-reload) — documented scope in `src/workers/emailWorker.ts:282`.

---

## Features Implemented

### Backend (Express + BullMQ + Prisma)

| Area | Spec Requirement | Implementation | Key File |
|------|------------------|----------------|----------|
| **Scheduler** | `POST /api/batches` with zod, paginated `GET /scheduled` & `/sent`, DB txn → enqueue after commit, filter invalid, dedupe, idempotency | `zod` schema `createBatchSchema` (`src/routes/batches.ts:20`), `parseRecipients` (`src/services/batchService.ts:58`), `idempotencyKeyFor` hash + 24 h `findFirst` (`src/services/batchService.ts:182`), `summaryFor` idempotent 200 | `src/routes/batches.ts`, `src/services/batchService.ts` |
| | Multipart with attachments | `multer.memoryStorage` + `validateAttachments` (`src/routes/batches.ts:62`) against `MAX_*` / `ALLOWED_*` | `src/routes/batches.ts:113` |
| **Persistence** | Postgres + Redis volumes survive restart, reconciliation on startup | `appendonly yes` + `pgdata`/`redisdata` (`docker-compose.yml:24`), `GET /health` checks both + `worker:heartbeat` (`src/routes/health.ts:13`), `npm run reconcile` | `docker-compose.yml`, `src/services/reconcileService.ts`, `src/workers/emailWorker.ts:273` |
| **Rate Limiting** | Global + per-sender + per-batch, safe across workers, defer not fail, stagger | Lua `RESERVE_SCRIPT` + `withTimeout 3s` + fail-closed `redis_unavailable→30s` (`src/services/rateLimiter.ts:25`), `deferJob` next-hour+stagger (`src/workers/emailWorker.ts:41`) | `src/services/rateLimiter.ts`, `src/workers/emailWorker.ts` |
| **Concurrency** | Per-sender pacing, configurable concurrency | Per-sender `Queue` + `Worker` per sender + `limiter max:1/duration:MIN_DELAY` + `concurrency: WORKER_CONCURRENCY` (`src/workers/emailWorker.ts:178`) | `src/queues/emailQueue.ts`, `src/workers/emailWorker.ts`, `src/config/env.ts:11` |
| **Auth** | Google OAuth code flow, email/password, protected `GET /auth/me`, scoped `/api/*` | `GET /auth/google` (`src/routes/auth.ts:39`) sets `oauth_state` cookie, `/callback` exchanges code (`src/services/authService.ts:26`), `verifyIdToken`, `upsertGoogleUser`, `signSession` (`src/config/session.ts:14`), `requireAuth` Bearer→cookie (`src/middleware/auth.ts:15`), `GET /auth/me`, logout clears cookie | `src/routes/auth.ts`, `src/config/oauth.ts`, `src/middleware/auth.ts` |
| **Observability** | Structured logs, central error envelope, graceful shutdown | `pino` per-job logs (`enqueued→processing→sent/failed`), `errorHandler` (`src/middleware/error.ts:71`) maps `ZodError`/`MulterError`→`400 VALIDATION_ERROR` with `details`, `unhandledRejection`/`uncaughtException` + `SIGINT/T` drain (`src/workers/emailWorker.ts:300`) | `src/config/logger.ts`, `src/middleware/error.ts`, `src/app.ts` |

### Frontend (Next.js 14)

| Area | Implementation | Key File |
|------|----------------|----------|
| **Scaffold** | Next 14, `app/` router, `components/`, `lib/api.ts` typed fetch, `types/batch.ts`, `.env.local` `NEXT_PUBLIC_API_URL` | `frontend/package.json:20`, `frontend/lib/api.ts:1`, `frontend/app/layout.tsx:16` |
| **Auth (F1)** | Login page with Google button → `API_URL/auth/google`, email/password toggle, `AuthProvider` wrapping app, `completeGoogleLogin(token)` validates via `/auth/me`, `ProtectedRoute` redirects unauthenticated, global `401` clears storage | `frontend/app/login/page.tsx:9`, `frontend/lib/auth-context.tsx:34`, `frontend/app/oauth/callback/page.tsx:15`, `frontend/components/auth/ProtectedRoute.tsx:12` |
| **Dashboard Shell (F2)** | `Sidebar` with logo, user menu (avatar, name, email, logout), `MailboxNavigation` tabs Scheduled/Sent with counts, `ComposeButton`, responsive `dashboard` flex (`frontend/app/globals.css:232`) | `frontend/components/dashboard/DashboardLayout.tsx:14`, `frontend/components/dashboard/Sidebar.tsx` |
| **Compose (F3)** | Premium redesign: header with badge, 2-col `.compose-layout` (main 1.55fr + sticky side 0.85fr), cards `.compose-card` (`frontend/app/globals.css:657`): **Recipients** (From fixed to authed user `FromField`, `RecipientInput` chips, `LeadUploader` dropzone with `papaparse` + `Attributed ` `recipientParser` live `valid/invalid/dupes`), **Message** (`SubjectInput` with char count, `EmailEditor` TipTap StarterKit+Underline+TextAlign+Link+Placeholder), **Attachments** (`AttachmentUploader` multipart via `Batch` `attachments` Json, limits from `GET /api/config`), **Schedule** (`ScheduleSettings` startTime/delay/hourlyLimit with `Today/Tomorrow` quick picks), `ScheduleSummary` + `ScheduleButton` (gradient, spinner, disabled logic), `GET /api/config` sourced limits (non-blocking `FALLBACK_CONFIG` in `frontend/hooks/useComposeEmail.ts:110`, 8 s `timeoutMs` in `frontend/lib/api.ts:115`) | `frontend/components/compose/ComposePage.tsx:19`, `frontend/hooks/useComposeEmail.ts:139`, `frontend/lib/recipientParser.ts` |
| **Tables (F4/F5)** | `useMailbox(tab)` (`frontend/hooks/useMailbox.ts:66`) fetches `GET /api/emails/scheduled|sent` (`frontend/lib/api.ts:152`), maps to `MailboxViewRow` with `stripHtml` preview, `EmailList` + `EmailRow` with scheduled/sent timestamps, loading `placeholder`, error with Retry, empty state | `frontend/app/dashboard/page.tsx:11`, `frontend/hooks/useMailbox.ts:66`, `frontend/components/dashboard/EmailList.tsx` |
| **Polish (F6)** | Shared `Button`, `Toast` (`frontend/components/ui/Toast.tsx`), error boundary via `errorHandler` + graceful degradation (compose fallback config, login `?error=auth_cancelled` banner `frontend/app/login/page.tsx:20`, overdue promotion), premium card shadows/gradients, keyboard-navigable inputs | `frontend/app/globals.css:657`, `frontend/components/ui/*` |

---

## API Reference (Summary)

Base `http://localhost:4000`. `GET /health` and `/auth/*` public; all `/api/*` require `Authorization: Bearer <jwt>` **or** `session` cookie (`src/middleware/auth.ts:30`). All errors shaped `{error:{code,message,details?}}` (`src/middleware/error.ts:57`).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | — | `{status,db,redis,worker}` — 200 or 503 |
| `GET` | `/auth/google` | — | 302 to Google with `oauth_state` cookie |
| `GET` | `/auth/google/callback` | — | exchanges `code`, 302 to `FRONTEND_URL/oauth/callback?token=` or `.../login?error=` |
| `POST` | `/auth/register` | — | `{email,password,name?}` → 201 `{user,token}` + cookie |
| `POST` | `/auth/login` | — | `{email,password}` → 200 `{user,token}` |
| `GET` | `/auth/me` | yes | current user |
| `POST` | `/auth/logout` | — | clears cookie |
| `POST` | `/api/batches` | yes | core schedule — JSON or `multipart/form-data` (`attachments`) → 201 `{batchId,status,totalRecipients,validRecipients,invalidEmailsSkipped,duplicatesRemoved,first/lastScheduledAt}` or 200 idempotent |
| `GET` | `/api/config` | yes | scheduler limits for compose |
| `GET` | `/api/senders` | yes | list senders (completeness) |
| `GET` | `/api/emails/scheduled` | yes | `?page,limit,status,batchId,senderId` → `{data,pagination}` |
| `GET` | `/api/emails/sent` | yes | same for terminal |
| `GET` | `/api/emails/:jobId` | yes | detail + `previewUrl`/`rescheduleCount` — 404 if missing or belongs to another user |

Full field rules & status tables are in the prior detailed `## API reference` (kept for brevity).

---

## Assumptions, Shortcuts & Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **DB is ground truth, Redis is clock** (`src/services/batchService.ts:198` commit before enqueue) | Survivability: DB `pending` survives Redis loss; reconciliation recovers. | Slight extra latency: enqueue is synchronous in-request; acceptable for ≤5k recipients. Background enqueue would scale better but adds complexity. |
| **One queue per sender** (`src/queues/emailQueue.ts:31`) | Natural per-sender pacing via `limiter`; isolates noisy senders. | Connections scale with senders (fine for assignment). New sender requires worker restart (`src/workers/emailWorker.ts:282`) — documented scope, no hot-reload. |
| **Lua 3-cap rate limit, fail-closed** (`src/services/rateLimiter.ts:25`, `RATE_LIMIT_REDIS_FAIL_MODE=closed`) | Atomic across workers; never blows caps if limiter is down (defers 30 s). | If Redis is down, throughput drops to 0 until Redis recovers (safe vs. spam). 3 s `withTimeout` prevents hanging. |
| **Overdue promotion in reconciliation** (`src/services/reconcileService.ts:102`) | Worker downtime would otherwise leave `delayed` jobs 2 s apart for minutes (limiter drift). Promotion with `delay 0` makes them immediate. | Slight deviation from strict BullMQ `delay` semantics, but matches user expectation that overdue → immediate. |
| **`moveToDelayed` token fallback** (`src/workers/emailWorker.ts:73`) | BullMQ v6 requires lock token; some call sites miss it. Retry bare prevents `Missing lock token` from failing the defer path. | Two attempts in worst case (negligible). |
| **Placeholder Ethereal fallback to `jsonTransport`** (`src/lib/mailer.ts:32`) | Seed without `ethereal:setup` would otherwise make every `sendMail` fail and mark `failed` — confusing in dev. | PreviewUrl is `null` for mock sends; real Ethereal still produces `https://ethereal.email/message/...` after setup. |
| **Deterministic `jobId = email-{cuid}`** (`src/queues/emailQueue.ts:62`) | Idempotent re-add ⇒ reconciliation safe; deviation from spec `email:` because `:` is rejected. | None — hyphen is stored in `bullmq_job_id`. |
| **Idempotency non-unique index** (`prisma/migrations/20260820093000`) | Allows key reuse after 24 h window; unique would block legitimate resend. | Race: concurrent duplicate `POST` with same key could create two batches before `findFirst` — low probability at dashboard scale, mitigated by `summaryFor` fast path. |
| **Synchronous enqueue in request** | Simple, no extra infra (outbox table + poller). | For very large batches (5k) the request holds ~`N * queue.add` (≈ enqueues in `Promise.allSettled` with 3 s timeout). Still <10 s locally. |
| **cuid not UUID** (`prisma/schema.prisma:20`) | Prisma default, shorter, indexed. | Spec's "UUID format" validation is loose — existence check is the real gate. |
| **Duplicate send window** (send succeeds, DB `sent` update crashes) | Guard `if (row.status==='sent') return` in `src/workers/emailWorker.ts:92` handles replay, but not the one-window crash between `sendMail` and DB write — would double-send that one email. Ethereal is fake, so accepted. | Exactly-once would require outbox + transactional send — overkill for assignment. |
| **Frontend Bearer primary, cookie fallback** (`src/middleware/auth.ts:21` + `frontend/lib/api.ts:86`) | SPA reloads after `npm run dev` still work with httpOnly cookie; Bearer stays freshest. | Two code paths, but well-tested (`FRONTEND_URL` vs `API_ORIGIN` mismatch would break cookie). |
| **Compose non-blocking `FALLBACK_CONFIG`** (`frontend/hooks/useComposeEmail.ts:110`, `frontend/lib/api.ts:115` 8 s timeout) | `GET /api/config` being slow should not block the whole compose form (`Loading compose…`). Frontend shows defaults and banner, then patches. | Limits may be slightly stale until fetch completes (rare). |
| **Worker heartbeat + `make docker-build`** | Operability: `GET /health` `worker:stale` tells you to start worker; `make docker-build` produces both backend & frontend images via multi-stage Dockerfiles (`Dockerfile:1`, `frontend/Dockerfile:1`) with `.dockerignore`. | Requires Docker; `frontend/Dockerfile` bakes `NEXT_PUBLIC_API_URL` via `ARG`. |

---

## Verification & Troubleshooting

### Restart test (B6 demo)

```bash
# schedule 5 emails 2 min out via Compose or curl
curl -X POST localhost:4000/api/batches -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"subject":"B6 test","body":"<p>hi</p>","recipients":["a@x.com","b@x.com"],"startTime":"2026-08-21T12:00:00.000Z","delayMs":2000}' | jq
# kill API+worker or `docker stop scheduler-redis` (keep volumes)
docker compose restart redis   # or Ctrl+C then npm run dev:all
curl localhost:4000/health     # → {db:ok, redis:ok, worker:ok} after ~30s heartbeat
# GET /api/emails/scheduled will empty as jobs fire; /sent will show them with previewUrl
# Run twice — second reconciliation is no-op (log `queuedPresent` only)
npm run reconcile
```

### Rate-limit demo (B5)

Set `MAX_EMAILS_PER_HOUR_PER_SENDER=5` in `.env`, restart worker, schedule 10 for same sender at same `startTime`. Expect 5 `sent`, 5 deferred to next hour with `scheduledAt` shifted to `startOfNextHour + stagger` and `rescheduleCount` bumped (visible via `GET /api/emails/:jobId`).

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `POST /api/batches` 400 `startTime must not be in the past` | Client clock behind server 30 s | Pick a future `startTime` (Compose defaults to next top of hour) |
| All `queued` never become `sent` | Worker not running (`worker:stale` in `/health`) | `npm run worker` or `npm run dev:all`; check `worker:heartbeat` in Redis |
| `SENDER_NOT_FOUND` | No `senders` row for `fromEmail` | `npm run db:seed` + `npm run ethereal:setup` |
| Google OAuth `auth_failed` | `API_ORIGIN` mismatch or missing `oauth_state` cookie (cross-origin) | Ensure redirect URI in Google Console equals `${API_ORIGIN}/auth/google/callback` and `FRONTEND_URL` matches the browser origin |
| `NEXT_PUBLIC_API_URL is not configured` | Forgot `cp frontend/.env.local.example frontend/.env.local` or didn't rebuild | `npm run build` in `frontend` bakes the var |
| `make docker-build` fails | Missing `.dockerignore` or old Docker | `docker build -t reachinbox-scheduler-backend -f Dockerfile .` manually |

---

