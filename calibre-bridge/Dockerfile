FROM python:3.12-slim

# lxml needs no build deps on the slim wheels; keep it lean (ingest mode doesn't need calibre)
WORKDIR /app
COPY pyproject.toml ./
COPY bridge ./bridge
RUN pip install --no-cache-dir . && mkdir -p /data

ENV BRIDGE_MODE=ingest \
    INGEST_DIR=/cwa-book-ingest \
    LIBRARY_DIR=/calibre-library \
    STATE_DB=/data/state.sqlite3 \
    PORT=8788

EXPOSE 8788
CMD ["uvicorn", "bridge.main:app", "--host", "0.0.0.0", "--port", "8788"]
