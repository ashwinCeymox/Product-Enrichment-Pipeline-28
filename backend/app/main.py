"""
Active Fitness Product Enrichment API
Main FastAPI application entry point.

Run: uvicorn app.main:app --reload --port 8000
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine

# Import all models so they are registered with Base.metadata
import app.models  # noqa: F401

# Import routers
from app.routers import health, jobs, dashboard, images, settings, auth, users, credits

# ── Create tables (dev convenience — use Alembic in production) ──
Base.metadata.create_all(bind=engine)

# ── App setup ────────────────────────────────────────────────────
app = FastAPI(
    title="Active Fitness Product Enrichment",
    description="AI-powered product data enrichment pipeline with human approval gates.",
    version="1.0.0",
)

# ── CORS (allow React dev server) ────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Lock down in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files (for zip downloads, images) ─────────────────────
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")
os.makedirs(output_dir, exist_ok=True)
app.mount("/output", StaticFiles(directory=output_dir), name="output")

# ── Register routers ─────────────────────────────────────────────
app.include_router(health.router)
app.include_router(jobs.router)
app.include_router(dashboard.router)
app.include_router(images.public_router)
app.include_router(images.router)
app.include_router(settings.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(credits.router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": "Active Fitness Product Enrichment API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


# ── Auto-recovery for orphaned image generation tasks ────────────
# When the server restarts (e.g. hot-reload), any background tasks
# generating images are killed mid-flight, leaving tasks stuck at
# "image_generation" status forever. This startup hook detects and
# re-dispatches them.

import threading
import asyncio
import time

def _recover_stuck_tasks():
    """Background thread that recovers tasks stuck in image_generation."""
    # Small delay to let the server fully start up
    time.sleep(3)
    
    from app.database import SessionLocal
    from app.models.scrape_task import ScrapeTask
    
    db = SessionLocal()
    try:
        stuck_tasks = db.query(ScrapeTask).filter(
            ScrapeTask.status == "image_generation"
        ).all()
        
        if not stuck_tasks:
            return
        
        print(f"\n[recovery] Found {len(stuck_tasks)} task(s) stuck in image_generation, re-dispatching...")
        
        for task in stuck_tasks:
            task_id = str(task.id)
            task_name = task.task_name
            print(f"[recovery]   → Re-dispatching to Celery: {task_name} ({task_id[:12]}...)")
            
            from app.celery_app import celery_app
            celery_app.send_task("app.tasks.gen_images.generate_images_task", args=[task_id])
        
        print(f"[recovery] All {len(stuck_tasks)} stuck task(s) re-dispatched to Celery.\n")
    except Exception as e:
        print(f"[recovery] Error during recovery: {e}")
    finally:
        db.close()


def _bootstrap_superadmin():
    from app.database import SessionLocal
    from app.models.user import User, UserRole, UserStatus
    from app.utils.auth_utils import get_password_hash
    from app.config_loader import get_dynamic_env

    db = SessionLocal()
    try:
        # Check if the users table is completely empty
        user_count = db.query(User).count()
        if user_count == 0:
            print("\n[bootstrap] No users found. Bootstrapping initial Superadmin account...")
            email = get_dynamic_env("SUPERADMIN_EMAIL", "admin@pipeline.io")
            password = get_dynamic_env("SUPERADMIN_PASSWORD", "admin123")
            
            new_admin = User(
                email=email,
                username="superadmin",
                full_name="System Superadmin",
                password_hash=get_password_hash(password),
                role=UserRole.superadmin,
                status=UserStatus.verified
            )
            db.add(new_admin)
            db.commit()
            print(f"[bootstrap] Superadmin created: {email}\n")
    except Exception as e:
        print(f"[bootstrap] Failed to bootstrap superadmin: {e}")
    finally:
        db.close()

def _bootstrap_credits():
    """Background thread to seed credit balance from OpenRouter on startup."""
    time.sleep(5)  # Wait for server to fully start
    from app.services import credit_service
    credit_service.bootstrap_credits()

@app.on_event("startup")
async def startup_events():
    """Launch recovery in a background thread so it doesn't block startup."""
    recovery_thread = threading.Thread(target=_recover_stuck_tasks, daemon=True)
    recovery_thread.start()
    
    # Bootstrap superadmin
    _bootstrap_superadmin()
    
    # Bootstrap credit balance from OpenRouter
    credits_thread = threading.Thread(target=_bootstrap_credits, daemon=True)
    credits_thread.start()

