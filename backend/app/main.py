import os
import re
import time
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, text
from dotenv import load_dotenv
from typing import List
import redis
import asyncio
import json

from .database import init_db, get_session
from .models import User, Upload, Transcription
from .schemas import SignupRequest, LoginRequest, UserRead, Token
from .auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    is_strong_password,
)
from .tasks import enqueue_transcription

load_dotenv()

# Roots and config
PROJECT_ROOT = Path(__file__).resolve().parents[2]
UPLOADS_ROOT = Path(os.getenv("UPLOADS_ROOT", str(PROJECT_ROOT / "uploads")))
TRANSCRIPTS_ROOT = Path(os.getenv("TRANSCRIPTS_ROOT", str(PROJECT_ROOT / "transcripts")))
TMP_ROOT = Path(os.getenv("TMP_ROOT", str(PROJECT_ROOT / "tmp")))

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
    UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_ROOT.mkdir(parents=True, exist_ok=True)
    TMP_ROOT.mkdir(parents=True, exist_ok=True)


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
async def upload(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    user: User = Depends(get_current_user),
):
    safe_name = sanitize_filename(file.filename)
    ts = int(time.time())
    dest_name = f"{user.id}_{ts}_{safe_name}"
    dest_path = UPLOADS_ROOT / dest_name

    # Enforce video-only uploads
    allowed_exts = {"mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv"}
    is_video_ct = (file.content_type or "").startswith("video/")
    ext = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
    if not (is_video_ct or ext in allowed_exts):
        raise HTTPException(status_code=400, detail="Only video files are allowed")

    # Stream to disk
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with dest_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    # Persist metadata in DB and create Transcription row
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
        # Create/overwrite transcription tracking row
        tr = session.get(Transcription, dest_name)
        if not tr:
            tr = Transcription(
                file_id=dest_name,
                user_id=user.id,
                local_path=str(dest_path.resolve()),
                filename=safe_name,
                status="uploaded",
                progress=0,
            )
            session.add(tr)
        else:
            tr.user_id = user.id
            tr.local_path = str(dest_path.resolve())
            tr.filename = safe_name
            tr.status = "uploaded"
            tr.progress = 0
            tr.status_message = None
        # persist requested language code (e.g., 'en', 'hi') if provided
        if language:
            tr.language_code = language
        session.commit()

    # Enqueue background job
    try:
        enqueue_transcription(dest_name, language)
    except Exception as e:
        # If enqueue fails, reflect it in tracking row
        with get_session() as session:
            tr2 = session.get(Transcription, dest_name)
            if tr2:
                tr2.status = "failed"
                tr2.status_message = f"Enqueue failed: {str(e)[:256]}"
                session.commit()
        raise

    return {"file_id": dest_name}


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


@app.get("/status/{file_id}")
def get_status(file_id: str, user: User = Depends(get_current_user)):
    file_id = os.path.basename(file_id)
    with get_session() as session:
        tr = session.get(Transcription, file_id)
        if not tr:
            raise HTTPException(status_code=404, detail="File not found")
        if tr.user_id is not None and tr.user_id != user.id:
            raise HTTPException(status_code=404, detail="File not found")
        # Optionally enrich with worker timings from generic 'files' table
        timings = None
        try:
            res = session.execute(text("SELECT progress FROM files WHERE id = :fid"), {"fid": file_id}).first()
            if res and res[0]:
                progress = res[0]
                if isinstance(progress, str):
                    try:
                        progress = json.loads(progress)
                    except Exception:
                        progress = None
                if isinstance(progress, dict):
                    timings = progress.get("timings")
        except Exception:
            pass

        data = {
            "file_id": tr.file_id,
            "status": tr.status,
            "status_message": tr.status_message,
            "progress": tr.progress,
            "duration_seconds": tr.duration_seconds,
            "processing_time_seconds": (int((tr.updated_at - tr.created_at).total_seconds()) if getattr(tr, "updated_at", None) and getattr(tr, "created_at", None) else None),
            "transcript_txt": f"/download/transcript/{tr.file_id}?fmt=txt" if tr.transcript_local_path else None,
            "transcript_json": f"/download/transcript/{tr.file_id}?fmt=json" if tr.transcript_json_local_path else None,
            "transcript_vtt": f"/download/transcript/{tr.file_id}?fmt=vtt" if tr.transcript_vtt_local_path else None,
            "timings": timings,
            "total_processing_seconds": (timings.get("total_seconds") if isinstance(timings, dict) else None),
        }
        return JSONResponse(content=data)


