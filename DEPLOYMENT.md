# Hisbenew ERP production deployment

The scalable deployment uses:

- four FastAPI/Uvicorn workers;
- PostgreSQL for concurrent ERP transactions;
- Redis for real-time message and call events across workers;
- one WebSocket per signed-in user instead of frequent polling;
- Nginx for HTTPS and WebSocket proxying.

The Windows portable launcher still uses one process and SQLite. It is intended for local use, not 1,000 concurrent users.

## Start a fresh production installation

1. Copy `.env.example` to `.env`.
2. Set a strong `POSTGRES_PASSWORD` and `SECRET_KEY`.
3. If you use Amazon Seller Central, set `AMAZON_CREDENTIALS_ENCRYPTION_KEY`.
   Keep the same value when moving an existing encrypted Amazon database to a new server.
4. Set your public domain:

```env
CORS_ALLOW_ORIGINS=https://erp.yourdomain.com
VITE_API_BASE_URL=
HOST_PORT=8000
WEB_CONCURRENCY=4
```

5. Build and start the stack:

```bash
docker compose up -d --build
```

6. Check service health:

```bash
docker compose ps
docker compose logs --tail=100 erp
```

The initial administrator is `adminmain` with PIN `1234`. Change the PIN immediately.

## Move existing portable ERP data to PostgreSQL

Do this before starting the ERP application against the new database:

```bash
mkdir -p data
cp backend/hisbenew_industries.db data/hisbenew_industries.db
docker compose up -d db redis
docker compose build erp
docker compose run --rm erp python scripts/migrate_sqlite_to_postgres.py
docker compose up -d
```

The importer refuses to write into a populated PostgreSQL database. Its `--clear-target` option intentionally replaces existing target data and should only be used when that replacement is planned and backed up.

Uploaded files remain in `./data/static/uploads`. Copy existing uploads there before deployment:

```bash
mkdir -p data/static/uploads
cp -r backend/static/uploads/. data/static/uploads/
```

## Connect HTTPS and the domain

1. Point the domain DNS `A` record to the server.
2. Install Nginx.
3. Copy `deploy/nginx.conf.example` into the Nginx site configuration.
4. Replace `erp.yourdomain.com` with the real domain.
5. Add an HTTPS certificate and reload Nginx.

The `/ws/` proxy section is required for immediate messages, incoming-call ringing, and WebRTC signaling.

## Voice calls

Microphone access requires HTTPS. For dependable calls between different networks, run coturn separately and set authenticated STUN/TURN details in `.env`:

```env
INTERNAL_CALL_ICE_SERVERS=[{"urls":"stun:turn.yourdomain.com:3478"},{"urls":"turn:turn.yourdomain.com:3478","username":"erp","credential":"replace-me"}]
```

TURN bandwidth must be sized separately from the ERP API when many calls are active simultaneously.

## Capacity tuning

The default four workers can open at most 60 normal PostgreSQL connections: four workers multiplied by a pool of 10 plus overflow of 5. Keep total pools below the database connection limit.

Useful settings:

```env
WEB_CONCURRENCY=4
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=5
DATABASE_POOL_TIMEOUT=30
```

Increase workers only after measuring CPU, memory, PostgreSQL connections, p95 latency, and errors. Run the staged Locust test described in `loadtest/README.md` before releasing to 1,000 users.

## Portable Docker mode

For a small single-computer SQLite installation only:

```bash
docker compose -f docker-compose.portable.yml up -d --build
```
