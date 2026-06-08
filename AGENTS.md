# AGENTS.md

> Orientation for an AI coding agent (and for Claude Code / Cursor). **Start here.**

`lightnovel-immersive-reader` is a two-part personal-reading tool for **www.lightnovel.fun**. Part 1 is a single-file Tampermonkey **userscript** (`lightnovel-immersive-reader.user.js`, ~1550 lines of vanilla JS in one IIFE) that injects a clean, Google-Docs-style **immersive reader** into the *live* site without replacing it — it renders into a Shadow-DOM overlay under host `lkir-host` and reads the site's own JSON web API same-origin (`POST /proxy/api/...`). It supports continuous-scroll single articles and paged web-novel series, auto/manual chapterization, per-chapter bookmarks, a minimap, themes, account-scoped resume, and one-click **EPUB/TXT export** or **send-to-Calibre**. Part 2 is `calibre-bridge/`, an **optional** FastAPI companion the reader POSTs an EPUB to; it enriches the EPUB's OPF metadata and drops the file into a Calibre-Web-Automated (CWA) ingest folder (import-only — **no** progress/bookmark sync, no kosync).

## Project map

| Path | What it is |
|---|---|
| `lightnovel-immersive-reader.user.js` | The whole reader. One IIFE: config/themes → API envelope → helpers (`stripTags`/`esc`/`norm`) → `chapterize`/`buildEpub` → render (stream/series, outline, minimap) → metadata (`extractCredits`/`extractMetaLLM`/`buildLibMeta`) → resume/progress → boot (`lkir-host` shadow root, SPA route watcher). |
| `package.json` | npm metadata + `verify*` scripts. The userscript header `@version` (currently **1.20.1**) is the source of truth for the reader's version. |
| `verify/verify-userscript.mjs` | Playwright smoke test: injects the script (with a `GM_xmlhttpRequest` shim) into the live site, opens the reader, asserts UI. |
| `verify/verify-webnovel.mjs` | Playwright checks for the paged web-novel (`series`) mode. |
| `verify/verify-lib.mjs` | Playwright checks for the send-to-library flow. |
| `calibre-bridge/` | Optional FastAPI companion (uv + Docker). |
| `calibre-bridge/bridge/main.py` | FastAPI app + endpoints (`/api/health`, `/api/import`, `/api/lookup`, `/api/books`), custom CORS/PNA middleware, bearer-token auth. |
| `calibre-bridge/bridge/epub_meta.py` | `enrich_epub` / `enrich_opf_bytes`: rewrites the EPUB's OPF (Dublin-Core + Calibre fields, MARC relator roles). |
| `calibre-bridge/bridge/calibre.py` | `import_epub`: drop into CWA ingest folder (default) or add via `calibredb` CLI. |
| `calibre-bridge/bridge/store.py` | SQLite book registry (`upsert_book`/`list_book`/`get_book`) for `/api/lookup`. |
| `calibre-bridge/bridge/config.py` | Env-driven `Config` (`BRIDGE_MODE`, `INGEST_DIR`, `STATE_DB`, `CORS_ORIGINS`, `BRIDGE_TOKEN`). |
| `calibre-bridge/tests/` | pytest suite (OPF enrichment, store, API import/auth). |
| `calibre-bridge/{Dockerfile,docker-compose.yml,.env.example}` | Container scaffold that stands up CWA **and** the bridge together. |
| `calibre-bridge/README.md` | The bridge's user/operator doc (architecture, deploy modes, caveats). |
| `docs/` | The English wiki: architecture, userscript reference, metadata, lk-web-api, calibre-bridge, development. |

## Build / run / test

### Userscript
No build step — it's a single file. Install it directly into Tampermonkey, or run the Playwright verifiers (they read the file from disk and inject it live):

```bash
npm install
npm run playwright:install      # one-time: download chromium
npm run verify                  # verify/verify-userscript.mjs
npm run verify:webnovel
npm run verify:lib
```

