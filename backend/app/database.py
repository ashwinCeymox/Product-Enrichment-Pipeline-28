"""
Database engine, session factory, and Base declarative class.
Supports both PostgreSQL (production) and SQLite (local dev fallback).
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# ── Load .env from the backend directory ──────────────────────────
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./enrichment.db")

# ── Engine creation ───────────────────────────────────────────────
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )
    # Enable WAL mode for better concurrent read performance on SQLite
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        echo=False,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── Declarative base ─────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── FastAPI dependency ───────────────────────────────────────────
def get_db():
    """Yields a DB session per request, closes it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
