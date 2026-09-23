"""Schemas for auth (login, token, user management)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    access_flags: List[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class InviteUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "NORMALUSER"
    access_flags: List[str] = ["create_job", "downloads"]


class UpdateRoleRequest(BaseModel):
    role: str  # SUPERADMIN, ADMIN, or NORMALUSER
    access_flags: Optional[List[str]] = None