### Bridge
```bash
cd calibre-bridge

# Full stack (CWA + bridge) via Docker:
cp .env.example .env            # optional: set BRIDGE_TOKEN
docker compose up -d --build
# CWA UI → http://localhost:8083   Bridge → http://127.0.0.1:8788
curl http://127.0.0.1:8788/api/health

# Local dev (no Docker):
uv sync --extra dev
uv run pytest                   # 14 tests (OPF enrichment incl. EPUB3 + EPUB2, store, API import/auth)
uv run uvicorn bridge.main:app --port 8788
```

> Trust `pytest` over any prose count (the suite spans `test_api.py` / `test_epub_meta.py` / `test_store.py`).

## Where to look for common tasks

| Task | Go to |
|---|---|
| Add/adjust a **reader feature** | The relevant render function in the userscript: `openArticle` (loads an aid, decides `stream` vs `series`), `renderStream` / `renderSeriesBody`, `openOutline` (left outline), minimap (`scheduleMinimap`). The launch button + SPA route watcher live near the bottom (`$('launch').onclick`, `onRoute`, `currentAid`). |
| Change **chapter splitting** | `chapterize(html)` (≈L117) and `splitBlocks` — handles in-text 目录 TOC markers and heading detection. Manual splits persist per-aid via `loadSplit`/`saveSplit`. |
| Change **EPUB output** | `buildEpub(bookTitle, author, srcUrl, chapters, coverUrl, onP, meta)` (≈L207) — embeds images via `gmBytes`, builds cover + OPF. |
| Change **rule-based metadata** | `extractCredits(raw)` (≈L905) — the BBCode-stripped 作者/插画/翻译/图源/录入 parser (simplified+traditional). `buildLibMeta(llm)` (≈L977) assembles the final meta object sent to the bridge. Mirror any OPF-shape change in `epub_meta.py`. |
| Add an **LLM provider** | `LLM_PRESETS` (≈L933) for the preset (`base`/`model`/`style`: `openai` or `anthropic`) and `extractMetaLLM(text)` (≈L950) for the request shape. Add a matching `@connect <host>` header. Caching lives in `ensureLLMMeta`/`setCachedMeta` (`LS_META`, per-aid, cross-account). |
| Change **OPF / Calibre metadata** | `calibre-bridge/bridge/epub_meta.py` (`enrich_opf_bytes`, `_set_text_single`, `_split_names`). Roles use MARC relators `aut`/`trl`/`ill`/`edt`/`bkp` with `dc:subject` tag fallbacks. **Version-aware:** EPUB3 `<meta refines property="role">` + `belongs-to-collection` (default), EPUB2 `opf:role` + `calibre:series` (fallback). |
| Add/change a **bridge endpoint** | `calibre-bridge/bridge/main.py`. Persist anything new via `store.py`; gate it with `_check_auth`. |
| Change **resume logic** | `acctId`/`LS_PROG` (account-scoped progress) and the history scan in `openArticle`-adjacent code (`/api/history/get-history`, ≈L1068) used to resume web novels at the last-read chapter. |

## Conventions

- **Single-file userscript.** Everything is one IIFE in `lightnovel-immersive-reader.user.js`. No bundler, no modules, no external runtime deps. Keep it vanilla JS.
- **Bump `@version`** in the userscript header on every behavioral change (it drives Tampermonkey auto-update). The header version — not `package.json` — is authoritative.
- **HTML escaping:** always wrap interpolated text with `esc()` (≈L92) when building markup; use `stripTags`/`htmlToText` to go the other way.
- **API envelope:** all site calls go through `apiCall(path, d)` (≈L62) → `POST /proxy<path>` with the JSON envelope `{is_encrypted:0, platform:'pc', client:'web', sign:'', gz:0, d:{browser_id, session_id, security_key?, ...params}}`, `credentials:'include'`, and a `code !== 0` → throw contract. Don't hand-roll fetches to `/proxy`.
- **Domain model:** an *article* (`aid`) = one chapter/post; a *series* (`sid`) groups articles. Two reader modes: `stream` (one long article, continuous scroll) and `series` (paged web novel).
- **Progress is account-scoped** by `uid` parsed from the site's `security_key` (`<hex>:<uid>:<exp>`), keyed under `LS_PROG`. Export/import is per-account. Never let one account's slice bleed into another's.
- **EPUB3 by default, EPUB2 fallback** (`settings.epubVer`). `buildEpub` and the bridge's `enrich_opf_bytes` are **version-aware**: EPUB3 writes `<meta refines property="role">` + `belongs-to-collection` + `dcterms:modified` (and cleans dangling `refines` on re-enrich); EPUB2 writes `opf:role` + `calibre:series`. `_split_names` splits multi-person credits into separate contributors. **EPUB3 output must stay epubcheck-clean** (validate via the Docker one-liner in `docs/development.md`).
- **Persistence is `localStorage` only** in the reader (`lkir_settings`, `lkir_ids`, `lir_meta_cache`, `lir_progress`, bookmark/split keys). The bridge's only state is its SQLite registry.

