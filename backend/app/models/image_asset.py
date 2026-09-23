"""
ImageAsset model — stores generated images per product.

Each asset belongs to a variation_group (e.g. "hero_banner", "feature_shot_1").
Multiple variations are generated per group; the reviewer picks one to approve.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class ImageAsset(Base):
    __tablename__ = "image_assets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    scrape_task_id = Column(
        String,
        ForeignKey("scrape_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    asset_name = Column(String, nullable=False)       # e.g. "Hero-Banner-Main.png"
    storage_path = Column(Text, nullable=True)         # local path or cloud URL
    prompt_text = Column(Text, nullable=True)          # prompt used for generation
    variation_group = Column(String, nullable=False)   # e.g. "hero_banner", "feature_shot_1"

    # ── Approval ─────────────────────────────────────
    status = Column(String, default="pending")          # pending / approved / rejected
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # ── Timestamps ───────────────────────────────────
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    # ── Relationships ────────────────────────────────
    scrape_task = relationship("ScrapeTask", back_populates="image_assets")

    def __repr__(self):
        return f"<ImageAsset {self.asset_name} [{self.status}]>"
