"""Schemas for dashboard stats and activity."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class PendingApprovalBreakdown(BaseModel):
    json_count: int = 0
    image_count: int = 0
    html_count: int = 0


class DashboardStats(BaseModel):
    total_jobs: int = 0
    pending_approvals: int = 0
    approval_breakdown: PendingApprovalBreakdown
    completed: int = 0
    failed: int = 0
    # Optional delta indicators
    total_jobs_delta: Optional[float] = None  # e.g. +12.5%


class RecentActivityItem(BaseModel):
    job_id: str
    task_id: Optional[str] = None
    task_name: str
    source_url: str
    product_name: Optional[str] = None
    priority: Optional[str] = None
    product_type: Optional[str] = None
    status: str
    current_stage: Optional[str] = None
    current_status: Optional[str] = None
    progress: int = 0
    created_at: datetime
    error_message: Optional[str] = None
    generate_ai_images: bool = False

    model_config = {"from_attributes": True}


class RecentActivityResponse(BaseModel):
    items: List[RecentActivityItem]