@app.get("/status/stream/{file_id}")
async def stream_status(file_id: str, user: User = Depends(get_current_user)):
    file_id = os.path.basename(file_id)

    async def event_gen():
        last_progress = None
        last_status = None
        r = redis.from_url(os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"))
        channel = f"progress:{file_id}"
        pubsub = r.pubsub()
        pubsub.subscribe(channel)
        last_db_fallback_ts = 0.0

        # Helper to build payload from DB (fallback)
        def build_payload_from_db():
            with get_session() as session:
                t = session.get(Transcription, file_id)
                if not t:
                    return {"status": "missing", "progress": 0}
                # ownership enforcement when row exists
                if t.user_id is not None and t.user_id != user.id:
                    return None  # signal to stop
                timings = None
                try:
                    res = session.execute(text("SELECT progress FROM files WHERE id = :fid"), {"fid": file_id}).first()
                    if res and res[0]:
                        progress = res[0]
                        if isinstance(progress, str):
                            try:
                                progress = json.loads(progress)
                            except Exception:
                                progress = None
                        if isinstance(progress, dict):
                            timings = progress.get("timings")
                except Exception:
                    pass
                return {
                    "file_id": t.file_id,
                    "status": t.status,
                    "status_message": t.status_message,
                    "progress": t.progress,
                    "duration_seconds": t.duration_seconds,
                    "processing_time_seconds": (int((t.updated_at - t.created_at).total_seconds()) if getattr(t, "updated_at", None) and getattr(t, "created_at", None) else None),
                    "transcript_txt": f"/download/transcript/{t.file_id}?fmt=txt" if t.transcript_local_path else None,
                    "transcript_json": f"/download/transcript/{t.file_id}?fmt=json" if t.transcript_json_local_path else None,
                    "transcript_vtt": f"/download/transcript/{t.file_id}?fmt=vtt" if t.transcript_vtt_local_path else None,
                    "timings": timings,
                    "total_processing_seconds": (timings.get("total_seconds") if isinstance(timings, dict) else None),
                }

        # Emit initial state from DB
        init_payload = build_payload_from_db()
        if init_payload is None:
            return  # ownership mismatch
        yield f"data: {json.dumps(init_payload)}\n\n"
        last_progress = init_payload.get("progress")
        last_status = init_payload.get("status")

        while True:
            try:
                # Prefer real-time events from Redis Pub/Sub
                msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                payload = None
                if msg and msg.get("type") == "message":
                    # On any progress signal, rebuild payload from DB to keep a consistent schema
                    payload = build_payload_from_db()
                    if payload is None:
                        break  # ownership mismatch

                # Fallback to DB read only every 10s when Pub/Sub is silent
                if payload is None:
                    now = time.time()
                    if (now - last_db_fallback_ts) >= 10.0:
                        payload = build_payload_from_db()
                        if payload is None:
                            break  # ownership mismatch
                        last_db_fallback_ts = now
                    else:
                        # Skip DB read this iteration
                        await asyncio.sleep(0.2)
                        continue

                # Only emit when changed
                if payload.get("progress") != last_progress or payload.get("status") != last_status:
                    last_progress = payload.get("progress")
                    last_status = payload.get("status")
                    yield f"data: {json.dumps(payload)}\n\n"
                # If terminal, emit one last time and break
                if payload.get("status") in {"transcribed", "failed"}:
                    # Ensure client receives the final state even if it wasn't a change-detected emission
                    try:
                        yield f"data: {json.dumps(payload)}\n\n"
                    except Exception:
                        pass
                    await asyncio.sleep(0.2)
                    break
                # Small pause to avoid tight loop when idle
                await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                break
    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.get("/download/transcript/{file_id}")
def download_transcript(file_id: str, fmt: str = "txt", user: User = Depends(get_current_user)):
    file_id = os.path.basename(file_id)
    with get_session() as session:
        tr = session.get(Transcription, file_id)
        if not tr:
            raise HTTPException(status_code=404, detail="File not found")
        if tr.user_id is not None and tr.user_id != user.id:
            raise HTTPException(status_code=404, detail="File not found")
        path_map = {
            "txt": tr.transcript_local_path,
            "json": tr.transcript_json_local_path,
            "vtt": tr.transcript_vtt_local_path,
        }
        target = path_map.get(fmt)
        if not target or not Path(target).exists():
            raise HTTPException(status_code=404, detail="Transcript not available")
        media = {
            "txt": "text/plain",
            "json": "application/json",
            "vtt": "text/vtt",
        }.get(fmt, "application/octet-stream")
        return FileResponse(path=target, media_type=media, filename=Path(target).name)


@app.get("/files/{file_id}/content")
def get_file_content(file_id: str, user: User = Depends(get_current_user)):
    """Authenticated streaming of the original uploaded file."""
    p = UPLOADS_ROOT / os.path.basename(file_id)
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


@app.get("/files/{file_id}/timeline")
def get_timeline(file_id: str, user: User = Depends(get_current_user)):
    """Return diarization/alignment timeline JSON if present in 'files.progress'.
    This reads from the generic 'files' table used by the diarization worker.
    """
    file_id = os.path.basename(file_id)
    # Ownership check via Uploads table
    with get_session() as session:
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        # Read raw progress JSON from files table (may not exist yet)
        try:
            res = session.execute(text("SELECT progress FROM files WHERE id = :fid"), {"fid": file_id}).first()
        except Exception:
            res = None
        if not res or not res[0]:
            raise HTTPException(status_code=404, detail="Timeline not available")
        progress = res[0]
        if isinstance(progress, str):
            try:
                progress = json.loads(progress)
            except Exception:
                progress = None
        timeline = progress.get("timeline") if isinstance(progress, dict) else None
        if not timeline:
            raise HTTPException(status_code=404, detail="Timeline not available")
        return JSONResponse(content=timeline)


@app.get("/download/final/{file_id}")
def download_final(file_id: str, user: User = Depends(get_current_user)):
    """Download final diarization-alignment timeline JSON as an attachment."""
    file_id = os.path.basename(file_id)
    with get_session() as session:
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        try:
            res = session.execute(text("SELECT progress FROM files WHERE id = :fid"), {"fid": file_id}).first()
        except Exception:
            res = None
        if not res or not res[0]:
            raise HTTPException(status_code=404, detail="Final output not available")
        progress = res[0]
        if isinstance(progress, str):
            try:
                progress = json.loads(progress)
            except Exception:
                progress = None
        if not isinstance(progress, dict) or not progress.get("timeline"):
            raise HTTPException(status_code=404, detail="Final output not available")
        payload = progress["timeline"]
        headers = {"Content-Disposition": f"attachment; filename=final_{file_id}.json"}
        return JSONResponse(content=payload, headers=headers, media_type="application/json")
