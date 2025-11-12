from datetime import datetime
from typing import Annotated, Optional
from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator


FullName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=80,
        pattern=r"^[A-Za-z][A-Za-z .'-]+$",
    ),
]


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: Optional[FullName] = None

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        # collapse repeated whitespace
        v = " ".join(v.split())
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
