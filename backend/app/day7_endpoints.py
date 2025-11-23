

# Day 7: Audio/Video Stitching Endpoints

@app.post("/files/{file_id}/stitch")
def request_stitch(
    file_id: str,
    force: bool = False,
    user: User = Depends(get_current_user)
):
    """
    Trigger audio/video stitching for a file (Day 7).
    
    Composes per-segment TTS audio into final dubbed audio/video.
    """
    with get_session() as session:
        # Verify file exists and belongs to user
        file_row = session.execute(
            text("SELECT id, status, media_type FROM files WHERE id = :fid"),
            {"fid": file_id}
        ).first()
        
        if not file_row:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check file status
        if file_row.status not in {"tts_done", "done", "error"} and not force:
            raise HTTPException(
                status_code=400,
                detail=f"File must have status 'tts_done' before stitching (current: {file_row.status})"
            )
        
        # Enqueue stitching job
        job = enqueue_stitch(file_id, force=force)
        
        return {
            "file_id": file_id,
            "job_id": job.id,
            "status": "queued",
            "message": "Stitching job enqueued successfully"
        }


@app.get("/files/{file_id}/outputs")
def get_file_outputs(
    file_id: str,
    user: User = Depends(get_current_user)
):
    """
    Get final output URLs for a file (Day 7).
    
    Returns URLs for final dubbed audio and video (if applicable).
    """
    with get_session() as session:
        # Get file record
        file_row = session.execute(
            text("""
                SELECT id, status, progress, final_audio_path, final_video_path, media_type
                FROM files
                WHERE id = :fid
            """),
            {"fid": file_id}
        ).first()
        
        if not file_row:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Build URLs for outputs
        files_url_base = os.getenv("FILES_URL_BASE", "http://localhost:8000/media")
        
        final_audio_url = None
        if file_row.final_audio_path:
            final_audio_url = f"{files_url_base}/{file_row.final_audio_path}"
        
        final_video_url = None
        if file_row.final_video_path:
            final_video_url = f"{files_url_base}/{file_row.final_video_path}"
        
        return {
            "file_id": file_id,
            "status": file_row.status,
            "media_type": file_row.media_type,
            "final_audio_url": final_audio_url,
            "final_video_url": final_video_url,
            "progress": file_row.progress
        }
