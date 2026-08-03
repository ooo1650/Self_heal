# Local Setup — IMS Platform

All three services (Postgres, backend, frontend) are managed from the
`ims-platform/` directory via a single `docker-compose.yml`.

## 1. Configure environment

```bash
cp api/.env.template api/.env
```

Edit `api/.env` and fill in:

- `JWT_SECRET` and `JWT_REFRESH_SECRET`:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `CREDENTIAL_ENCRYPTION_KEY`:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `SMTP_USER` / `SMTP_PASS` — Gmail App Password for OTP emails
- `PROVIDER_SECRET` — any random hex string, must match `tools/create-tenant.html`

The `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` values in `.env`
are used by both the Postgres container and the backend's connection string.
Change them together if you want different credentials.

## 2. Start everything

From the `ims-platform/` directory:

```bash
docker compose up --build
```

Startup order is enforced:
1. `postgres` starts → healthcheck polls `pg_isready` until ready
2. `backend` starts only after postgres is healthy → its own healthcheck polls `/api/health`
3. `frontend` starts after backend is up

All three containers should reach a healthy/running state within ~60 seconds.

## 3. Run migrations

With the containers running, apply migrations in order:

```bash
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/001_tenant_payment_credentials.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/002_phase14a_schema.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/003_add_password_change_otp.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/004_fix_cashier_dummy_email.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/005_cashier_schema_split.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/006_fix_cash_shifts_staff_id_nullable.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/007_staff_access_tier.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/008_staff_access_tier_corrections.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/009_fix_existing_staff_must_change_password.sql
docker exec -i ims-postgres psql -U imsuser -d imsdb < api/migrations/010_phase16a_schema.sql
```

## 4. Verify

```bash
# Backend health (also checks DB connectivity)
curl http://localhost:3001/api/health
# → {"status":"ok","db":"reachable","timestamp":"..."}

# Frontend
open http://localhost:3000
```

## 5. Create first tenant

Open `tools/create-tenant.html` in your browser.
`API_URL` is set to `http://localhost:3001`. Make sure `PROVIDER_SECRET`
matches the value in `api/.env`.

## Useful commands

```bash
# Stop all containers (DATA IS PRESERVED — volume survives)
docker compose down

# ⚠️  DANGER: Stop AND wipe the entire database (all tenants, staff, products deleted)
# Only use this for a truly fresh start. You will need to re-run migrations
# and recreate all tenants afterward.
docker compose down -v

# View logs
docker logs -f ims-backend
docker logs -f ims-postgres
docker logs -f ims-frontend

# Open a psql shell
docker exec -it ims-postgres psql -U imsuser -d imsdb

# Check container health status
docker ps
```

## If you accidentally wipe the DB

Re-run the base schema, then recreate your tenant:

```bash
# 1. Recreate schema
docker exec -i ims-postgres psql -U imsuser -d imsdb \
  < api/migrations/000_base_schema.sql

# 2. Open the tenant creation tool
# http://localhost:3001/provider/tool/create-tenant.html

# 3. (Optional) Skip the OTP first-login step for demo convenience
docker exec ims-postgres psql -U imsuser -d imsdb -c \
  "UPDATE staff SET must_change_password = false WHERE role = 'owner';"
```

## Self-healing demo

```bash
# Trigger a process crash — backend restarts automatically
curl -X POST http://localhost:3001/attack/crash

# Trigger OOM — backend hits 128m limit, gets killed, restarts automatically
curl -X POST http://localhost:3001/attack/oom

# Verify OOM kill
docker inspect ims-backend --format='{{.State.OOMKilled}}'
```
