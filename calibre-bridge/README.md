# lknovel → Calibre‑Web‑Automated bridge

Send the books you read in the **lightnovel.fun immersive reader** straight into a
**Calibre‑Web‑Automated (CWA)** library — with real metadata.

```
[reader userscript on lightnovel.fun]
        │  GM_xmlhttpRequest  (http://127.0.0.1:8788)
        ▼
[bridge  (FastAPI, this repo)] ──enrich OPF & drop into ingest──▶ [Calibre‑Web‑Automated]
```

> **Reading position is NOT synced here.** The reader keeps its own scroll memory locally and
> resumes web novels from LK's native history, so there's no progress/bookmark sync, no state DB
> of reading data, and no kosync. The bridge does exactly one thing: get a good EPUB into CWA.

## Why a bridge (and not "talk to CWA directly")
The reader is a page on `lightnovel.fun`; it can't robustly POST to CWA (CORS + CSRF), and it
can't write to CWA's ingest folder (that's a filesystem path inside the container). The bridge
does the server‑side half: it reaches it with `GM_xmlhttpRequest` to `http://127.0.0.1:8788`
(allowed even from an HTTPS page — it runs in the extension context, and browsers treat
`localhost` as secure, so no TLS needed), writes rich metadata into the EPUB's OPF, and drops the
file into CWA's **ingest folder** (the conflict‑free way to add to CWA — no fighting the library's
SQLite write lock).

## Quick start (scaffolds CWA + bridge)
```bash
cd calibre-bridge
cp .env.example .env          # optional: set a token
docker compose up -d --build
```
- CWA web UI → **http://localhost:8083** (first run: create the admin user; the library is
  the empty `cwa-library` volume).
- Bridge API → **http://127.0.0.1:8788** (localhost only). Check: `curl http://127.0.0.1:8788/api/health`.

Then in the reader (Tampermonkey, **v1.9+**): open **设置 → 发送到书库**, tick *启用书库*,
leave the URL as `http://127.0.0.1:8788`, (optional) paste your token. Now the download
dialog has a **📚 发送到书库** button.

## What gets sent
- **The exact EPUB you read** (your manual chapter splits + embedded images).
- **Metadata** → Calibre: title, author (`aut`), **translator** (`trl`, parsed from the
  in‑text `翻译：…` credit line), `identifiers: lknovel:<aid>` + the LK url, **series +
  volume** (分卷), update date, tags, cover.

## API
| Method | Path | Body | Purpose |
|---|---|---|---|
| GET  | `/api/health` | – | status + book count |
| POST | `/api/import` | multipart `file` + `meta`(json) | enrich + import the book |
| GET  | `/api/lookup?aid=` | – | is this book already in the library? |
| GET  | `/api/books` | – | list imported books |

If `BRIDGE_TOKEN` is set, send `Authorization: Bearer <token>` on every call.

## Where does the bridge run? (it does NOT have to be the browser machine)
The reader reaches the bridge with `GM_xmlhttpRequest`, which runs in Tampermonkey's
**extension context** — it bypasses CORS, mixed‑content, *and* the "must be localhost" rule. So
the bridge can run **anywhere the browser can reach by IP/hostname**, and the only per‑device step
is typing that address into the reader's settings.

- **Same machine** (simplest): `docker compose up`, reader 书库地址 = `http://127.0.0.1:8788`.
- **Home server + Tailscale** (recommended for multi‑device): run this compose **on the server,
  next to CWA**. The bridge and CWA are in the same compose project, so they already share a Docker
  network (the bridge reaches CWA by service name `calibre-web-automated`). Then:
  1. In `docker-compose.yml`, change the bridge port from `127.0.0.1:8788:8788` to `8788:8788`
     (or bind it to the Tailscale interface), and set a `BRIDGE_TOKEN`.
  2. On each reading device, set the reader's 书库地址 to `http://<server-tailscale-ip-or-host>:8788`
     and the same token. (Both the device and the server must be on your tailnet.)
  3. The first time the userscript calls a new host, Tampermonkey asks to allow it → choose
     **Always allow** (or add `@connect <host>` to the userscript header).

**Could the bridge be a Chrome extension instead?** No — it needs a real server (filesystem +
`calibredb`/ingest access), and browser extensions can't host a listening socket. But it also
doesn't *need* to be local: the "privileged cross‑origin request" job that an extension would do is
already handled by Tampermonkey's `GM_xmlhttpRequest`. So: **bridge = server component (lives with
CWA); Tampermonkey = the browser half.**

## Modes
- `BRIDGE_MODE=ingest` (default) → CWA ingest folder. The bridge image is lightweight (no
  Calibre needed; CWA does the actual import).
- `BRIDGE_MODE=calibredb` → add to a plain Calibre library via the `calibredb` CLI (point
  `LIBRARY_DIR` at it; needs `calibre` installed where the bridge runs). Use this if you
  don't run CWA.

## Scope
This bridge is **import‑only**: its one job is getting a well‑tagged EPUB into CWA. Reading
position and bookmarks are **not** synced here — the reader keeps its own position locally and
resumes web novels from lightnovel.fun's own history. There is no reading‑state DB and no kosync.

## Dev
```bash
uv sync --extra dev
uv run pytest          14 tests: OPF enrichment + full credit roles, book store, API import/lookup, auth
uv run uvicorn bridge.main:app --port 8788   # run locally (defaults to ./_local dirs if you set them)
```
Run the bridge without Docker by setting `BRIDGE_MODE`, `INGEST_DIR`/`LIBRARY_DIR`, `STATE_DB` env vars.
