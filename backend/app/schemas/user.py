from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID
from app.models.user import UserRole, UserStatus

class UserBase(BaseModel):
    email: str

class UserInvite(UserBase):
    role: UserRole

class UserSignup(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=12)

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=12)

class UserResponse(UserBase):
    id: UUID
    username: Optional[str]
    full_name: Optional[str]
    department: Optional[str]
    role: UserRole
    status: UserStatus
    is_online: bool
    created_at: datetime
    last_active_at: Optional[datetime]

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class EligibilityResponse(BaseModel):
    eligible: bool
