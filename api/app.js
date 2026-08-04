// api/app.js
// Main entry point for the IMS & POS API server

// dotenv must load BEFORE newrelic so all NEW_RELIC_* env vars are available
// when the agent initialises (it reads them at require-time, not lazily).
require('dotenv').config();

// New Relic must be required before any other module — it instruments them
// at load time. Config comes from env vars set above.
require('newrelic');


const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const path = require('path');
const fs = require('fs');
app.set('trust proxy', 1);
// Ensure uploads/products folder exists
const uploadsProductsDir = path.join(__dirname, 'uploads', 'products');
if (!fs.existsSync(uploadsProductsDir)) {
  fs.mkdirSync(uploadsProductsDir, { recursive: true });
}

// ── Security & parsing middleware ──────────────────────────────────────────────
// CORS: explicitly allowlist the frontend origin.
// Wildcard (*) was replaced here because credentialed requests (Authorization
// headers) are rejected by browsers when the server responds with *.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── In-memory rate limiter (no Redis — v1 decision) ───────────────────────────
// Keyed by tenant_id when available, falls back to IP.
// 300 requests per minute per tenant.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  keyGenerator: (req) => req.tenantId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Route mounts ───────────────────────────────────────────────────────────────
// Phase 14b: requirePasswordChange is applied AFTER tenantAuth per-route.
// We achieve this by wrapping each protected router with a mini-chain:
//   tenantAuth → requirePasswordChange → actual router
// Auth routes (/api/auth/*) are exempt because they handle their own auth.
const requirePasswordChange = require('./middleware/requirePasswordChange');
const tenantAuth            = require('./middleware/tenantAuth');
const { authLimiter }       = require('./middleware/rateLimiter');

// Strict rate limiter on auth endpoints — 20 attempts per IP per 15 min
app.use('/api/auth/login',   authLimiter);
app.use('/api/auth/refresh', authLimiter);

// Helper: wrap a router so every request runs tenantAuth → requirePasswordChange.
// tenantAuth sets req.staffId; requirePasswordChange then checks the DB flag.
// Individual route handlers also call tenantAuth for their own role checks —
// double-calling tenantAuth is harmless (verify is idempotent, same token).
function guardedRouter(router) {
  const wrapper = require('express').Router();
  wrapper.use(tenantAuth, requirePasswordChange);
  wrapper.use(router);
  return wrapper;
}

app.use('/api/auth',      require('./routes/auth'));   // auth routes: no wrapper

const productsRouter = require('./routes/products');
app.use('/api/products',        guardedRouter(productsRouter));
app.use('/api/products/import', guardedRouter(require('./routes/imports')));
// /api/pos: switch-cashier/switch-back first, then scan/validate-cart (products router)
app.use('/api/pos',             guardedRouter(require('./routes/pos')));
app.use('/api/pos',             tenantAuth, requirePasswordChange, productsRouter);
app.use('/api/invoices',        guardedRouter(require('./routes/invoices')));
app.use('/api/inventory',       guardedRouter(require('./routes/inventory')));
app.use('/api/suppliers',       guardedRouter(require('./routes/suppliers')));
app.use('/api/purchase-orders', guardedRouter(require('./routes/purchaseOrders')));
app.use('/api/grn',             guardedRouter(require('./routes/grn')));
app.use('/api/shifts',          guardedRouter(require('./routes/shifts')));
app.use('/api/analytics',       guardedRouter(require('./routes/analytics')));
app.use('/api/payments',        guardedRouter(require('./routes/payments')));
app.use('/api/settings',        guardedRouter(require('./routes/settings')));
app.use('/api/staff',           guardedRouter(require('./routes/staff')));
app.use('/api/cashiers',        guardedRouter(require('./routes/cashiers')));

// ── Multi-branch routes (not yet built) — wire requireFullAccess now ──────────
// When multi-branch screens are added, mount them here:
//   app.use('/api/branches', guardedRouter(require('./routes/branches')));
// The routes/branches router should include requireFullAccess on every handler.
// /api/tenants and /api/locations both served by tenants.js.
// Load the module once; Express handles path routing via the registered handlers.
const tenantsRouter = require('./routes/tenants');
app.use('/api/tenants',  guardedRouter(tenantsRouter));
app.use('/api/locations', tenantAuth, requirePasswordChange, tenantsRouter);
app.use('/api/provider', require('./routes/provider'));  // Phase 15h — standalone tool only