## Gotchas

- **`stripTags` collapses whitespace and kills newlines** (`\s+ → ' '`). For line-structured parsing (credits, TOC) use `htmlToText`, which preserves `\n`; `extractCredits` depends on per-line splitting.
- **The site's reported author is the *uploader***, not the novel's real author. The in-text `作者：` line (via `extractCredits`) is the truth and **overrides** the site nickname in `buildLibMeta`.
- **LK stores no within-article reading position** (verified: `article/get-detail` has none, series chapters carry no read flag). Web novels resume at the last-read *chapter* from `history/get-history`; single articles resume from **local** per-aid scroll memory only.
- **`GM_xmlhttpRequest` + `@connect`:** any cross-origin call (images via `gmBytes`, the bridge via `gmReq`, LLM APIs) must run through `GM_xmlhttpRequest` *and* have its host whitelisted in the `@connect` header. Forgetting `@connect` silently breaks the call. Currently whitelisted: `lightnovel.fun`, `127.0.0.1`, `localhost`, `api.deepseek.com`, `api.kimi.com`, `api.openai.com`, `api.moonshot.cn`.
- **Bridge reachability ≠ CORS.** Because `GM_xmlhttpRequest` runs in the extension context, it bypasses CORS/PNA/mixed-content, so the bridge can live anywhere reachable by IP/host. The CORS/PNA middleware in `main.py` exists only for page-context fetches (the Vue web app, the test shim) — don't assume the userscript needs it.
- **Two LLM wire protocols.** `style:'openai'` → `POST {base}/chat/completions` (Bearer auth); `style:'anthropic'` (Kimi Code at `api.kimi.com/coding`) → `POST {base}/v1/messages` (`x-api-key` + `anthropic-version`). `extractMetaLLM` branches on `style`; handle both when touching it.
- **`enrich_epub` is best-effort.** If OPF surgery throws, `main.py` falls back to importing the *original* bytes and reports `enrich_error` — don't let an enrichment change hard-fail an import.
- **Empty `docs/`** — don't link readers there expecting content.

## Hard rules

- **Never commit secrets.** The repo is private but holds **no** credentials. API keys (LLM) and the bridge token are entered at **runtime** — in the reader's settings (`localStorage`) and via the bridge's env (`BRIDGE_TOKEN`). Never hardcode keys/tokens in code, docs, or examples.
- **Keep it read-only and respectful.** This reads the site's own web API for personal reading. Don't add writes beyond what the user already does (`history/add-history`, to keep resume working), don't fetch aggressively, don't add polling/bulk-download loops.
- **Experimental features are opt-in and at the user's own risk.** The calibre-bridge integration and the cross-origin `@connect` (the local bridge + LLM hosts) connect to external services, the LLM path can cost money, and keys/token live in the browser's `localStorage`. They are collapsed-by-default and tagged 实验性 in the reader — keep them opt-in; never enable them by default.
- **Import-only bridge.** No progress/bookmark sync, no kosync, no reading-state DB. Reading position stays local to the reader; the bridge's one job is getting a well-tagged EPUB into CWA.
