"""
ExtractedProduct model — one row per product, child of ScrapeTask.

Stores both the flattened product fields (for table view) and the full
raw_json payload (for JSON view / code editor).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, JSON,
    Numeric, String, Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class ExtractedProduct(Base):
    __tablename__ = "extracted_products"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    scrape_task_id = Column(String, ForeignKey("scrape_tasks.id", ondelete="CASCADE"), nullable=False, index=True)

    # ── Flattened product fields (for Table View) ────
    uid = Column(String, nullable=True)                   # e.g. PRD_001
    name = Column(String, nullable=True)
    price = Column(Numeric(10, 2), nullable=True)
    currency = Column(String(10), nullable=True, default="USD")
    stock_status = Column(Boolean, nullable=True, default=True)
    attributes = Column(JSON, nullable=True)               # {color, material, warranty, ...}

    # ── Full AI payload (for JSON View) ──────────────
    raw_json = Column(JSON, nullable=True)                 # complete AI-extracted payload
    schema_version = Column(String(20), nullable=True, default="v2.4")

    # ── Approval workflow ────────────────────────────
    approval_status = Column(String, default="pending")    # pending / approved / rescrape_requested
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # ── Timestamps ───────────────────────────────────
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # ── Relationships ────────────────────────────────
    scrape_task = relationship("ScrapeTask", back_populates="extracted_products")
    generated_pages = relationship("GeneratedPage", back_populates="extracted_product", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ExtractedProduct {self.uid or self.id[:8]} — {self.name}>"
