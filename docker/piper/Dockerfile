FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV PIPER_MODELS_DIR=/data/models
VOLUME ["/data/models"]

EXPOSE 5000

CMD ["python", "server.py"]
