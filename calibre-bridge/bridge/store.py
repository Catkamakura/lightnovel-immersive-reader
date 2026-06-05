"""Tiny SQLite catalog of books the bridge has sent to the library.

Used only for the health-check count and the /api/lookup "is this already imported?" helper.
There is no reading-state table anymore — the reader owns its own position and resumes from LK's
native history, so the bridge never stores progress or bookmarks."""
from __future__ import annotations
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
  aid         TEXT PRIMARY KEY,
  calibre_id  INTEGER,
  title       TEXT,
  author      TEXT,
  translator  TEXT,
  lk_url      TEXT,
  series      TEXT,
  volume      REAL,
  updated     TEXT,
  created_at  REAL,
  imported_at REAL
);
"""


class Store:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def upsert_book(self, aid: str, **fields: Any) -> None:
        cols = ["calibre_id", "title", "author", "translator", "lk_url", "series", "volume", "updated"]
        vals = {c: fields.get(c) for c in cols}
        now = time.time()
        with self._lock:
            self._conn.execute(
                """INSERT INTO books(aid, calibre_id, title, author, translator, lk_url, series, volume,
                                     updated, created_at, imported_at)
                   VALUES(:aid,:calibre_id,:title,:author,:translator,:lk_url,:series,:volume,:updated,:created,:imported)
                   ON CONFLICT(aid) DO UPDATE SET
                     calibre_id=COALESCE(excluded.calibre_id, books.calibre_id),
                     title=excluded.title, author=excluded.author, translator=excluded.translator,
                     lk_url=excluded.lk_url, series=excluded.series, volume=excluded.volume,
                     updated=excluded.updated, imported_at=excluded.imported_at""",
                {"aid": str(aid), **vals, "created": now, "imported": now},
            )
            self._conn.commit()

    def get_book(self, aid: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM books WHERE aid=?", (str(aid),)).fetchone()
        return dict(row) if row else None

    def list_books(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM books ORDER BY imported_at DESC").fetchall()
        return [dict(r) for r in rows]
