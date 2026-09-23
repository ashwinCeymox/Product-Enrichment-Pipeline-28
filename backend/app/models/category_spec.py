import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, JSON

from app.database import Base

def _utcnow():
    return datetime.now(timezone.utc)

class CategorySpec(Base):
    __tablename__ = "category_specs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    category_name = Column(String, nullable=False, unique=True, index=True)
    
    specifications = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    def __repr__(self):
        return f"<CategorySpec {self.category_name}>"