// Serve the create-tenant tool from the backend so it's same-origin as the API.
// Avoids browser CORS blocks that happen when opening the HTML as a file:// URL.
// Access at: http://localhost:3001/provider/tool/create-tenant.html
//
// helmet's default CSP blocks inline <script> tags. Override it for this path
// only — the tool is an internal provider-only page, not a public API route.
app.use('/provider/tool',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],  // allow the inline <script> in the HTML
      styleSrc:   ["'self'", "'unsafe-inline'"],  // allow the inline <style> block
      connectSrc: ["'self'", "http://localhost:3001"],  // allow fetch() to the API
    },
  }),
  express.static(path.join(__dirname, 'tools'))
);
app.use('/webhooks',      require('./routes/webhooks'));

// ── Health check ───────────────────────────────────────────────────────────────
// Pings Postgres with a trivial query. Returns 200 if the DB is reachable,
// 503 if the query fails (e.g. container starting up, DB unreachable).
const db = require('./db');
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'reachable', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// ── Attack endpoints (self-healing demo) ──────────────────────────────────────
// Self-healing is handled entirely by Docker's restart: always policy.
// No watchdog needed — Docker restarts the container automatically after any exit.

// 1. Crash — immediate process exit, Docker restarts within seconds
app.post('/attack/crash', (req, res) => {
  res.json({ message: 'crashing now — Docker will restart automatically' });
  process.exit(1);
});

// 2. OOM — allocate real memory until the process exits at the memory limit.
//    Touches every 4KB page so kernel actually commits RSS (not CoW zero pages).
//    Rate: 2MB/s — on standard Docker the cgroup OOM killer fires at 128MB.
//    On rootless Podman where the OOM killer may not fire, the process monitors
//    its own cgroup RSS and exits cleanly when it hits 95% of the limit,
//    giving Docker's restart: always the same self-healing effect.
app.post('/attack/oom', (req, res) => {
  const CHUNK  = 1 * 1024 * 1024;  // 1 MB per tick — ~60s to hit 128MB limit
  const PAGE   = 4096;
  const sink   = [];
  let   totalMB = 0;

  res.json({ message: 'OOM attack started — memory climbing 1MB/s until limit is hit (~60s)' });
  console.log('[attack/oom] started — allocating until killed or limit reached');

  // Read cgroup memory limit once
  let cgroupLimit = 0;
  try {
    const raw = require('fs').readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    cgroupLimit = raw === 'max' ? 0 : parseInt(raw, 10);
    console.log(`[attack/oom] cgroup limit: ${Math.round(cgroupLimit / 1024 / 1024)}MB`);
  } catch { /* not in a cgroup — let the OOM killer handle it */ }

  const interval = setInterval(() => {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (let offset = 0; offset < CHUNK; offset += PAGE) buf[offset] = 1;
    sink.push(buf);
    totalMB += 2;
    console.log(`[attack/oom] ${totalMB}MB allocated`);

    // Check cgroup RSS — exit when at 95% of limit so Docker restarts us
    // even on environments where the kernel OOM killer doesn't fire (rootless Podman).
    if (cgroupLimit > 0) {
      try {
        const current = parseInt(
          require('fs').readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim(), 10
        );
        const pct = current / cgroupLimit * 100;
        if (pct >= 95) {
          console.log(`[attack/oom] ${pct.toFixed(1)}% of limit — exiting for self-healing restart`);
          clearInterval(interval);
          process.exit(1);
        }
      } catch { /* ignore read errors */ }
    }
  }, 1000);
});

// 3. CPU stress — pegs the CPU limit for 60s then stops cleanly
//    Worker threads keep the event loop alive so the response flushes first
//    Visible on NR as a sustained CPU spike, drops after 60s — no restart needed
app.post('/attack/cpu', (req, res) => {
  const { Worker } = require('worker_threads');
  const DURATION   = 60_000;  // 60s of stress — long enough for 6 NR samples at 10s
  const numCpus    = require('os').cpus().length;

  res.json({ message: `CPU stress started — ${DURATION/1000}s of worker threads, then auto-stops` });
  console.log('[attack/cpu] started');

  const code = `
    const { workerData: { until, seed } } = require('worker_threads');
    let x=123456789+seed, y=362436069, z=521288629, w=88675123;
    while(Date.now()<until){let t=x^(x<<11);x=y;y=z;z=w;w=w^(w>>>19)^t^(t>>>8);}
  `;
  const until   = Date.now() + DURATION;
  const workers = [];

  // Use only 2 workers — enough to saturate a 1-core limit without
  // consuming too much memory (each worker needs ~10MB of V8 heap)
  for (let i = 0; i < 2; i++) {
    const w = new Worker(code, { eval: true, workerData: { until, seed: i } });
    w.on('error', () => {});
    workers.push(w);
  }

  setTimeout(() => {
    workers.forEach(w => w.terminate());
    console.log('[attack/cpu] stopped');
  }, DURATION + 2000);
});

// ── Start server ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`IMS API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
