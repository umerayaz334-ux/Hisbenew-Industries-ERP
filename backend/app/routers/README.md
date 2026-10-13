# Backend Routers

Put FastAPI route modules here.

Naming convention: `<feature>_router.py`.

A router should handle HTTP input/output and call services for business logic. Avoid putting large calculations, vendor API parsing, or database-heavy workflows directly in route handlers.