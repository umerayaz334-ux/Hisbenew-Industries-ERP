# Backend

FastAPI backend for the active Hisbenew ERP.

## Main folders

- `app/main.py`: app startup, router registration, and legacy route surface.
- `app/routers/`: API routers grouped by feature.
- `app/services/`: business logic and reusable backend services.
- `app/integrations/`: external vendor/API integrations such as Amazon and FedEx.
- `app/models.py`: shared SQLAlchemy models.
- `app/schemas.py`: shared Pydantic schemas.
- `tests/`: backend tests and endpoint checks.

## Rule for new backend work

Do not add large new code blocks to `app/main.py`. Add endpoints to `app/routers/`, reusable logic to `app/services/`, and external API code to `app/integrations/`.

Run from this folder with:

```powershell
..\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If using the project virtualenv inside `backend/`:

```powershell
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```