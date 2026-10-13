# Hisbenew ERP Project Structure

This project is the active v1 ERP. Keep the old UI behavior, but keep new code in clear module homes so errors are easy to trace.

## Top-level folders

```text
Hisbenew Industries ERP/
  backend/              FastAPI backend, SQLite data, uploads, integrations, tests
  frontend/             React/Vite frontend
  print-agent/          Local Windows printer bridge agent
  scripts/              Operator/deployment scripts
  deploy/               Deployment examples and server config
  loadtest/             Load testing tools
  docs/                 Architecture and maintenance notes for v1
  v2/                   Frozen rebuild experiments; do not use for v1 work
```

## Backend code layout

```text
backend/app/
  main.py               FastAPI app assembly and legacy route surface
  models.py             SQLAlchemy models shared by the legacy app
  schemas.py            Pydantic schemas shared by the legacy app
  database.py           DB engine/session/migrations/tenant helpers
  config.py             Paths, environment, app settings
  security.py           Auth, tokens, PIN/password helpers
  routers/              HTTP routers by feature area
  services/             Business services with no direct UI assumptions
  integrations/         External APIs and vendor-specific logic
  school/               Legacy school ERP module
  service_takers/       Service portal module
  assets/               Static assets used by backend-generated docs/PDFs
  data/                 Small packaged data files
```

## New backend code rules

- Put new API endpoints in `backend/app/routers/<feature>_router.py`.
- Put reusable business logic in `backend/app/services/<feature>/` or `backend/app/services/<feature>.py`.
- Put vendor/API-specific code in `backend/app/integrations/<vendor>/`.
- Keep `main.py` for app wiring and legacy routes only. Do not add large new workflows there.
- If moving old code, leave a tiny compatibility wrapper at the old import path until all callers are updated.
- Runtime data stays under `backend/` and should not be imported as code: database, backups, uploads, generated optimized images, FedEx cache/settings.

## Frontend code layout

```text
frontend/src/
  pages/                Route-level ERP screens
  components/           Shared UI components
  hooks/                Reusable React hooks
  utils/                Shared formatting/API helpers
  api/                  API clients and realtime connection helpers
  school/               Legacy school UI module
```

## New frontend code rules

- Keep route pages in `pages/`.
- Move repeated page logic into `hooks/`.
- Move repeated widgets into `components/`.
- Move pure formatting/parsing/helper logic into `utils/`.
- Keep API base URLs and fetch wrappers inside `api/`.

## First cleanup completed

These old backend modules now have clearer homes with compatibility wrappers left in place:

- `app.backup_service` -> `app.services.backup_service`
- `app.deployment_control` -> `app.routers.deployment_router`
- `app.print_agent` -> `app.routers.print_agent_router`
- `app.fedex_tracking` -> `app.integrations.fedex.tracking`
- `app.label_printing` -> `app.services.printing.label_printing`
- `app.product_catalog` -> `app.services.catalog.product_catalog`
- `app.realtime` -> `app.services.realtime`
- `app.usa_shipping` -> `app.services.shipping.usa_shipping`

The wrappers exist only to keep old imports working. New code should import from the new locations.