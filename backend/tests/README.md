# Backend Tests

Tests and endpoint checks for the FastAPI backend live here.

## Rules

- Keep test files out of the backend root.
- Name focused tests as `test_<feature>.py`.
- Put broader manual smoke checks here too, but keep their names clear.
- Tests should import from `app.*`, not from moved compatibility wrapper modules unless the wrapper itself is being tested.

Run from `backend/`:

```powershell
..\venv\Scripts\python.exe -m unittest discover tests
```
