"""
ScrapeTask model — the core queue table, one row per URL.

Merged from:
  - backend/models/job.py (simple version)
  - fastapi endpoints/job_structure/database/database.py (richer version with batch_id, task_name, etc.)

Status flow: pending → queued → processing → scraping → ai_processing
             → waiting_for_approval → success | failed
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, Integer, JSON, LargeBinary,
    String, Text, Date, Boolean,
)
from sqlalchemy.orm import relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class ScrapeTask(Base):
    __tablename__ = "scrape_tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    batch_id = Column(String, nullable=False, index=True)
    priority = Column(String, default="low")  # low / medium / high
    celery_task_id = Column(String, nullable=True)
    task_name = Column(String, nullable=False, index=True)
    url = Column(String, nullable=False)
    product_type = Column(String, default="simple")
    category_override = Column(String, nullable=True)  # Manual category override set by user on reschedule
    status = Column(String, nullable=False, default="pending", index=True)
    # Status values: pending, queued, processing, scraping, ai_processing,
    #                waiting_for_approval, success, failed
    progress = Column(Integer, default=0)  # 0–100
    scheduled_date = Column(Date, nullable=True, index=True)
    generate_ai_images = Column(Boolean, default=False)
    text_model_override = Column(String, nullable=True)

    # Results
    source_data = Column(JSON, nullable=True)       # Stores structured factual snapshot before enrichment
    product_data = Column(JSON, nullable=True)      # Stores extracted AI JSON
    raw_html = Column(Text, nullable=True)          # Stores compressed HTML source
    result_zip_file = Column(JSON, nullable=True)   # e.g. {"url": "/static/file.zip", "size": "2.1 MB"}
    result_data = Column(LargeBinary, nullable=True)  # raw bytes if needed
    activity_log = Column(JSON, default=list)          # [{timestamp, action, detail}, ...]
    error_message = Column(Text, nullable=True)

    # Audit
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # ── Relationships ────────────────────────────────
    extracted_products = relationship(
        "ExtractedProduct", back_populates="scrape_task", cascade="all, delete-orphan"
    )
    image_assets = relationship(
        "ImageAsset", back_populates="scrape_task", cascade="all, delete-orphan"
    )

    def append_activity(self, action: str, detail: str = ""):
        """Append a timestamped entry to the activity log."""
        log = list(self.activity_log or [])
        log.append({
            "timestamp": _utcnow().isoformat(),
            "action": action,
            "detail": detail,
        })
        self.activity_log = log

    def __repr__(self):
        return f"<ScrapeTask {self.id[:8]}… {self.task_name} [{self.status}]>"
