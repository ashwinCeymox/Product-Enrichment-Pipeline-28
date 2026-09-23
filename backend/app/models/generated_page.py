"""
GeneratedPage model — stores the assembled HTML product landing page.

Created after JSON + images are both approved. The reviewer can further
edit, then finalize to produce a downloadable ZIP bundle.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, LargeBinary
from sqlalchemy.orm import relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class GeneratedPage(Base):
    __tablename__ = "generated_pages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    extracted_product_id = Column(
        String,
        ForeignKey("extracted_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    bundle_name = Column(String, nullable=False)       # e.g. "JOOLA-Magnus-CAS"
    html_content = Column(Text, nullable=True)          # full generated HTML
    status = Column(String, default="draft")            # draft / active / stable
    finalized_zip = Column(LargeBinary, nullable=True)  # Store the actual zip data

    # ── Timestamps ───────────────────────────────────
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # ── Relationships ────────────────────────────────
    extracted_product = relationship("ExtractedProduct", back_populates="generated_pages")

    def __repr__(self):
        return f"<GeneratedPage {self.bundle_name} [{self.status}]>"
