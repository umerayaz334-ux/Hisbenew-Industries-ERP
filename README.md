# Hisbenew Industries ERP

Active v1 factory ERP. Keep the current screens and behavior, but keep new code in clear homes so speed, debugging, and maintenance stay manageable.

## Project Map

- `backend/`: FastAPI backend, database models, integrations, services, routers, and tests.
- `frontend/`: React/Vite app used by operators and admins.
- `print-agent/`: local Windows bridge for thermal label printers.
- `scripts/`: one-off operational scripts and migrations.
- `deploy/`: deployment examples and server files.
- `loadtest/`: performance/load testing tools.
- `docs/`: structure and maintenance notes.

Start with `docs/PROJECT_STRUCTURE.md` before adding or moving large features.

## Folder Rules

- API endpoints belong in `backend/app/routers/`.
- Backend business logic belongs in `backend/app/services/`.
- External vendor code belongs in `backend/app/integrations/`.
- Frontend screens belong in `frontend/src/pages/`.
- Shared frontend UI belongs in `frontend/src/components/`.
- Shared frontend logic belongs in `frontend/src/hooks/` or `frontend/src/utils/`.
- Runtime data, cache files, backups, uploads, and generated images should not be treated as source code.

## Run

Backend:

```powershell
cd backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm run dev
```
