FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy app code
COPY backend /app/backend

# Runtime env (can be overridden by compose)
ENV DATABASE_URL="sqlite:////project/data/app.db" \
    REDIS_URL="redis://redis:6379/0" \
    UPLOADS_ROOT="/project/uploads" \
    TRANSCRIPTS_ROOT="/project/transcripts" \
    TMP_ROOT="/project/tmp" \
    ACCESS_TOKEN_EXPIRE_MINUTES=60

WORKDIR /app/backend

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
