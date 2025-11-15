from datetime import datetime
from sqlalchemy import UniqueConstraint, String, Integer, DateTime, func
from sqlalchemy.orm import declarative_base, Mapped, mapped_column


Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String)
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class Transcription(Base):
    __tablename__ = "transcriptions"

    # Use the stored_name from Upload as the primary identifier (file_id)
    file_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    # Optional: link to user for future auth checks
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Paths and metadata
    local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    filename: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[str] = mapped_column(String, default="uploaded", nullable=False)
    status_message: Mapped[str | None] = mapped_column(String, nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    transcript_local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    transcript_json_local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    transcript_vtt_local_path: Mapped[str | None] = mapped_column(String, nullable=True)
    language_code: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Upload(Base):
    __tablename__ = "uploads"
    __table_args__ = (UniqueConstraint("stored_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    original_name: Mapped[str] = mapped_column(String, nullable=False)
    stored_name: Mapped[str] = mapped_column(String, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="completed", nullable=False)
    duration: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
