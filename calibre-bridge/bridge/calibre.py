"""Get the EPUB into the library: CWA ingest folder (recommended) or calibredb (plain Calibre)."""
from __future__ import annotations
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .config import config


def _safe_name(name: str) -> str:
    name = re.sub(r"[^\w\-. ()一-鿿぀-ヿ]", "_", name).strip() or "book"
    return name[:120]


def calibredb_available() -> bool:
    return shutil.which(config.calibredb) is not None or os.path.exists(config.calibredb)


def ingest(epub_bytes: bytes, filename: str) -> dict:
    """Drop the EPUB into CWA's ingest folder atomically (write .part, then rename to .epub)."""
    config.ingest_dir.mkdir(parents=True, exist_ok=True)
    base = _safe_name(filename) or "book"
    if not base.lower().endswith(".epub"):
        base += ".epub"
    final = config.ingest_dir / base
    n = 1
    while final.exists():
        final = config.ingest_dir / f"{base[:-5]} ({n}).epub"
        n += 1
    tmp = final.with_suffix(".epub.part")
    tmp.write_bytes(epub_bytes)
    os.replace(tmp, final)
    return {"method": "ingest", "path": str(final), "calibre_id": None}


def add_via_calibredb(epub_bytes: bytes, meta: dict) -> dict:
    """Add via the calibredb CLI to a plain Calibre library (reads the enriched OPF for metadata)."""
    config.library_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tf:
        tf.write(epub_bytes)
        path = tf.name
    try:
        proc = subprocess.run(
            [config.calibredb, "add", "--library-path", str(config.library_dir), "--duplicates", path],
            capture_output=True, text=True, timeout=180,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        m = re.search(r"Added book ids?:\s*([0-9,\s]+)", out)
        book_id = None
        if m:
            ids = [int(x) for x in re.findall(r"\d+", m.group(1))]
            book_id = ids[0] if ids else None
        if book_id is None and proc.returncode != 0:
            raise RuntimeError(out.strip()[:500] or "calibredb add failed")
        return {"method": "calibredb", "path": None, "calibre_id": book_id, "log": out.strip()[:500]}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def import_epub(epub_bytes: bytes, filename: str, meta: dict) -> dict:
    if config.mode == "calibredb":
        return add_via_calibredb(epub_bytes, meta)
    return ingest(epub_bytes, filename)
