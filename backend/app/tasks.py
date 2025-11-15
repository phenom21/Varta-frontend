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
