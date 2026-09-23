"""
SystemConfig model — encrypted key-value store for API credentials and settings.

Keys like "deepseek_api_key", "nano_banana_bearer_token", "serper_api_key"
are stored with their values encrypted at rest via Fernet symmetric encryption.
"""
import os
import uuid
from datetime import datetime, timezone

from cryptography.fernet import Fernet
from sqlalchemy import Column, DateTime, String

from app.database import Base

# ── Encryption key (generate once, store in .env for production) ──
# For dev, we derive a key from SECRET_KEY; for production, use a dedicated FERNET_KEY
_secret = os.getenv("SECRET_KEY", "dev-fallback-key-change-me")
# Fernet requires a 32-byte URL-safe base64-encoded key; we derive one deterministically
import hashlib
import base64
_derived = hashlib.sha256(_secret.encode()).digest()
_fernet_key = base64.urlsafe_b64encode(_derived)
_fernet = Fernet(_fernet_key)


def _utcnow():
    return datetime.now(timezone.utc)


class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    key = Column(String, nullable=False, unique=True, index=True)
    # e.g. "deepseek_api_key", "nano_banana_bearer_token", "serper_api_key"
    value = Column(String, nullable=True)      # stored encrypted
    status = Column(String, default="standby")  # active / standby
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    updated_by = Column(String, nullable=True)

    # ── Encrypt / decrypt helpers ────────────────────
    def set_value(self, plaintext: str):
        """Encrypt and store the value."""
        self.value = _fernet.encrypt(plaintext.encode()).decode()

    def get_value(self) -> str:
        """Decrypt and return the value."""
        if not self.value:
            return ""
        try:
            return _fernet.decrypt(self.value.encode()).decode()
        except Exception:
            return ""  # Return empty if decryption fails (key rotated, etc.)

    def get_masked(self) -> str:
        """Return a masked version for display (first 4 + last 4 chars)."""
        plain = self.get_value()
        if len(plain) <= 8:
            return "•" * len(plain)
        return plain[:4] + "•" * (len(plain) - 8) + plain[-4:]

    def __repr__(self):
        return f"<SystemConfig {self.key} [{self.status}]>"
