"""Environment-driven config for the bridge."""
from __future__ import annotations
import os
from pathlib import Path


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    def __init__(self) -> None:
        # 'ingest'  → drop the (metadata-enriched) EPUB into CWA's ingest folder (recommended for CWA)
        # 'calibredb' → add via the calibredb CLI into a plain Calibre library
        self.mode: str = os.environ.get("BRIDGE_MODE", "ingest").strip().lower()
        self.ingest_dir = Path(os.environ.get("INGEST_DIR", "/cwa-book-ingest"))
        self.library_dir = Path(os.environ.get("LIBRARY_DIR", "/calibre-library"))
        self.state_db = Path(os.environ.get("STATE_DB", "/data/state.sqlite3"))
        self.calibredb = os.environ.get("CALIBREDB", "calibredb")
        # comma-separated allowed CORS origins (the userscript uses GM_xmlhttpRequest and ignores CORS,
        # but the Vue web app / browser fetch needs it, and so does the test harness shim)
        self.cors_origins = [
            o.strip() for o in os.environ.get(
                "CORS_ORIGINS",
                "https://www.lightnovel.fun,https://lightnovel.fun,http://localhost:5180,http://127.0.0.1:5180",
            ).split(",") if o.strip()
        ]
        # optional shared-secret bearer token (set the same value in the reader's settings)
        self.auth_token: str | None = os.environ.get("BRIDGE_TOKEN") or None

    def ensure_dirs(self) -> None:
        self.state_db.parent.mkdir(parents=True, exist_ok=True)
        if self.mode == "ingest":
            self.ingest_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.library_dir.mkdir(parents=True, exist_ok=True)


config = Config()
