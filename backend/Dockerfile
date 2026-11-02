FROM python:3.12-slim

WORKDIR /app

# Install system dependencies including tesseract-ocr for scanned PDF OCR fallback
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model en_core_web_lg (fall back to en_core_web_sm if unavailable)
RUN python -m spacy download en_core_web_lg || python -m spacy download en_core_web_sm

# Copy backend application source
COPY . .

# Expose port
EXPOSE 8000

# Start server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
