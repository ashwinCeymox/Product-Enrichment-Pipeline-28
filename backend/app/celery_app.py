"""
Celery application factory.

Usage:
    celery -A app.celery_app worker --loglevel=info
    celery -A app.celery_app beat --loglevel=info
"""
import os
from dotenv import load_dotenv
from celery import Celery
from celery.schedules import crontab

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "enrichment_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_default_queue="enrichment_queue",
    task_create_missing_queues=True,
    # Auto-discover tasks in app/tasks/
    imports=["app.tasks.scrape", "app.tasks.ai_extract", "app.tasks.gen_images", "app.tasks.gen_html"],
    # Beat schedule — check for due scheduled jobs every 60 seconds
    beat_schedule={
        "dispatch-scheduled-jobs": {
            "task": "app.tasks.scrape.dispatch_scheduled_jobs",
            "schedule": 60.0,  # every 60 seconds
        },
    },
)
