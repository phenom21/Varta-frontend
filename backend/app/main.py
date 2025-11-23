import os
import re
import time
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, text
from dotenv import load_dotenv
from typing import List
import redis
import asyncio
import json

from .database import init_db, get_session
from .models import User, Upload, Transcription, File as FileModel, Segment
from .schemas import SignupRequest, LoginRequest, UserRead, Token
from .auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    is_strong_password,
)
from .tasks import enqueue_transcription, enqueue_tts_synthesis, enqueue_translation, enqueue_per_segment_tts, enqueue_stitch
from pydantic import BaseModel
from .core.config import MEDIA_ROOT

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
    target_lang: str | None = Form(None),  # Target language for auto-translation
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

        # Store target_lang in File.progress for auto-translation
        print(f"[Upload] Received target_lang: {target_lang}")
        f = session.get(FileModel, dest_name)
        if not f:
            f = FileModel(id=dest_name, status="uploaded", progress={})
            session.add(f)
        if not f.progress:
            f.progress = {}
        if isinstance(f.progress, dict) and target_lang:
            f.progress["auto_translate"] = {"target_lang": target_lang}
            print(f"[Upload] Stored auto_translate in File.progress: {f.progress}")
        session.commit()

    # Enqueue transcription job
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
        # Also fetch status from File table (tracks translation/TTS status)
        file_row = session.get(FileModel, os.path.basename(file_id))
        file_status = file_row.status if file_row else row.status
        file_progress = file_row.progress if file_row else None
        
        return {
            "id": row.stored_name,
            "name": original,
            "size": row.size,
            "uploaded_at": row.created_at.isoformat() if getattr(row, "created_at", None) else None,
            "status": file_status,  # Use File table status (translation/TTS aware)
            "duration": row.duration,
            "kind": kind,
            "progress": file_progress,  # Include progress data
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
            "timings": timings,
            "translate": progress.get("translate") if isinstance(progress, dict) else None,
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
                    "timings": timings,
                    "translate": progress.get("translate") if isinstance(progress, dict) else None,
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
        }
        target = path_map.get(fmt)
        if not target or not Path(target).exists():
            raise HTTPException(status_code=404, detail="Transcript not available")
        media = {
            "txt": "text/plain",
            "json": "application/json",
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


@app.get("/files/{file_id}/speakers")
def list_speakers(file_id: str, user: User = Depends(get_current_user)):
    """Inspect speakers for a given file, including sample/clone readiness.
    This reads from the 'speakers' table produced by the diarization/alignment workers.
    """
    file_id = os.path.basename(file_id)
    with get_session() as session:
        # Ownership check via Uploads table
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")

        # Query speakers without defining a duplicate ORM model
        try:
            rows = session.execute(
                text(
                    """
                    SELECT id, speaker_label, display_name, sample_status, sample_path, sample_quality, clone_state
                    FROM speakers
                    WHERE file_id = :fid
                    ORDER BY speaker_label
                    """
                ),
                {"fid": file_id},
            ).fetchall()
        except Exception:
            raise HTTPException(status_code=404, detail="Speakers not available")

        speakers = []
        for r in rows:
            sid, label, display_name, sample_status, sample_path, sample_quality, clone_state = r
            speakers.append(
                {
                    "id": sid,
                    "speaker_label": label,
                    "display_name": display_name,
                    "sample_status": sample_status,
                    "sample_path": sample_path,
                    "sample_quality": sample_quality,
                    "clone_state": clone_state,
                }
            )
        return {"file_id": file_id, "speakers": speakers}


@app.get("/files/{file_id}/speakers/{speaker_label}/sample")
def download_speaker_sample(file_id: str, speaker_label: str, user: User = Depends(get_current_user)):
    """Stream/download the auto-sampled WAV for a speaker (debugging)."""
    file_id = os.path.basename(file_id)
    speaker_label = os.path.basename(speaker_label)
    with get_session() as session:
        # Ownership check via Uploads table
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        try:
            row = session.execute(
                text("SELECT sample_path FROM speakers WHERE file_id = :fid AND speaker_label = :spk"),
                {"fid": file_id, "spk": speaker_label},
            ).first()
        except Exception:
            row = None
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="Sample not available")
        rel = row[0]
        abs_path = (MEDIA_ROOT / rel)
        if not abs_path.exists():
            raise HTTPException(status_code=404, detail="Sample not found on disk")
        return FileResponse(str(abs_path.resolve()), media_type="audio/wav", filename=f"{speaker_label}_auto_sample.wav")


@app.post("/files/{file_id}/speakers/{speaker_label}/tts")
def request_tts(file_id: str, speaker_label: str, text: str = Form("This is a test line."), user: User = Depends(get_current_user)):
    """Enqueue a short TTS synthesis for a prepared speaker. Returns job id.
    Use the GET endpoint below to stream the resulting WAV when ready.
    """
    file_id = os.path.basename(file_id)
    speaker_label = os.path.basename(speaker_label)
    # Ownership check via Uploads table
    with get_session() as session:
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
    job = enqueue_tts_synthesis(file_id, speaker_label, text)
    return {"job_id": job.id}


