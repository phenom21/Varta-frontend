import os
from pathlib import Path

# Base project root two levels above this file
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Media and model configuration
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(PROJECT_ROOT)))
CHATTERBOX_MODEL_NAME = os.getenv("CHATTERBOX_MODEL_NAME", "chatterbox-base")

# Speaker sample extraction thresholds
MIN_SAMPLE_TOTAL_SECONDS = float(os.getenv("MIN_SAMPLE_TOTAL_SECONDS", os.getenv("MIN_SAMPLE_SECONDS", "30.0")))
MIN_SEGMENT_SECONDS = float(os.getenv("MIN_SEGMENT_SECONDS", "0.5"))
