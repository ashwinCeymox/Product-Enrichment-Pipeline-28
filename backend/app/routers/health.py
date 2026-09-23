"""
Health check router — reports status of database, Redis, and Celery Beat.
"""
import os

from fastapi import APIRouter
from app.schemas.config import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def health_check():
    """Returns the status of core infrastructure components."""
    result = HealthResponse()

    # ── Database check ────────────────────────────────
    try:
        from app.database import engine
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        result.database = "UP"
    except Exception:
        result.database = "DOWN"

    # ── Redis check ───────────────────────────────────
    try:
        import redis
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        r = redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
        result.redis = "UP"
    except Exception:
        result.redis = "DOWN"

    # ── Celery Beat check ─────────────────────────────
    # We check if we can inspect active workers via the Celery app
    try:
        from app.celery_app import celery_app
        inspector = celery_app.control.inspect(timeout=2)
        active = inspector.active()
        if active:
            result.celery_beat = "POLLING"
        else:
            result.celery_beat = "STOPPED"
    except Exception:
        result.celery_beat = "STOPPED"

    return result