@app.get("/files/{file_id}/speakers/{speaker_label}/tts.wav")
def stream_tts(file_id: str, speaker_label: str, user: User = Depends(get_current_user)):
    """Stream the last synthesized TTS test WAV for the given speaker if present."""
    file_id = os.path.basename(file_id)
    speaker_label = os.path.basename(speaker_label)
    with get_session() as session:
        # Ownership check via Uploads table
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
    # Prefer new path: {UPLOADS_ROOT}/tts/{file_id}/speakers/{speaker_label}/tts_test.wav
    candidate_paths = [
        UPLOADS_ROOT / "tts" / file_id / "speakers" / speaker_label / "tts_test.wav",
        # Fallback to legacy path
        UPLOADS_ROOT / file_id / "speakers" / speaker_label / "tts_test.wav",
    ]
    out_path = next((p for p in candidate_paths if p.exists()), None)
    if not out_path:
        raise HTTPException(status_code=404, detail="TTS not available yet")
    return FileResponse(str(out_path.resolve()), media_type="audio/wav", filename=f"{speaker_label}_tts_test.wav")


class TranslateRequest(BaseModel):
    target_lang: str
    force: bool = False


@app.post("/files/{file_id}/translate")
def request_translation(file_id: str, payload: TranslateRequest, user: User = Depends(get_current_user)):
    file_id = os.path.basename(file_id)
    with get_session() as session:
        # Check ownership
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check status
        f = session.get(FileModel, file_id)
        # Allow if diarized, transcribed, or already translated (re-run)
        if not f or f.status not in {"diarized", "transcribed", "translated", "voices_clone_ready", "error"}:
             raise HTTPException(status_code=400, detail="File not ready for translation (must be diarized/transcribed)")

        # Update status
        f.status = "translating"
        # Initialize progress if needed, or keep existing
        if not f.progress:
            f.progress = {}
        if isinstance(f.progress, dict):
            # Mark translation as processing so the UI can show a spinner immediately
            f.progress["translate"] = {"status": "processing", "target_lang": payload.target_lang}
        session.add(f)
        session.commit()

    job = enqueue_translation(file_id, payload.target_lang, payload.force)
    return {"file_id": file_id, "job_id": job.id, "status": "queued"}


@app.get("/files/{file_id}/segments")
def list_segments(file_id: str, user: User = Depends(get_current_user)):
    file_id = os.path.basename(file_id)
    with get_session() as session:
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        
        segments = session.query(Segment).filter(Segment.file_id == file_id).order_by(Segment.start_ms).all()
        return [
            {
                "id": s.id,
                "start_ms": s.start_ms,
                "end_ms": s.end_ms,
                "speaker_label": s.speaker_label,
                "original_text": s.original_text,
                "translated_text": s.translated_text,
            }
            for s in segments
        ]


class UpdateSegmentRequest(BaseModel):
    translated_text: str


@app.patch("/segments/{segment_id}")
def update_segment(segment_id: int, payload: UpdateSegmentRequest, user: User = Depends(get_current_user)):
    with get_session() as session:
        seg = session.get(Segment, segment_id)
        if not seg:
            raise HTTPException(status_code=404, detail="Segment not found")
        
        # Verify ownership via file -> upload
        up = session.query(Upload).filter(Upload.stored_name == seg.file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=403, detail="Not authorized")

        seg.translated_text = payload.translated_text
        # Invalidate TTS cache if exists
        if seg.tts_cache_key:
            seg.tts_status = "pending"
            seg.tts_path = None
            seg.tts_cache_key = None
        session.add(seg)
        session.commit()
        return {"id": seg.id, "translated_text": seg.translated_text}


@app.post("/files/{file_id}/tts")
def request_per_segment_tts(file_id: str, force: bool = False, user: User = Depends(get_current_user)):
    """Enqueue per-segment TTS generation for all translated segments in a file."""
    file_id = os.path.basename(file_id)
    with get_session() as session:
        # Check ownership
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check file status
        f = session.get(FileModel, file_id)
        if not f or f.status not in {"ready_for_tts", "translated", "tts_done", "tts_partial", "tts", "error"}:
            raise HTTPException(status_code=400, detail="File must be translated before TTS generation")
        
        # Update status
        f.status = "tts"
        session.commit()
    
    job = enqueue_per_segment_tts(file_id, force)
    return {"file_id": file_id, "job_id": job.id, "status": "queued"}


