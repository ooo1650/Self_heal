# Self-Healing Infrastructure — How It Works

## What This Is

A containerised Node.js + PostgreSQL + Next.js application that demonstrates
**self-healing infrastructure** — the ability for a system to detect failure,
recover automatically, and continue operating without human intervention.

The self-healing mechanism is intentionally simple: Docker's own `restart: always`
policy. When any process inside a container exits (for any reason), Docker
immediately starts a new container from the same image. No custom recovery code,
no orchestration platform — just one line in a compose file.

The three attack endpoints exist to deliberately trigger failures so the recovery
can be observed in real time on a New Relic monitoring dashboard.

---

## Architecture

```
Browser / curl
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  Docker Compose — ims-platform network              │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │  ims-frontend │    │  ims-backend (ATTACK TARGET)│  │
│  │  Next.js     │───▶│  Node.js / Express       │  │
│  │  port 3000   │    │  port 3001               │  │
│  └──────────────┘    │  memory limit: 128 MB    │  │
│                      │  CPU limit:    1 core    │  │
│                      │  restart:      always    │  │
│                      └────────────┬─────────────┘  │
│                                   │                 │
│                      ┌────────────▼─────────────┐  │
│                      │  ims-postgres             │  │
│                      │  PostgreSQL 16            │  │
│                      │  no restart policy        │  │
│                      │  no resource limits       │  │
│                      └──────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  ims-newrelic-infra (MONITORING SIDECAR)     │  │
│  │  network_mode: host                          │  │
│  │  reads Docker socket every 10s               │  │
│  │  ships metrics → New Relic cloud             │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## How Self-Healing Works

**The entire self-healing mechanism is two lines in `docker-compose.yml`:**

```yaml
restart: always          # restart on any exit
deploy:
  resources:
    limits:
      memory: 128m       # hard memory cap — OOM kill when exceeded
      cpus: "1.0"        # CPU quota
```

### Memory attack flow

```
POST /attack/oom
      │
      ▼
Container allocates 2MB of real RAM every second
      │
      ▼
After ~45s: container RSS hits 128MB hard limit
      │
      ▼
Linux cgroup OOM killer sends SIGKILL to the process
      │
      ▼
Docker detects container exited (code 137 = SIGKILL)
      │
      ▼ (restart: always)
Docker starts a fresh container from the same image
      │
      ▼
Container is back online in 3–5 seconds
```

### CPU attack flow

```
POST /attack/cpu
      │
      ▼
2 worker threads spin tight XOR-shift loops
      │
      ▼
Container CPU usage climbs to 100% of its 1-core quota
      │
      ▼
Docker throttles the container (does NOT kill it)
      │
      ▼
After 60s: workers stop, CPU returns to baseline
No restart occurs — CPU throttling is not fatal
```

### Crash flow

```
POST /attack/crash
      │
      ▼
process.exit(1) called immediately
      │
      ▼
Docker detects container exited (code 1)
      │
      ▼ (restart: always)
