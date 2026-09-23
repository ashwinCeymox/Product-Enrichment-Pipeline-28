from sqlalchemy import Column, String, DateTime, Enum, text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
import datetime
import enum

class UserRole(str, enum.Enum):
    user = "user"
    admin = "admin"
    superadmin = "superadmin"

class UserStatus(str, enum.Enum):
    pending = "pending"
    verified = "verified"
    removed = "removed"

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, nullable=True)
    password_hash = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    department = Column(String, nullable=True)
    
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False)
    status = Column(Enum(UserStatus), default=UserStatus.pending, nullable=False)
    is_online = Column(Boolean, default=False, nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)
    last_active_at = Column(DateTime(timezone=True), nullable=True)
