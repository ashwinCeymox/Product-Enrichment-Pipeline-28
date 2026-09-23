"""Schemas for extracted product approval workflow."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ExtractedProductResponse(BaseModel):
    id: str
    scrape_task_id: str
    uid: Optional[str] = None
    name: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    stock_status: Optional[bool] = None
    attributes: Optional[Dict[str, Any]] = None
    raw_json: Optional[Dict[str, Any]] = None
    schema_version: Optional[str] = None
    approval_status: str = "pending"
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ApprovalListItem(BaseModel):
    """Compact item for the 'Awaiting Approval' left rail list."""
    id: str
    scrape_task_id: str
    task_name: str
    source_url: str
    product_name: Optional[str] = None
    approval_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalDetailResponse(BaseModel):
    """Full payload for the approval detail view (table + JSON)."""
    product: ExtractedProductResponse
    task_name: str
    source_url: str


class ApproveRequest(BaseModel):
    approved_by: Optional[str] = None


class EditProductRequest(BaseModel):
    """Allow editing flattened fields and/or raw_json."""
    uid: Optional[str] = None
    name: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    stock_status: Optional[bool] = None
    attributes: Optional[Dict[str, Any]] = None
    raw_json: Optional[Dict[str, Any]] = None
