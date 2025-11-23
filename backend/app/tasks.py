import os
from rq import Queue
from rq.job import Retry
from redis import Redis

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
QUEUE_NAME = os.getenv("RQ_QUEUE", "transcriptions")
JOB_TIMEOUT = int(os.getenv("JOB_TIMEOUT_SECONDS", "3600"))  # 1 hours default
RESULT_TTL = int(os.getenv("RQ_RESULT_TTL_SECONDS", "1800"))  # keep results for 30 minutes
FAILURE_TTL = int(os.getenv("RQ_FAILURE_TTL_SECONDS", "86400"))  # failed jobs kept for 1 day


def _get_redis() -> Redis:
    return Redis.from_url(REDIS_URL)


def enqueue_transcription(file_id: str, language: str | None = None):
    """Enqueue a transcription job for the given file_id.
    The worker implements `workers.transcribe_and_diarize.transcribe_and_diarize(file_id)` in the ml-workers repo.
    """
    q = Queue(name=QUEUE_NAME, connection=_get_redis())
    retry = Retry(max=3, interval=[60, 300, 600])
    return q.enqueue(
        "workers.transcribe_and_diarize.transcribe_and_diarize",
        file_id,
        language,
        retry=retry,
        job_timeout=JOB_TIMEOUT,
        result_ttl=RESULT_TTL,
        failure_ttl=FAILURE_TTL,
        description=f"Transcribe+Diarize {file_id}",
    )


def enqueue_tts_synthesis(file_id: str, speaker_label: str, text: str):
    """Enqueue a TTS synthesis job that generates a short WAV for the given speaker.
    The worker implements `workers.chatterbox_tts_synthesize.synthesize_speaker_text(file_id, speaker_label, text)`.
    Returns the enqueued job.
    """
    q = Queue(name=QUEUE_NAME, connection=_get_redis())
    retry = Retry(max=2, interval=[30, 120])
    return q.enqueue(
        "workers.chatterbox_tts_synthesize.synthesize_speaker_text",
        file_id,
        speaker_label,
        text,
        retry=retry,
        job_timeout=min(JOB_TIMEOUT, 600),
        result_ttl=RESULT_TTL,
        failure_ttl=FAILURE_TTL,
        description=f"TTS synth {file_id}:{speaker_label}",
    )


def enqueue_translation(file_id: str, target_lang: str, force: bool = False):
    """Enqueue a translation job for the given file."""
    redis_conn = Redis.from_url(os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"))
    queue = Queue("transcriptions", connection=redis_conn)
    job = queue.enqueue(
        "workers.translate.translate_job",
        file_id,
        target_lang,
        force,
        job_timeout="1h",
        result_ttl=1800,
    )
    return job


def enqueue_per_segment_tts(file_id: str, force: bool = False):
    """Enqueue per-segment TTS generation job."""
    redis_conn = Redis.from_url(os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"))
    queue = Queue("tts", connection=redis_conn)
    job = queue.enqueue(
        "workers.per_segment_tts.per_segment_tts_job",
        file_id,
        force,
        job_timeout="2h",
        result_ttl=1800,
    )
    return job


def enqueue_stitch(file_id: str, force: bool = False):
    """Enqueue audio/video stitching job (Day 7)."""
    redis_conn = Redis.from_url(os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"))
    queue = Queue("tts", connection=redis_conn)  # Use tts queue for now
    job = queue.enqueue(
        "workers.stitch_audio.stitch_dubbed_audio",
        file_id,
        force,
        job_timeout="1h",
        result_ttl=1800,
    )
    return job
