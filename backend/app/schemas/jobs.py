"""
Pydantic schemas for job creation, listing, and batch operations.
Merged from backend/models/schemas.py and fastapi endpoints/job_structure/models/product.py.
"""
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator


# ── Enums ─────────────────────────────────────────────────────────
class PriorityEnum(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class StatusEnum(str, Enum):
    pending = "pending"
    queued = "queued"
    processing = "processing"
    scraping = "scraping"
    ai_processing = "ai_processing"
    waiting_for_approval = "waiting_for_approval"
    success = "success"
    failed = "failed"


# ── Request schemas ───────────────────────────────────────────────
class _SubmitBase(BaseModel):
    priority: Optional[PriorityEnum] = PriorityEnum.low
    task_name: str = Field(..., max_length=255)
    scheduled_date: Optional[date] = None
    created_by: Optional[str] = Field(None, max_length=255)
    product_type: str = "simple"
    generate_ai_images: bool = False


class SingleURLRequest(_SubmitBase):
    url: HttpUrl

    model_config = {"json_schema_extra": {
        "example": {
            "url": "https://joola.com/products/example",
            "task_name": "Daily Data Sync",
            "priority": "high",
            "created_by": "admin",
        }
    }}


class MultiURLRequest(_SubmitBase):
    urls: List[HttpUrl] = Field(..., min_length=1, max_length=500)

    @field_validator("urls")
    @classmethod
    def deduplicate_urls(cls, v: List[HttpUrl]) -> List[HttpUrl]:
        seen = set()
        unique: List[HttpUrl] = []
        for url in v:
            key = str(url)
            if key not in seen:
                seen.add(key)
                unique.append(url)
        return unique


# ── Response schemas ──────────────────────────────────────────────
class JobResponse(BaseModel):
    id: str
    batch_id: str
    priority: Optional[str] = None
    celery_task_id: Optional[str] = None
    task_name: str
    url: str
    status: str
    progress: int = 0
    scheduled_date: Optional[date] = None
    source_data: Optional[Dict[str, Any]] = None
    product_data: Optional[Dict[str, Any]] = None
    generate_ai_images: bool = False
    raw_html: Optional[str] = None
    result_zip_file: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BatchSubmitResponse(BaseModel):
    batch_id: str
    task_name: str
    total_urls: int
    submitted: int
    skipped: int
    skipped_urls: List[str] = []
    jobs: List[JobResponse]
    message: str


class JobListResponse(BaseModel):
    total: int
    remaining: int = 0
    pending: int = 0
    processing: int = 0
    completed: int = 0
    failed: int = 0
    jobs: List[JobResponse]


class TaskPercentage(BaseModel):
    task_name: str
    percentage: float
    remaining_count: int


class ApprovalRequest(BaseModel):
    product_data: Optional[dict] = None


class TaskStatus(BaseModel):
    task_name: str
    completed_percentage: int = 0
    status: str
