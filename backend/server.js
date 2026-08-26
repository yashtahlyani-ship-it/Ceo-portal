// server.js — GyFTR CEO Office Portal API
//
// Express backend that replaces the direct Supabase calls the browser used to
// make. Runs on ECS Fargate (arm64) behind an ALB, alongside the Marketing and
// Legal portal APIs. Auth is AWS Cognito; data is RDS Postgres; attachments are
// a private S3 bucket.
//
// The one structural difference from those two siblings: authorization is not
// in this process. It is in Postgres Row-Level Security, and this server's job
// is to bind a verified identity to each transaction and get out of the way.
// See sql/00_compat.sql and db.js `withUser`.

import 'dotenv/config';
import express from 'express';
import cors    from 'cors';

import { initDbWithRetry, isDbReady, dbLastError, query } from './db.js';
import { requireAuth }  from './middleware/auth.js';
import { loadIdentity } from './middleware/identity.js';

import profilesRoutes      from './routes/profiles.js';
import tasksRoutes         from './routes/tasks.js';
import assignmentsRoutes   from './routes/assignments.js';
import attachmentsRoutes   from './routes/attachments.js';
import notificationsRoutes from './routes/notifications.js';
import adminRoutes         from './routes/admin.js';

const app  = express();
const PORT = process.env.PORT || 7869;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Explicit allow-list, never '*'. Beyond being the right default, '*' is
// invalid alongside credentials:true anyway, so a wildcard here would fail in
// a way that looks like a browser bug.
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  ...(process.env.NODE_ENV === 'production' ? [] : [
    'http://localhost:7868',
    'http://localhost:5173',
    'http://localhost:4173',
  ]),
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// ── Health ───────────────────────────────────────────────────────────────────
// Liveness — is the process up? This is what the ALB target group polls, and it
// deliberately does NOT touch the database: a brief RDS blip would otherwise
// deregister every task at once and turn a degraded service into a total
// outage.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gyftr-ceo-portal-api' }));

// Readiness — can it actually serve? `/health` returning ok while every request
// 500s is the failure mode that costs the most time to diagnose: the task is
// running, the ALB says healthy, and the portal is dead. Use this one when
// something is wrong.
app.get('/health/deep', async (_req, res) => {
  const started = Date.now();
  if (!isDbReady()) {
    return res.status(503).json({
      ok: false,
      database: 'not ready',
      error: dbLastError() || 'still connecting',
      hint: 'The API is running but cannot reach RDS. Check DB_* / AWS_SECRET_NAME and the RDS security group.',
    });
  }
  try {
    await query('select 1');
    res.json({ ok: true, database: 'reachable', latencyMs: Date.now() - started });
  } catch (err) {
    console.error('[health/deep] database unreachable:', err.message);
    res.status(503).json({ ok: false, database: 'unreachable', error: err.message });
  }
});

// Without the database there is nothing to serve. Say so in a way somebody can
// act on, rather than letting every request fail with an opaque error.
app.use('/api', (req, res, next) => {
  if (isDbReady()) return next();
  res.status(503).json({
    error: 'The portal is starting up or cannot reach its database. ' +
           (dbLastError() || 'Retrying.') +
           ' Check GET /health/deep for the current status.',
  });
});

// ── Everything under /api needs a verified token AND a linked profile ────────
// Order matters: requireAuth establishes WHO (a Cognito signature), then
// loadIdentity establishes WHICH PROFILE, and req.profile.id is what becomes
// auth.uid() for every query in the request. No route below is reachable
// without both.
app.use('/api', requireAuth, loadIdentity);

app.use('/api', profilesRoutes);
app.use('/api', tasksRoutes);
app.use('/api', assignmentsRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', adminRoutes);

// Multer rejects oversize uploads with a code, not an HTTP status. Without this
// the client gets a 500 for a file that is simply too big, which reads as a
// server fault rather than something the person can fix.
app.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is larger than the 10 MB limit.' });
  }
  next(err);
});

// ── Start ────────────────────────────────────────────────────────────────────
// Listen FIRST, connect second. If the database is unreachable the API still
// answers /health (so the load balancer keeps a target and the service stays
// reachable) and /health/deep reports exactly why. Awaiting the connection and
// exiting on failure is what made a transient RDS problem indistinguishable
// from a broken deploy on the sibling portals.
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initDbWithRetry().catch(err => {
    console.error('[server] Database retry loop stopped unexpectedly:', err);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled rejection:', err);
});
