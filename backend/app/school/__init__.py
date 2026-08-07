"""School ERP API package.

Import ``router`` to mount the complete school system in either the combined
factory application or the standalone school application.
"""

from fastapi import APIRouter

from .admissions import router as admissions_router
from .attendance import router as attendance_router
from .core import router as core_router
from .finance import router as finance_router
from .foundation import ensure_default_school_foundation
from .foundation import router as foundation_router


router = APIRouter()
router.include_router(core_router)
router.include_router(foundation_router)
router.include_router(admissions_router)
router.include_router(attendance_router)
router.include_router(finance_router)

__all__ = ["ensure_default_school_foundation", "router"]
