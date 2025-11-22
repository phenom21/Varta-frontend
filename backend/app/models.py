from datetime import datetime
from sqlalchemy import UniqueConstraint, String, Integer, DateTime, func, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, Mapped, mapped_column, relationship


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


class File(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    s3_original_key: Mapped[str | None] = mapped_column(String, nullable=True)
    s3_transcript_key: Mapped[str | None] = mapped_column(String, nullable=True)
    s3_final_key: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="uploaded", nullable=False)
    progress: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    segments: Mapped[list["Segment"]] = relationship("Segment", back_populates="file", cascade="all, delete-orphan")


class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(String, ForeignKey("files.id"), index=True)
    speaker_label: Mapped[str] = mapped_column(String)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    original_text: Mapped[str | None] = mapped_column(String, nullable=True)
    translated_text: Mapped[str | None] = mapped_column(String, nullable=True)
    word_timestamps: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    overlap: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # TTS fields
    tts_path: Mapped[str | None] = mapped_column(String, nullable=True)
    tts_status: Mapped[str] = mapped_column(String, default="pending", nullable=False)
    tts_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tts_provider_meta: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    tts_error_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    tts_cache_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    file: Mapped[File] = relationship("File", back_populates="segments")
