"""FastAPI bridge: import LK books into Calibre-Web-Automated with rich metadata.

That's the whole job now — the reader keeps its own reading position (and resumes from LK's
native history), so there is no progress/bookmark sync and no kosync here anymore. The bridge
just enriches each EPUB's OPF and drops it into CWA's ingest folder."""
from __future__ import annotations
import json
from typing import Any

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from . import __version__
from .config import config
from .store import Store
from .epub_meta import enrich_epub
from .calibre import import_epub, calibredb_available

config.ensure_dirs()
store = Store(config.state_db)
app = FastAPI(title="lknovel → Calibre bridge", version=__version__)
_ALLOW_ALL = "*" in config.cors_origins


def _acao(origin: str | None) -> str | None:
    if _ALLOW_ALL:
        return "*"
    if origin and origin in config.cors_origins:
        return origin
    return None


@app.middleware("http")
async def cors_pna(request: Request, call_next):
    """Custom CORS that also satisfies Chrome's Private Network Access (public HTTPS page → 127.0.0.1).

    The Tampermonkey userscript uses GM_xmlhttpRequest (no CORS/PNA), but the Vue web app and any
    page-context fetch need this. Starlette's built-in CORSMiddleware rejects PNA preflights, so we
    handle CORS ourselves."""
    origin = request.headers.get("origin")
    acao = _acao(origin)
    if request.method == "OPTIONS" and request.headers.get("access-control-request-method"):
        headers = {"Vary": "Origin"}
        if acao:  # only grant CORS + PNA to allow-listed origins (don't fall back to '*')
            headers["Access-Control-Allow-Origin"] = acao
            headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            headers["Access-Control-Allow-Headers"] = request.headers.get("access-control-request-headers") or "Authorization, Content-Type"
            headers["Access-Control-Max-Age"] = "600"
            if request.headers.get("access-control-request-private-network"):
                headers["Access-Control-Allow-Private-Network"] = "true"
        return Response(status_code=200, headers=headers)
    response = await call_next(request)
    if acao:
        response.headers["Access-Control-Allow-Origin"] = acao
        response.headers["Vary"] = "Origin"
    return response


def _check_auth(authorization: str | None) -> None:
    if not config.auth_token:
        return
    expected = f"Bearer {config.auth_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="bad token")


def _parse_json(s: str | None, default: Any) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return default


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "version": __version__,
        "mode": config.mode,
        "ingest_dir": str(config.ingest_dir),
        "library_dir": str(config.library_dir),
        "calibredb": calibredb_available(),
        "books": len(store.list_books()),
    }


@app.post("/api/import")
async def import_book(
    file: UploadFile = File(...),
    meta: str = Form("{}"),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    _check_auth(authorization)
    meta_d = _parse_json(meta, {})
    aid = str(meta_d.get("aid") or "").strip()
    if not aid:
        raise HTTPException(status_code=400, detail="meta.aid required")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        epub = enrich_epub(raw, meta_d)
    except Exception as e:  # fall back to the original file if OPF surgery fails
        epub = raw
        enrich_error = str(e)[:200]
    else:
        enrich_error = None

    title = meta_d.get("title") or f"lknovel-{aid}"
    fname = f"{title} - {meta_d.get('author','')}".strip(" -") or f"lknovel-{aid}"
    result = import_epub(epub, fname, meta_d)

    store.upsert_book(
        aid,
        calibre_id=result.get("calibre_id"),
        title=meta_d.get("title"), author=meta_d.get("author"), translator=meta_d.get("translator"),
        lk_url=meta_d.get("lkUrl"), series=meta_d.get("series"), volume=meta_d.get("volume"),
        updated=meta_d.get("updated"),
    )
    return JSONResponse({"ok": True, "aid": aid, "import": result, "enrich_error": enrich_error})


@app.get("/api/lookup")
def lookup(aid: str, authorization: str | None = Header(default=None)) -> dict:
    _check_auth(authorization)
    book = store.get_book(aid)
    return {"exists": bool(book), "book": book}


@app.get("/api/books")
def books(authorization: str | None = Header(default=None)) -> dict:
    _check_auth(authorization)
    return {"books": store.list_books()}
