"""Schemas for system configuration and health checks."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel


class CredentialStatus(BaseModel):
    key: str
    masked_value: str
    status: str  # active / standby
    updated_at: Optional[datetime] = None


class ConfigResponse(BaseModel):
    credentials: list[CredentialStatus]


class UpdateCredentialRequest(BaseModel):
    key: str
    value: str


class UpdateConfigRequest(BaseModel):
    credentials: list[UpdateCredentialRequest]


class HealthResponse(BaseModel):
    database: str = "unknown"    # UP / DOWN
    redis: str = "unknown"       # UP / DOWN
    celery_beat: str = "unknown" # POLLING / STOPPED
