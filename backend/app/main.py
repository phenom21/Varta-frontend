import os
import re
import time
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from dotenv import load_dotenv
from typing import List

from .database import init_db, get_session
from .models import User, Upload
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
        user = User(
            email=norm_email,
            hashed_password=get_password_hash(payload.password),
            full_name=payload.full_name,
        )
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

    # Enforce video-only uploads
    allowed_exts = {"mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv"}
    is_video_ct = (file.content_type or "").startswith("video/")
    ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
    if not (is_video_ct or ext in allowed_exts):
        raise HTTPException(status_code=400, detail="Only video files are allowed")

    # Stream to disk
    with dest_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    # Persist metadata in DB
    size = dest_path.stat().st_size
    with get_session() as session:
        up = Upload(
            user_id=user.id,
            original_name=safe_name,
            stored_name=dest_name,
            size=size,
            content_type=file.content_type,
            status="completed",
            duration=None,
        )
        session.add(up)
        session.commit()

    return {
        "filename": safe_name,
        "content_type": file.content_type,
        "uploaded_by": user.id,
        "path": str(dest_path.resolve()),
    }


@app.get("/files")
def list_files(user: User = Depends(get_current_user)):
    # DB-only listing
    with get_session() as session:
        rows = session.query(Upload).filter(Upload.user_id == user.id).order_by(Upload.created_at.desc()).all()
        items = []
        for r in rows:
            items.append({
                "id": r.stored_name,
                "name": r.original_name,
                "size": r.size,
                "uploaded_at": (r.created_at.isoformat() if getattr(r, "created_at", None) else None),
                "status": r.status,
                "duration": r.duration,
            })
        return items


@app.get("/files/{file_id}")
def get_file_details(file_id: str, user: User = Depends(get_current_user)):
    # DB-only details
    with get_session() as session:
        row = session.query(Upload).filter(Upload.stored_name == os.path.basename(file_id), Upload.user_id == user.id).first()
        if not row:
            raise HTTPException(status_code=404, detail="File not found")
        original = row.original_name
        ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
        kind = "video" if ext in {"mp4","mov","avi","mkv","webm","m4v","wmv","flv"} else ("image" if ext in {"png","jpg","jpeg","gif","webp","bmp","tiff","svg"} else "file")
        return {
            "id": row.stored_name,
            "name": original,
            "size": row.size,
            "uploaded_at": row.created_at.isoformat() if getattr(row, "created_at", None) else None,
            "status": row.status,
            "duration": row.duration,
            "kind": kind,
        }


@app.get("/files/{file_id}/content")
def get_file_content(file_id: str, user: User = Depends(get_current_user)):
    """Authenticated streaming of the original uploaded file."""
    uploads_dir = Path("uploads")
    p = uploads_dir / os.path.basename(file_id)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    parts = p.name.split("_", 2)
    if len(parts) < 3 or not parts[0].isdigit() or int(parts[0]) != user.id:
        raise HTTPException(status_code=404, detail="File not found")

    original = parts[2]
    # Guess media type by extension (best-effort)
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    media = {
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "mkv": "video/x-matroska",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
        "svg": "image/svg+xml",
    }.get(ext, "application/octet-stream")

    return FileResponse(str(p.resolve()), media_type=media, filename=original)


@app.get("/files/{file_id}/download")
def download_file(file_id: str, user: User = Depends(get_current_user)):
    """Force download with original filename."""
    uploads_dir = Path("uploads")
    p = uploads_dir / os.path.basename(file_id)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    parts = p.name.split("_", 2)
    if len(parts) < 3 or not parts[0].isdigit() or int(parts[0]) != user.id:
        raise HTTPException(status_code=404, detail="File not found")

    original = parts[2]
    return FileResponse(str(p.resolve()), media_type="application/octet-stream", filename=original)
