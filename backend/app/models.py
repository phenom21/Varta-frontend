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
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