Docker starts a fresh container in < 2 seconds
```

---

## File Reference

### `docker-compose.yml`

Defines and wires all four services. Key decisions:

| Setting | Value | Why |
|---|---|---|
| `backend.restart` | `always` | Restart on any exit — the self-healing mechanism |
| `backend.memory` | `128m` | Hard cap — OOM kill triggers when exceeded |
| `backend.cpus` | `1.0` | Throttle ceiling — CPU attack is visible but non-fatal |
| `postgres.restart` | (not set) | Postgres should stay stable; no restart policy |
| `postgres.ports` | (not published) | DB not reachable from outside Docker network |
| `backend.depends_on` | `postgres: service_healthy` | Backend waits for DB before starting |
| `newrelic-infra.network_mode` | `host` | Agent needs host-level network visibility |
| `newrelic-infra.dns` | `8.8.8.8` | Bypasses broken systemd-resolved on this host |

### `api/Dockerfile`

Single-stage Node.js image. Notable choices:

- **Non-root user** (`appuser`) — process can't write outside `/app` at runtime
- **`npm ci --omit=dev`** — production deps only; rebuild is fast because the `npm ci` layer is cached separately from source code
- **`HEALTHCHECK`** — polls `/api/health` (which pings Postgres) every 15s; used by compose `depends_on: condition: service_healthy`

### `frontend/Dockerfile`

Three-stage build:

1. **`deps`** — installs all node_modules (cached)
2. **`builder`** — runs `next build`, bakes `NEXT_PUBLIC_API_URL` into the JS bundle at compile time (Next.js `NEXT_PUBLIC_*` vars are inlined, not runtime)
3. **`runner`** — copies only `.next/standalone` (~200MB vs ~1GB for full image); runs `node server.js` with no Next.js CLI needed

### `api/app.js` — Attack Endpoints

Three endpoints that trigger distinct failure modes:

#### `POST /attack/crash`
```
process.exit(1)
```
Simplest possible failure. Sends the response first so the caller sees the message, then exits. Docker restarts within seconds. Demonstrates that any unexpected crash is automatically recovered.

#### `POST /attack/oom`
```
Allocates 2MB every second
Each buffer: Buffer.allocUnsafe() + write 1 byte every 4KB page
```
`Buffer.allocUnsafe()` alone does not work — the Linux kernel uses copy-on-write for zero-filled pages, so the memory appears allocated in JS but is never counted against the container's cgroup limit. Writing one non-zero byte per 4096-byte OS page forces the kernel to allocate a real physical page for each, which is then counted against the 128MB limit. At 2MB/s, the limit is hit in approximately 45 seconds.

#### `POST /attack/cpu`
```
2 worker_threads running XOR-shift arithmetic loops for 60s
```
`worker_threads` is used (not a synchronous loop) so the main event loop stays alive and the HTTP response is sent before the CPU work begins. XOR-shift is a pseudo-random number generator — each iteration is unpredictable so V8 cannot optimize the loop away. Two workers on a 1-core limit fully saturate the CPU quota. Workers stop cleanly after 60 seconds — no restart occurs because CPU throttling is not a fatal event.

### `docker-stats-integration.sh`

A shell script that runs inside the `newrelic-infra` container every 10 seconds. It is the **observability layer** — it has nothing to do with self-healing.

**What it does:**

1. Calls the Docker Stats API for each container via the Unix socket:
   ```
   GET http://localhost/containers/ims-backend/stats?stream=false
   GET http://localhost/containers/ims-backend/json
   ```
2. Passes the raw JSON to an embedded Python script for parsing
3. Python computes:
   - **Memory %**: `memory_stats.usage / memory_stats.limit × 100` (cgroup RSS, same source as `docker stats`)
   - **CPU %**: delta of `cpu_stats.cpu_usage.total_usage` between runs ÷ container CPU quota × 100, capped at 100%
   - **Restart count**: compares `State.StartedAt` to the previous run's saved value; increments a counter in `/tmp` if it changed
4. Outputs a single-line JSON payload in New Relic integration protocol v3 format
5. New Relic infra agent reads the output and ships it to NR

**Why Python (not shell math):**
CPU nanosecond timestamps exceed 32-bit integer range. Shell arithmetic (`$(( ))`) silently overflows and produces garbage. Python handles arbitrary-precision integers natively.

**Why persisted state for CPU:**
The Docker Stats API endpoint returns `precpu_stats.total_usage = 0` on every fresh HTTP request — it only populates `precpu_stats` if the same connection makes a second call. By saving the current `cpu_stats` to `/tmp` on each run and computing the delta against it on the next run, the script gets accurate CPU deltas without requiring a persistent connection.

### `docker-stats-integration.yml`

Tells the New Relic infrastructure agent to run the script:

```yaml
integrations:
  - name: com.custom.docker-stats
    exec: /bin/sh /var/db/newrelic-infra/custom-integrations/docker-stats.sh
    interval: 10s
