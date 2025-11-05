import os
import re
import time
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from dotenv import load_dotenv
from typing import List

from .database import init_db, get_session
from .models import User
from .schemas import SignupRequest, LoginRequest, UserRead, Token
from .auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    is_strong_password,
)

load_dotenv()

app = FastAPI(title="Varta API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    Path("uploads").mkdir(exist_ok=True)


@app.post("/signup", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest):
    if not is_strong_password(payload.password):
        raise HTTPException(status_code=400, detail="Password not strong enough")

    with get_session() as session:
        norm_email = payload.email.lower()
        stmt = select(User).where(User.email == norm_email)
        exists = session.execute(stmt).scalar_one_or_none()
        if exists:
            raise HTTPException(status_code=400, detail="Email already exists")
        user = User(email=norm_email, hashed_password=get_password_hash(payload.password))
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


@app.post("/login", response_model=Token)
def login(payload: LoginRequest):
    with get_session() as session:
        norm_email = payload.email.lower()
        stmt = select(User).where(User.email == norm_email)
        user = session.execute(stmt).scalar_one_or_none()
        if not user or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        token = create_access_token(
            subject=str(user.id),
            expires_delta=timedelta(minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))),
        )
        return {"access_token": token, "token_type": "bearer"}


# Optional support for OAuth2 password flow at /login (form-encoded)
@app.post("/token", response_model=Token, include_in_schema=False)
def token(form_data: OAuth2PasswordRequestForm = Depends()):
    with get_session() as session:
        norm_email = (form_data.username or "").lower()
        stmt = select(User).where(User.email == norm_email)
        user = session.execute(stmt).scalar_one_or_none()
        if not user or not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        token = create_access_token(subject=str(user.id))
        return {"access_token": token, "token_type": "bearer"}


def sanitize_filename(name: str) -> str:
    name = os.path.basename(name or "upload")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name


@app.post("/upload")
async def upload(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)

    safe_name = sanitize_filename(file.filename)
    ts = int(time.time())
    dest_name = f"{user.id}_{ts}_{safe_name}"
    dest_path = uploads_dir / dest_name

    # Stream to disk
    with dest_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    return {
        "filename": safe_name,
        "content_type": file.content_type,
        "uploaded_by": user.id,
        "path": str(dest_path.resolve()),
    }


@app.get("/files")
def list_files(user: User = Depends(get_current_user)):
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)
    items = []
    for p in uploads_dir.iterdir():
        if not p.is_file():
            continue
        # Only list files uploaded by this user for privacy
        name = p.name
        parts = name.split("_", 2)
        if len(parts) >= 2 and parts[0].isdigit() and int(parts[0]) == user.id:
            items.append({
                "name": name,
                "size": p.stat().st_size,
                "path": str(p.resolve()),
            })
    return {"files": items}
