FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY web ./web
COPY scripts ./scripts
# /data must be a persistent volume. A single process owns the SQLite file.
RUN mkdir -p /data
ENV DATABASE_PATH=/data/calendar.sqlite3 ARCHIVE_KEY_FILE=/data/archive-key.pem ARCHIVE_PUBLIC_KEYS=/data/archive-public-keys.json
EXPOSE 8000
CMD ["python", "-m", "app"]
