"""Celery tasks for AI extraction (Deepseek). Placeholder for Phase 3."""
from app.celery_app import celery_app


@celery_app.task(bind=True, name="app.tasks.ai_extract.run_ai_extraction")
def run_ai_extraction(self, task_id: str):
    """Send scraped content to Deepseek, parse structured JSON."""
    # TODO: Phase 3 implementation
    return f"AI extraction placeholder for {task_id}"