@app.get("/files/{file_id}/tts/status")
def get_tts_status(file_id: str, user: User = Depends(get_current_user)):
    """Get TTS generation progress for a file."""
    file_id = os.path.basename(file_id)
    with get_session() as session:
        # Check ownership
        up = session.query(Upload).filter(Upload.stored_name == file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Get file progress
        f = session.get(FileModel, file_id)
        if not f:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Count segments by status
        from sqlalchemy import func
        status_counts = session.query(
            Segment.tts_status,
            func.count(Segment.id)
        ).filter(Segment.file_id == file_id).group_by(Segment.tts_status).all()
        
        status_map = {status: count for status, count in status_counts}
        
        tts_progress = f.progress.get("tts", {}) if isinstance(f.progress, dict) else {}
        
        return {
            "file_id": file_id,
            "status": f.status,
            "tts_progress": tts_progress,
            "segment_counts": status_map,
            "total_segments": sum(status_map.values()),
        }


@app.post("/segments/{segment_id}/invalidate-tts-cache")
def invalidate_segment_tts_cache(segment_id: int, user: User = Depends(get_current_user)):
    """Invalidate TTS cache for a specific segment."""
    with get_session() as session:
        seg = session.get(Segment, segment_id)
        if not seg:
            raise HTTPException(status_code=404, detail="Segment not found")
        
        # Verify ownership
        up = session.query(Upload).filter(Upload.stored_name == seg.file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Invalidate cache
        seg.tts_status = "pending"
        seg.tts_path = None
        seg.tts_cache_key = None
        seg.tts_error_reason = None
        session.add(seg)
        session.commit()
        
        return {"id": seg.id, "status": "cache_invalidated"}


@app.post("/segments/{segment_id}/regenerate-tts")
def regenerate_segment_tts(segment_id: int, user: User = Depends(get_current_user)):
    """Regenerate TTS for a specific segment (invalidates cache and enqueues job)."""
    with get_session() as session:
        seg = session.get(Segment, segment_id)
        if not seg:
            raise HTTPException(status_code=404, detail="Segment not found")
        
        # Verify ownership
        up = session.query(Upload).filter(Upload.stored_name == seg.file_id, Upload.user_id == user.id).first()
        if not up:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Invalidate cache
        seg.tts_status = "queued"
        seg.tts_path = None
        seg.tts_cache_key = None
        seg.tts_error_reason = None
        session.add(seg)
        session.commit()
    
    # Enqueue job for entire file (will process only pending segments)
    job = enqueue_per_segment_tts(seg.file_id, force=False)
    
    return {"id": seg.id, "file_id": seg.file_id, "job_id": job.id, "status": "queued"}

# Day 7: Audio/Video Stitching Endpoints

@app.post("/files/{file_id}/stitch")
def request_stitch(
    file_id: str,
    force: bool = False,
    user: User = Depends(get_current_user)
):
    """Trigger audio/video stitching for a file (Day 7)."""
    with get_session() as session:
        file_row = session.execute(
            text("SELECT id, status FROM files WHERE id = :fid"),
            {"fid": file_id}
        ).first()
        
        if not file_row:
            raise HTTPException(status_code=404, detail="File not found")
        
        if file_row.status not in {"tts_done", "done", "error"} and not force:
            raise HTTPException(
                status_code=400,
                detail=f"File must have status 'tts_done' (current: {file_row.status})"
            )
        
        job = enqueue_stitch(file_id, force=force)
        return {"file_id": file_id, "job_id": job.id, "status": "queued"}


@app.get("/files/{file_id}/outputs")
def get_file_outputs(file_id: str, user: User = Depends(get_current_user)):
    """Get final output URLs for a file (Day 7)."""
    with get_session() as session:
        file_row = session.execute(
            text("SELECT status, progress, final_audio_path, final_video_path, media_type FROM files WHERE id = :fid"),
            {"fid": file_id}
        ).first()
        
        if not file_row:
            raise HTTPException(status_code=404, detail="File not found")
        
        files_url_base = os.getenv("FILES_URL_BASE", "http://localhost:8000/media")
        
        return {
            "file_id": file_id,
            "status": file_row.status,
            "media_type": file_row.media_type,
            "final_audio_url": f"{files_url_base}/{file_row.final_audio_path}" if file_row.final_audio_path else None,
            "final_video_url": f"{files_url_base}/{file_row.final_video_path}" if file_row.final_video_path else None,
            "progress": file_row.progress
        }

# Day 7: Serve media files via custom route (replaces StaticFiles mount)
@app.get("/media/{file_path:path}")
@app.head("/media/{file_path:path}")
def serve_media(file_path: str):
    """Serve final audio/video outputs from /project/files directory."""
    FILES_ROOT_MEDIA = Path(os.getenv("FILES_ROOT", "/project/files"))
    full_path = FILES_ROOT_MEDIA / file_path
    
    # Security: prevent directory traversal
    try:
        full_path = full_path.resolve()
        FILES_ROOT_MEDIA = FILES_ROOT_MEDIA.resolve()
        if not str(full_path).startswith(str(FILES_ROOT_MEDIA)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(str(full_path))
