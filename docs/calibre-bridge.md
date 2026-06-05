# Calibre‑Web‑Automated Bridge

The `calibre-bridge/` companion is an **optional** FastAPI service that turns "I just read this
on lightnovel.fun" into "…and now it's in my Calibre library, with real metadata." It is
**import‑only**: it enriches an EPUB's OPF metadata and drops the file into a
[Calibre‑Web‑Automated](https://github.com/crocodilestick/Calibre-Web-Automated) (CWA) ingest
folder. There is **no progress/bookmark sync and no kosync** — the reader owns its own reading
position (web novels resume from LK's native history; single‑article books from a local per‑aid
scroll memory).

> ⚠️ **Experimental — at your own risk.** Both this bridge and the reader connecting to it are
> experimental. You run the bridge yourself; it touches your filesystem and your Calibre library,
> and the reader reaches it over a cross‑origin `@connect` (and the LLM metadata path connects to
> third‑party APIs that may cost money). Understand what it does before enabling it — these settings
> are collapsed and tagged **实验性** in the reader for that reason.

```
[reader userscript on lightnovel.fun]
        │  GM_xmlhttpRequest  (POST EPUB + meta → http://<bridge>:8788/api/import)
        ▼
[bridge (FastAPI)] ──enrich OPF & drop into ingest──▶ [Calibre‑Web‑Automated]
```

Current bridge version: **`0.1.0`** (`bridge/__init__.py` → `__version__`).

## What it does

For each book the reader sends, the bridge:

1. **Reads the EPUB** sent as a multipart upload (the exact EPUB you read — your manual chapter
   splits + embedded images), plus a JSON `meta` blob the reader parsed from the site.
2. **Enriches the OPF metadata** (`bridge/epub_meta.py` → `enrich_epub` / `enrich_opf_bytes`),
   mapping LK metadata onto Dublin‑Core + Calibre OPF fields:
   | LK meta key | OPF target | Notes |
   |---|---|---|
   | `title` | `dc:title` | |
   | `language` | `dc:language` | defaults to `zh` |
   | `author` | `dc:creator` `opf:role="aut"` + `opf:file-as` | the in‑text **作者**, not the LK uploader |
   | `original` | 2nd `dc:creator` `aut` | only if distinct from `author` |
   | `translator` → `trl`, `illustrator` → `ill`, `editor` → `edt`, `sourceGroup` → `bkp` | `dc:contributor` w/ MARC relator role | one element **per name** — credits like `李雷、悦梦/EMT` are split on `、，,/／&＆` |
   | `updated` | `dc:date` | |
   | `lkUrl` | `dc:source` + `dc:identifier opf:scheme="url"` | |
   | `description` | `dc:description` | |
   | `tags` | `dc:subject` | plus searchable `译者:…` / `插画:…` / `图源:…` fallback subjects for credits Calibre has no native column for |
   | `aid` | `dc:identifier opf:scheme="lknovel"` | re‑import‑safe (drops its own old `lknovel`/`url` ids, never touches the package `unique-identifier`) |
   | `series` + `volume` | `<meta name="calibre:series">` / `calibre:series_index` | volume coerced to float, formatted `%g` |

   OPF surgery preserves EPUB structure: `mimetype` stays first and stored uncompressed.
   If enrichment throws, the bridge **falls back to the original unmodified EPUB** and reports
   the failure in the response as `enrich_error` (the import still proceeds).

   **Version‑aware (EPUB 3 default / EPUB 2 fallback):** `enrich_opf_bytes` detects the package
   `version` and writes the matching form. For **EPUB 3** (the reader's default output) roles are
   `<meta refines property="role" scheme="marc:relators">` and the series is `belongs-to-collection`
   — it also cleans up any **dangling `refines`** from a previous pass and refreshes the required
   `dcterms:modified`, so a re‑enriched file stays valid. For **EPUB 2** it uses the legacy
   `opf:role` attributes shown in the table. `calibre:series` is written in both.
3. **Imports** the (enriched) EPUB into the library (`bridge/calibre.py` → `import_epub`), the way
   chosen by `BRIDGE_MODE` (see [Modes](#modes)).
4. **Catalogues it** in a tiny SQLite table (`bridge/store.py`, keyed by `aid`) — used *only* for
   the health‑check book count and the `/api/lookup` "already imported?" check. No reading state is
   ever stored here.

## Endpoints

All under `/api`. If `BRIDGE_TOKEN` is set, every call must send `Authorization: Bearer <token>`
(enforced by `_check_auth` in `bridge/main.py`); a wrong/missing token → `401`.

| Method | Path | Request | Response | Purpose |
|---|---|---|---|---|
| `GET`  | `/api/health` | – | `{ok, version, mode, ingest_dir, library_dir, calibredb, books}` | liveness + config echo + imported‑book count |
| `POST` | `/api/import` | multipart: `file` (the EPUB) + `meta` (JSON string) | `{ok, aid, import, enrich_error}` | enrich + import one book |
| `GET`  | `/api/lookup?aid=<aid>` | – | `{exists, book}` | is this `aid` already in the library? |
| `GET`  | `/api/books` | – | `{books: [...]}` | list catalogued imports (newest first) |

### `POST /api/import` contract

- `meta` is a JSON string in a multipart **form field** (not a JSON body). `meta.aid` is
  **required** → missing/blank `aid` returns `400 meta.aid required`; an empty `file` returns
  `400 empty file`.
- Recognised `meta` keys: `aid`, `title`, `author`, `original`, `translator`, `illustrator`,
  `editor`, `sourceGroup`, `language`, `description`, `tags` (array), `lkUrl`, `series`, `volume`,
  `updated`.
- The library filename is derived as `"<title> - <author>"` (falling back to `lknovel-<aid>`).
- `import` in the response is the mode‑specific result, e.g.
  `{"method": "ingest", "path": ".../<file>.epub", "calibre_id": null}` or
  `{"method": "calibredb", "path": null, "calibre_id": 42, "log": "..."}`.

Example (the userscript sends the equivalent via `GM_xmlhttpRequest`):

```bash
curl -s http://127.0.0.1:8788/api/import \
  -F 'file=@book.epub;type=application/epub+zip' \
  -F 'meta={"aid":"1144697","title":"测试书","author":"A","translator":"夜殇","series":"测试书","volume":2,"lkUrl":"https://www.lightnovel.fun/detail/1144697"}'
```

## Modes

Selected by `BRIDGE_MODE` (`bridge/calibre.py` → `import_epub`):

- **`ingest`** *(default, recommended for CWA)* — write the EPUB into `INGEST_DIR`, the folder CWA
  watches. The write is **atomic**: bytes go to a `.epub.part` temp file, then `os.replace` to the
  final `.epub` so CWA never sees a half‑written file; name collisions get a ` (1)`, ` (2)`… suffix.
  This is the conflict‑free path — no fighting CWA's library SQLite write lock, and the bridge image
  needs **no Calibre installed** (CWA does the actual import from the OPF you wrote).
- **`calibredb`** — add to a *plain* Calibre library at `LIBRARY_DIR` via the `calibredb` CLI
  (`calibredb add --duplicates`). Requires the `calibre` toolchain available where the bridge runs
  (`calibredb_available()` checks `CALIBREDB` on `PATH`). Use this only if you don't run CWA.

## Environment variables

Read in `bridge/config.py`. `docker-compose.yml` sets sensible container defaults; `.env.example`
(read automatically by docker‑compose) only ships the two you're most likely to change —
`BRIDGE_MODE` and `BRIDGE_TOKEN` — but all of the below are overridable.

| Var | Default | Purpose |
|---|---|---|
| `BRIDGE_MODE` | `ingest` | `ingest` or `calibredb` (see [Modes](#modes)). |
| `INGEST_DIR` | `/cwa-book-ingest` | CWA ingest folder (ingest mode). Must be the **same volume CWA watches**. |
| `LIBRARY_DIR` | `/calibre-library` | Plain Calibre library dir (calibredb mode). |
| `STATE_DB` | `/data/state.sqlite3` | SQLite catalog path (book list / lookup only). |
| `CALIBREDB` | `calibredb` | Path/name of the `calibredb` binary (calibredb mode). |
| `CORS_ORIGINS` | `https://www.lightnovel.fun,https://lightnovel.fun,http://localhost:5180,http://127.0.0.1:5180` | Comma‑separated allow‑list (see [CORS + PNA](#cors--private-network-access-middleware)). `*` allows all. |
| `BRIDGE_TOKEN` | *(unset)* | Optional shared‑secret bearer token. Set the **same value** in the reader's settings ("书库 Token"). **Never hardcode it** — it lives in env / runtime settings only. |

`config.ensure_dirs()` creates `STATE_DB`'s parent and the relevant `INGEST_DIR`/`LIBRARY_DIR` at
startup.

## Running it

### With Docker Compose (bundles CWA)

`calibre-bridge/docker-compose.yml` (project `lknovel-library`) brings up **two** services on a
shared Docker network:

- **`calibre-web-automated`** (`cwa`) — the library + web reader, UI on
  **http://localhost:8083** (first run: create the admin user; the library is the empty
  `cwa-library` volume). It auto‑imports anything dropped in `cwa-ingest`.
- **`bridge`** (`lknovel-bridge`) — built from the local `Dockerfile`, bound to
  **`127.0.0.1:8788`**, sharing the `cwa-ingest` volume so its ingest writes land where CWA looks.

```bash
cd calibre-bridge
cp .env.example .env          # optional: set BRIDGE_TOKEN
docker compose up -d --build
curl http://127.0.0.1:8788/api/health
```

The bridge image (`Dockerfile`, `python:3.12-slim`) is intentionally lean — ingest mode needs no
Calibre. It `pip install`s the project and runs `uvicorn bridge.main:app --host 0.0.0.0 --port 8788`.

### Locally with uv (no Docker)

Useful for development or if you don't want containers. Point the env vars at writable local dirs:

```bash
cd calibre-bridge
uv sync --extra dev

# ingest mode → just drop EPUBs into a folder (CWA, if any, watches it)
BRIDGE_MODE=ingest \
INGEST_DIR=./_local/ingest \
STATE_DB=./_local/state.sqlite3 \
uv run uvicorn bridge.main:app --port 8788
```

Then in the reader (Tampermonkey, **v1.9+**): **设置 → 发送到书库**, tick *启用书库*, set
**书库地址** to your bridge URL (default `http://127.0.0.1:8788`), optionally paste the token. The
download dialog gains a **📚 发送到书库** button.

## CORS + Private‑Network‑Access middleware

`bridge/main.py` ships a **custom** `@app.middleware("http")` (`cors_pna`) instead of Starlette's
`CORSMiddleware`. Two reasons:

1. **The userscript doesn't need CORS at all.** `GM_xmlhttpRequest` runs in Tampermonkey's
   privileged extension context, so it bypasses CORS, mixed‑content, *and* the
   "must‑be‑localhost" rule. The middleware exists for the **Vue web app / any page‑context
   `fetch`** and the test harness.
2. **Chrome's Private Network Access (PNA).** A request from a *public* HTTPS page
   (`https://www.lightnovel.fun`) to a *private/loopback* address (`127.0.0.1:8788`) triggers a PNA
   preflight that demands an `Access-Control-Allow-Private-Network: true` response header.
   Starlette's built‑in `CORSMiddleware` **rejects** PNA preflights, so the bridge answers preflight
   `OPTIONS` itself: for an allow‑listed `Origin` it returns `Access-Control-Allow-Origin` (echoed,
   never `*` for credentials‑style requests), `Allow-Methods: GET, POST, OPTIONS`, the requested
   `Allow-Headers` (default `Authorization, Content-Type`), `Max-Age: 600`, and — when the preflight
   carries `access-control-request-private-network` — `Allow-Private-Network: true`. Non‑listed
   origins get no CORS grant. Every response carries `Vary: Origin`.

## Deployment (home server + Tailscale)

The bridge is a **server component that lives next to CWA** — it needs filesystem/ingest (or
`calibredb`) access, which a browser extension cannot provide. But because the reader talks to it via
`GM_xmlhttpRequest` (extension context, bypasses CORS/PNA/localhost rules), **the bridge does not
have to run on the browser machine.** It can run anywhere the browser can reach by IP/hostname; the
only per‑device step is typing that address into the reader's settings.

**Recommended multi‑device setup** — run the whole compose on your home server, alongside CWA, and
reach it over [Tailscale](https://tailscale.com/):

1. In `docker-compose.yml`, change the bridge port from `127.0.0.1:8788:8788` to `8788:8788`
   (or bind to the Tailscale interface) so it isn't loopback‑only.
2. **Set `BRIDGE_TOKEN`** (in `.env` or the compose `environment:` block) — once it's reachable
   beyond localhost, lock it down.
3. On each reading device, set the reader's **书库地址** to
   `http://<server-tailscale-ip-or-host>:8788` and the same token. (Device + server both on the
   tailnet.)
4. First call to a new host: Tampermonkey asks to allow it → **Always allow** (or add
   `@connect <host>` to the userscript header).

The bridge reaches CWA by Docker **service name** (`calibre-web-automated`) since they share the
compose network, and writes into the shared `cwa-ingest` volume — no host networking needed between
them.

## Tests

```bash
cd calibre-bridge
uv sync --extra dev
uv run pytest
```

The suite (`tests/`) covers the parts that matter, using throwaway temp dirs and re‑importing
`bridge.config` / `bridge.calibre` / `bridge.main` per fixture so env vars take effect:

- **`tests/test_api.py`** — `/api/health`; `/api/import` lands a real `.epub` (not `.part`) in the
  ingest dir with enriched OPF (asserts translator `夜殇`, the `lknovel` identifier and
  `calibre:series` are present), then verifies the health count and `/api/lookup` reflect it;
  `meta.aid` required → `400`; `BRIDGE_TOKEN` gate → `401` without / `200` with the bearer header.
- **`tests/test_epub_meta.py`** — OPF enrichment (name splitting, MARC roles, identifiers, series).
- **`tests/test_store.py`** — the SQLite catalog upsert/lookup.

`tests/conftest.py` provides a `make_epub()` helper that builds a minimal valid EPUB in memory.

## Honest caveats

- **Import‑only.** No progress/bookmark sync, no kosync, no reading‑state DB. The SQLite store holds
  catalog rows (title/author/translator/url/series/volume/`aid`) purely for dedupe + counts.
- **Re‑import is idempotent for identifiers** (the bridge strips its own previous `lknovel`/`url`
  ids before re‑adding and never touches the package `unique-identifier`), but each `/api/import`
  still writes a *new* file into ingest — CWA's own dedupe decides what to do with it.
- **The site's reported author is the uploader**; the real 作者 comes from the reader's credit
  parser and is what lands in `dc:creator`.

## File map

| File | Role |
|---|---|
| `calibre-bridge/bridge/main.py` | FastAPI app, routes, auth, custom CORS/PNA middleware |
| `calibre-bridge/bridge/config.py` | env‑driven `Config` (modes, dirs, CORS, token) |
| `calibre-bridge/bridge/epub_meta.py` | OPF metadata enrichment (`enrich_epub`) |
| `calibre-bridge/bridge/calibre.py` | `import_epub` → ingest (atomic) or `calibredb` |
| `calibre-bridge/bridge/store.py` | SQLite catalog (count + lookup only) |
| `calibre-bridge/docker-compose.yml` | bridge + CWA, shared `cwa-ingest` volume |
| `calibre-bridge/Dockerfile` | lean `python:3.12-slim` image |
| `calibre-bridge/.env.example` | ships `BRIDGE_MODE` + `BRIDGE_TOKEN` |
| `calibre-bridge/tests/` | pytest suite |