```

Every 10 seconds the agent runs the script, reads its stdout, and forwards the `DockerStatsSample` events to New Relic. These events power the dashboard widgets.

---

## New Relic Dashboard Queries

### Memory — Used vs Limit
```sql
SELECT latest(memoryUsageMB) AS 'Used MB',
       latest(memoryLimitMB) AS 'Limit MB'
FROM DockerStatsSample
WHERE containerName = 'ims-backend'
SINCE 30 minutes ago
TIMESERIES 30 seconds
```
Y-axis max: `140`

### CPU — % of Container Limit
```sql
SELECT latest(cpuPercent) AS 'CPU %',
       latest(cpuLimit) AS 'Limit'
FROM DockerStatsSample
WHERE containerName = 'ims-backend'
SINCE 30 minutes ago
TIMESERIES 30 seconds
```
Y-axis max: `110`

### Restart Counter
```sql
SELECT latest(cumulativeRestarts) AS 'Total Restarts'
FROM DockerStatsSample
WHERE containerName = 'ims-backend'
SINCE 3 hours ago
```
Chart type: Billboard

---

## Running the Demo

```bash
cd ~/Desktop/IMS_v2/ims-platform

# Start everything
docker compose up -d

# Wait ~30 seconds for all containers to reach healthy state
docker ps
```

### Attack sequence

Run these one at a time, with 90 seconds between each so the dashboard shows clean distinct events:

```bash
# 1. Memory attack — watch Used MB climb to 128MB then drop (OOM kill + restart)
curl -X POST http://localhost:3001/attack/oom

# 2. CPU attack — watch CPU % climb to 100%, hold for 60s, drop back to 0
curl -X POST http://localhost:3001/attack/cpu

# 3. Crash — instant restart, restart counter increments
curl -X POST http://localhost:3001/attack/crash
```

### Confirm self-healing after OOM

```bash
# Was the container actually OOM-killed by the kernel?
docker inspect ims-backend --format='OOMKilled={{.State.OOMKilled}}'
# Expected: true

# What exit code?
docker inspect ims-backend --format='ExitCode={{.State.ExitCode}}'
# Expected: 137 (128 + SIGKILL = OOM kill)

# Is it running again?
docker ps --filter name=ims-backend --format '{{.Status}}'
# Expected: Up X seconds
```

---

## Stopping and Starting

```bash
# Stop all containers — DATA IS PRESERVED (postgres volume survives)
docker compose down

# Start again — uses existing images, no rebuild needed
docker compose up -d

# Rebuild after a code change
docker compose up --build -d

# ⚠️  Wipe database (all data deleted)
docker compose down -v
```

---

## Key Design Decisions

**Why `restart: always` and not a custom watchdog?**
Docker's restart policy is implemented at the daemon level — it fires even if the container is OOM-killed by the kernel before the process can run any cleanup code. A watchdog in the application code cannot handle SIGKILL. `restart: always` handles every exit scenario including SIGKILL, SIGTERM, and any exit code.

**Why are Postgres and Frontend not attack targets?**
The demo focuses on the application tier (backend). Postgres has no restart policy because the database should be the stable foundation — restarting it under load would cause data loss or corruption. The frontend has no resource limits because it's stateless and not the interesting part of the demo.

**Why is port 5432 not published to the host?**
The Postgres container has no `ports:` entry in compose. It is only reachable by other containers on `ims-net` via the service name `postgres`. This prevents external connections and reflects real production practice where databases are never directly internet-accessible.

**Why does the frontend Dockerfile bake the API URL at build time?**
Next.js inlines `NEXT_PUBLIC_*` variables into the JavaScript bundle during `next build`. The compiled JS running in the user's browser cannot read runtime environment variables — it can only use values that were present during the build. Since the browser calls the backend directly (not through the Docker network), the URL must be `http://localhost:3001` (the host-published port), not `http://ims-backend:3001` (the Docker internal DNS name which the browser cannot resolve).
