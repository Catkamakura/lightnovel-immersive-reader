import json
import os
import tempfile
import zipfile
import importlib

import pytest
from conftest import make_epub


@pytest.fixture()
def client(monkeypatch):
    d = tempfile.mkdtemp()
    monkeypatch.setenv("BRIDGE_MODE", "ingest")
    monkeypatch.setenv("INGEST_DIR", os.path.join(d, "ingest"))
    monkeypatch.setenv("STATE_DB", os.path.join(d, "state.sqlite3"))
    monkeypatch.delenv("BRIDGE_TOKEN", raising=False)
    # re-import config + app fresh so env takes effect
    import bridge.config as cfg
    importlib.reload(cfg)
    import bridge.calibre as cal
    importlib.reload(cal)
    import bridge.main as m
    importlib.reload(m)
    from fastapi.testclient import TestClient
    return TestClient(m.app), d


def test_health(client):
    c, _ = client
    r = c.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["mode"] == "ingest"


def test_import_lands_in_ingest_with_enriched_metadata(client):
    c, d = client
    meta = {"aid": "1144697", "title": "测试书", "author": "A", "translator": "夜殇",
            "lkUrl": "https://www.lightnovel.fun/detail/1144697", "series": "测试书", "volume": 2}
    r = c.post("/api/import", files={"file": ("b.epub", make_epub(), "application/epub+zip")},
               data={"meta": json.dumps(meta)})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] and j["aid"] == "1144697" and j["enrich_error"] is None
    # a real .epub (not .part) landed in ingest, with enriched metadata
    ingest = os.path.join(d, "ingest")
    files = [f for f in os.listdir(ingest) if f.endswith(".epub")]
    assert len(files) == 1
    zf = zipfile.ZipFile(os.path.join(ingest, files[0]))
    opf = zf.read([n for n in zf.namelist() if n.endswith(".opf")][0]).decode("utf-8")
    assert "夜殇" in opf and "lknovel" in opf and "calibre:series" in opf
    # the book is now catalogued (health count + lookup)
    assert c.get("/api/health").json()["books"] == 1
    assert c.get("/api/lookup", params={"aid": "1144697"}).json()["exists"] is True


def test_import_requires_aid(client):
    c, _ = client
    r = c.post("/api/import", files={"file": ("b.epub", make_epub(), "application/epub+zip")},
               data={"meta": json.dumps({"title": "no aid"})})
    assert r.status_code == 400


def test_auth_token(monkeypatch):
    d = tempfile.mkdtemp()
    monkeypatch.setenv("BRIDGE_MODE", "ingest")
    monkeypatch.setenv("INGEST_DIR", os.path.join(d, "ingest"))
    monkeypatch.setenv("STATE_DB", os.path.join(d, "state.sqlite3"))
    monkeypatch.setenv("BRIDGE_TOKEN", "secret")
    import bridge.config as cfg; importlib.reload(cfg)
    import bridge.calibre as cal; importlib.reload(cal)
    import bridge.main as m; importlib.reload(m)
    from fastapi.testclient import TestClient
    c = TestClient(m.app)
    assert c.get("/api/books").status_code == 401
    assert c.get("/api/books", headers={"Authorization": "Bearer secret"}).status_code == 200
