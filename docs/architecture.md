# Architecture

This document explains how the two parts of **lightnovel-immersive-reader** fit together: the in-browser Tampermonkey userscript (`lightnovel-immersive-reader.user.js`) and the optional FastAPI companion (`calibre-bridge/`). It is written for both human contributors and LLM agents that will read, operate, and extend the code. Function names and file paths below are real — open them while reading.

## 1. Components at a glance

| Component | Lives in | Language / runtime | Job |
| --- | --- | --- | --- |
| Immersive reader | `lightnovel-immersive-reader.user.js` | Vanilla JS, single IIFE, Shadow DOM | Inject a clean reading overlay onto the live `www.lightnovel.fun`; read the site's own web API; export EPUB/TXT; optionally POST EPUBs to the bridge |
| Calibre bridge | `calibre-bridge/bridge/*.py` | Python 3, FastAPI, `uv`, Docker | Receive an EPUB + JSON metadata, enrich the OPF, drop it into a Calibre-Web-Automated (CWA) ingest folder (or `calibredb add`) |

The reader is fully usable **without** the bridge. The bridge is import-only: no progress sync, no bookmark sync, no kosync (see the module docstring in `calibre-bridge/bridge/main.py`).

## 2. High-level data flow

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │  Browser tab on https://www.lightnovel.fun  (the live site)  │
                         │                                                              │
                         │   site's own Vue app  ───────────────┐                       │
                         │                                      │ (untouched)           │
                         │   ┌──────────────────────────────────▼───────────────────┐  │
                         │   │  USERSCRIPT  (Shadow DOM under host id 'lkir-host')   │  │
                         │   │                                                       │  │
   READ PATH             │   │  apiCall(path, d)                                     │  │
   (same-origin fetch) ──┼───┤   POST /proxy/api/...  {is_encrypted,platform,client, │  │
                         │   │     sign,gz,d:{browser_id,session_id,security_key?,…}} │──┼──► www.lightnovel.fun
                         │   │   credentials:'include'  →  j.data                    │  │     /proxy/api/...
                         │   │                                                       │  │     (article/get-detail,
                         │   │  buildEpub() / buildTxt()  →  download()              │  │      get-content,
                         │   │                                                       │  │      series/get-article-list,
                         │   │  SEND-TO-LIBRARY:                                     │  │      history/get-history,
                         │   │  gmReq()→GM_xmlhttpRequest  POST .../api/import       │──┼──► (cross-origin,
   IMG PATH              │   │   (multipart: file=EPUB, meta=JSON)                   │  │      mixed-content,
   gmBytes()→GM_xhr  ────┼───┤                                                       │  │      PNA — needs GM_xhr)
   (cover/inline imgs)   │   │  LLM PATH (opt-in): gmReq→GM_xhr                      │──┼──► api.deepseek.com /
                         │   │   POST chat/completions | /v1/messages (Kimi)        │  │     api.openai.com /
                         │   └───────────────────────────────────────────────────────┘  │     api.kimi.com
                         └──────────────────────────────────────────────┬───────────────┘
                                                                        │
                                          GM_xmlhttpRequest (HTTPS page → http://127.0.0.1)
                                                                        │
                         ┌──────────────────────────────────────────────▼───────────────┐
                         │  calibre-bridge  (FastAPI, localhost:8788 / Docker)          │
                         │                                                              │
                         │  POST /api/import  (main.py:import_book)                     │
                         │    ├─ enrich_epub(raw, meta)   (epub_meta.py)  → OPF surgery │
                         │    ├─ import_epub(epub, …)     (calibre.py)                  │
                         │    │     mode=ingest    → write .part, rename → ingest_dir ──┼──► /cwa-book-ingest
                         │    │     mode=calibredb → calibredb add --library-path …  ───┼──► /calibre-library
                         │    └─ store.upsert_book(aid, …)  (store.py) → state.sqlite3  │
                         │                                                              │
                         │  GET /api/health · /api/lookup · /api/books                  │
                         └──────────────────────────────────────────────┬───────────────┘
                                                                        │ filesystem
                         ┌──────────────────────────────────────────────▼───────────────┐
                         │  Calibre-Web-Automated watches the ingest folder, imports     │
                         │  the EPUB, reads the enriched OPF for title/author/series/…    │
                         └───────────────────────────────────────────────────────────────┘
```

## 3. Why a userscript, and why `GM_xmlhttpRequest`

The reader runs as a Tampermonkey userscript (`@match https://www.lightnovel.fun/*`, `@run-at document-idle`) rather than an extension or a separate app for three reasons:

1. **It needs the site's own logged-in session.** The reader talks to the site's private web API as the user. `apiCall()` does a plain same-origin `fetch('/proxy' + path, { credentials:'include' })`, so the browser attaches the user's cookies automatically and the request looks exactly like the site's own traffic. No re-login, no token handling.
2. **It augments rather than replaces the site.** The overlay is injected *on top of* the live Vue app, which keeps running untouched underneath (see §5).
3. **It can bypass browser network restrictions where the same-origin `fetch` can't.** `fetch` is fine for same-origin `/proxy/...`, but three other request classes are blocked from a page running on a public HTTPS origin:
   - **Cover/inline images** for EPUB embedding (`gmBytes()`): often `http://` or third-party hosts → mixed-content / cross-origin.
   - **Send-to-library** (`gmReq()` → `libImport()`): an HTTPS page calling `http://127.0.0.1:8788` is both **mixed content** and a **Private Network Access (PNA)** request, which page-context `fetch` refuses.
   - **LLM metadata** (`gmReq()` → `extractMetaLLM()`): cross-origin POST to `api.deepseek.com` / `api.openai.com` / `api.kimi.com`.

   `GM_xmlhttpRequest` runs outside the page's network sandbox, so it sidesteps CORS, PNA, and mixed-content for exactly the hosts allow-listed in the header:

   ```js
   // @connect lightnovel.fun
   // @connect 127.0.0.1
   // @connect localhost
   // @connect api.deepseek.com
   // @connect api.kimi.com
   // @connect api.openai.com
   // @connect api.moonshot.cn
   ```

   `gmReq(opts)` is the Promise wrapper around `GM_xmlhttpRequest`; `gmBytes(url)` is a specialized one that returns `{bytes, mime}` for images.

Because `GM_xmlhttpRequest` already bypasses CORS/PNA, **the bridge's CORS handling is not for the userscript** — it exists for the Vue web app and any page-context `fetch`/test harness (see the docstring on the `cors_pna` middleware in `main.py` and the `cors_origins` comment in `config.py`).

### The `/proxy/api` envelope

Every API call wraps params in a fixed JSON envelope (built once in `apiCall`):

```json
{ "is_encrypted": 0, "platform": "pc", "client": "web", "sign": "", "gz": 0,
  "d": { "browser_id": "b_…", "session_id": "s_…", "security_key": "<hex>:<uid>:<exp>", ...params } }
```

- `browser_id` / `session_id` are random ids minted once and persisted in `localStorage['lkir_ids']`.
- `security_key` is **not** generated — `findSecurityKey()` scans `localStorage` for the site's own auth token (regex `^[a-f0-9]{16,}:\d+:\d+$`, or embedded in a JSON value). It is only included if found.
- Responses are unwrapped as `j.code !== 0 ? throw : j.data`.

Thin wrappers over `apiCall`: `getDetail(aid)`, `getContent(aid)`, `getSeries(sid)` (sorted by `order`), `addHistory(aid)`, and the history scan inside `lastReadAid()`.

## 4. The model: articles, series, modes

- **article (`aid`)** = one chapter/post. **series (`sid`)** = a group of articles.
- The reader has two **modes** (`S.mode`):
  - `'stream'` — one long article chapterized into editable sections, continuous scroll.
  - `'series'` — a web novel, paged chapter-by-chapter (one `aid` per chapter).
- `S.mode2` is the interactive sub-mode for stream/series: `'read'` | `'split'` | `'bookmark'`.

### How a book is classified (`openArticle`)

1. Fetch `getContent(aid)` + `getDetail(aid)` in parallel; `chapterize(raw)` runs the auto-chapterizer.
2. **If the article self-chapterizes** (in-text 目录/CONTENTS block parsed by `chapterize`, `≥2` bounds) **or the user has a saved manual split** (`loadSplit(aid)`) → **stream** mode, done.
3. Otherwise render as a single stream section, then if `detail.sid > 0`, fetch the series list and decide:
   - `series.length <= 1` → `volumes` (just sibling volumes in the outline).
   - `series.length >= MANY_CHAPTERS` (20) → **series** (web novel).
   - in between → sample a couple of sibling articles' lengths; if any reaches `VOL_LEN` (25 000 chars) treat them as **volumes**, else **series**. Constants: `MANY_CHAPTERS`, `VOL_LEN`, `DL_MIN_LEN` (top of file).

The chapterizer (`chapterize` / `splitBlocks` / `HEAD_RE` / `TOC_MARKER`) is keyword-agnostic first (it finds the in-text 目录 and matches its entries against body headings, tolerant of simplified/traditional via `norm`), and falls back to a heading-regex scan only when no usable TOC exists. Nothing is deleted; section boundaries (`S.bounds`) are derived and user-editable.

## 5. The Shadow-DOM overlay

All UI lives inside a single Shadow root to isolate it completely from the site's CSS/JS:

```js
const host = document.createElement('div'); host.id = 'lkir-host';
document.documentElement.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>${CSS}</style> …overlay markup…`;
const $ = (id) => root.getElementById(id);
```

- `:host { all: initial; }` plus a scoped `CSS` string means the site cannot leak styles in and the overlay cannot leak styles out.
- The overlay (`#overlay`) is `position:fixed; inset:0; z-index:2147483000` and only `display:block` when `.open`. While open, `document.documentElement.style.overflow='hidden'` freezes the page behind it.
- The site's own Vue app keeps running underneath; the reader never unmounts or edits it. On close it may `history.replaceState` the address bar to the last-read `/detail/<aid>` so the page behind matches what was read (`closeReader`).
- **SPA awareness:** `history.pushState`/`replaceState` are monkey-patched and `popstate` is hooked; `onRoute()` (also polled every 800 ms) shows/hides the 📖 launch button, auto-opens on `/detail/<id>` when `settings.autoOpen`, and auto-closes when navigating away. `injectCardButtons()` (driven by a `MutationObserver`) adds a per-card 📖 button on list pages.

## 6. Where ALL state lives

### Browser `localStorage` (the reader owns its state)

| Key | Shape | Written by | Purpose |
| --- | --- | --- | --- |
| `lkir_settings` (`LS_SETTINGS`) | `DEFAULTS`-merged object | `saveSettings()` | Theme, font, width, toggles, bridge URL/token, LLM provider/key/model, `resume`, `autoOpen`, `epubVer` (3 default / 2) |
| `lkir_ids` (`LS_IDS`) | `{ browser_id, session_id }` | init block | Stable envelope ids for `apiCall` |
| `lkir_split_<aid>` (`SPLIT_KEY`) | `{ bounds: number[] }` | `saveSplit()` | Per-article **manual** chapter split; presence forces stream mode |
| `lkir_bm_<aid>` (`BM_KEY`) | `[{ bi, label }]` | `saveBM()` | Bookmarks. Keyed per **chapter aid** in series mode (`curBmAid()`), per book aid in stream mode |
| `lir_progress` (`LS_PROG`) | `{ <uid>: { <aid>: {p,t} } }` | `saveProg()` | **Account-scoped** scroll resume for single-article books (see §7) |
| `lir_meta_cache` (`LS_META`) | `{ <aid>: {fields…, _t, _model} }` | `setCachedMeta()` | Per-book LLM metadata cache; book-level, shared across accounts |

The live in-memory state is the `S` object, rebuilt per book by `resetState(aid)`. Key fields: `aid, detail, raw, rawLen, author, bookTitle, mode, mode2, blocks, bounds, sections, catalog, cat, bookmarks, toc, labels, idx, volumes, downloadable`. Settings load merges `DEFAULTS` with the stored JSON so new keys get safe defaults.

### Bridge (the only server-side state)

`store.py` — a tiny SQLite catalog at `STATE_DB` (default `/data/state.sqlite3`), one table `books` (PK `aid`: `calibre_id, title, author, translator, lk_url, series, volume, updated, created_at, imported_at`). It is used only for the `/api/health` count and the `/api/lookup` "already imported?" check. **There is no reading-state table** — the bridge never stores progress or bookmarks (see the `store.py` module docstring). The actual book files live in the CWA ingest folder / Calibre library, not in the bridge.

## 7. Resume design (and why it's split)

**Verified fact that drives the whole design:** LK keeps **no within-article reading position** anywhere — `article/get-detail` has none, and series chapters carry no read flag. Its only progress signal is `history/get-history` (recency-ordered list of read `aid`s). See the comment block above `LS_PROG` in the userscript.

So resume is split by what LK can and can't tell us:

| Book kind | Resume unit | Source | How |
| --- | --- | --- | --- |
| Web novel (`series`) | last-read **chapter** | LK's own history | `lastReadAid(aidSet)` scans up to 4 pages of `history/get-history` and returns the most-recently-read `aid` in this series; `openArticle` starts there if the user opened at the beginning |
| Single article (`stream`) | exact **scroll %** | local, account-scoped | `saveProg`/`getProg`/`restoreProg` against `lir_progress` |

This means no server round-trip and no two-way sync. Scroll progress is **account-scoped by `uid`**: `acctId()` parses the `uid` out of the site's `security_key` (`<hex>:<uid>:<exp>`), so two people sharing a browser — or an imported file from another account — never bleed into each other. `exportProg()` exports only the current account's slice; `importProg()` merges each account into **its own** `uid` namespace (newer `t` wins). Progress is only saved between ~3% and ~98.5% (`saveProg`), and only restored when the reader is still sitting at the top (`restoreProg`), re-pinning as lazy images settle (`pinScroll`).

## 8. Send-to-library path (reader → bridge → CWA)

1. User opens the download dialog (`openDlg`) and picks **发送到书库** (`doSendToLib`), available only when `settings.libEnable`.
2. `gatherBook()` collects chapters (series: optional range; stream: sections from `S.bounds`).
3. Metadata is assembled by `buildLibMeta(llm)`:
   - Base: site title/author + the **in-text** credit block from `extractCredits(S.raw)` (rule-based, simplified+traditional, BBCode-stripped: 作者/插画/翻译/图源/录入/原作). **The site's reported author is the uploader; the real 作者 from the text wins.**
   - Series/volume derived from `S.volumes`; tags/date from `detailTags`/`detailDate`.
   - If LLM is enabled, `ensureLLMMeta(aid)` (cache-first; only the short 卷首 block is sent) overrides fields via `metaPick`.
4. `buildEpub()` produces a valid EPUB in-browser (`makeZip` writes the ZIP byte-for-byte; `mimetype` stored first). It emits **EPUB3 by default** (`settings.epubVer` = 3) — MARC relator roles via `<meta refines property="role" scheme="marc:relators">`, series via `belongs-to-collection`, a proper XHTML Navigation Document (`<nav epub:type="toc">`, manifest `properties="nav"`), `dcterms:modified`, and the cover via `properties="cover-image"`; it's epubcheck-clean. The user can fall back to **EPUB2** (`settings.epubVer` = 2), which writes `opf:role` + `calibre:series` instead. Either way the OPF carries full credits (`aut`/`trl`/`ill`/`edt`/`bkp`) plus `dc:subject` tag fallbacks for roles Calibre has no native column for, and the EPUB is always self-contained (un-embeddable images are dropped).
5. `libImport(meta, bytes, name)` POSTs `multipart/form-data` (`file`=EPUB, `meta`=JSON) to `<libUrl>/api/import` via `gmReq`, with optional `Authorization: Bearer <token>` (`libHeaders`).
6. Bridge `import_book` (`main.py`): checks the token (`_check_auth`), requires `meta.aid`, runs `enrich_epub(raw, meta)` (re-does the OPF surgery server-side in `epub_meta.py`, mapping the same metadata onto Dublin-Core + Calibre OPF2 `meta` for series/volume; falls back to the raw file if surgery fails). The enrich is **version-aware** — it reads the OPF `version` attribute and writes `<meta refines property="role">` for EPUB3 (cleaning any dangling refines and refreshing `dcterms:modified`) or `opf:role` for EPUB2. Then `import_epub` either drops the file atomically into `ingest_dir` (`ingest`) or runs `calibredb add` (`add_via_calibredb`), and records it via `store.upsert_book`.
7. CWA watches the ingest folder, imports the EPUB, and reads the enriched OPF for organized metadata.

The plain **EPUB/TXT download** path (`doExport`) is identical up to step 4/5 but writes a local file via `download()` instead of POSTing; like the send path, it triggers the LLM (cached per book) when LLM tidy-up is enabled, otherwise it reuses any cached result.

## 9. LLM metadata path (optional)

Rule-based parsing is brittle, so an opt-in LLM pass can tidy metadata. It sends **only** the short credit/卷首 block (`metaHeaderText()`, ≤1500 chars of `htmlToText(S.raw)`) — never the book; images carry no info. Two protocol styles are supported (`LLM_PRESETS`, `extractMetaLLM`):

- **OpenAI-compatible** (OpenAI / DeepSeek default): `POST <base>/chat/completions`, `Authorization: Bearer`.
- **Anthropic** (Kimi Code at `api.kimi.com/coding`): `POST <base>/v1/messages` with `x-api-key` + `anthropic-version`.

The system prompt (`LLM_SYS`) asks for a compact JSON; `parseJsonLoose` tolerates fenced/extra text. Results are cached per book in `lir_meta_cache`, so 10 downloads cost at most one call (`ensureLLMMeta`). **Keys are entered at runtime and stored only in `localStorage`** — never hardcoded; the repo is private and contains no secrets. Bridge auth uses the env var `BRIDGE_TOKEN` (`config.py`), entered in the reader's settings as `libToken`.

> **Experimental / at your own risk:** the calibre-bridge integration and the userscript's cross-origin `@connect` (to the local bridge and to the LLM hosts `api.deepseek.com` / `api.kimi.com` / `api.openai.com` / `api.moonshot.cn`) are experimental. They reach external services, may incur cost (LLM), and store keys/token in the browser's `localStorage` — use them at your own risk. In the settings panel, the **发送到书库 (Calibre)** and **LLM 整理元数据** sections are collapsed by default and tagged 实验性.

## 10. Bridge HTTP surface

| Endpoint | Handler | Notes |
| --- | --- | --- |
| `GET /api/health` | `health` | Returns `{ok, version, mode, ingest_dir, library_dir, calibredb, books}` — used by the settings "测试连接" button |
| `POST /api/import` | `import_book` | multipart `file` + `meta`; enrich → import → upsert |
| `GET /api/lookup?aid=` | `lookup` | "is this already imported?" |
| `GET /api/books` | `books` | catalog dump |

CORS/PNA for browser callers is handled by the custom `cors_pna` middleware (Starlette's built-in `CORSMiddleware` rejects PNA preflights). Config is env-driven (`config.py`): `BRIDGE_MODE` (`ingest` | `calibredb`), `INGEST_DIR`, `LIBRARY_DIR`, `STATE_DB`, `CALIBREDB`, `CORS_ORIGINS`, `BRIDGE_TOKEN`.

## 11. Key files

- `lightnovel-immersive-reader.user.js` — the entire reader (one IIFE). Notable functions: `apiCall`, `openArticle`, `chapterize`, `renderStream`/`renderSeriesBody`, `buildEpub`/`buildTxt`/`makeZip`, `extractCredits`/`buildLibMeta`/`extractMetaLLM`, `saveProg`/`restoreProg`/`lastReadAid`, `doSendToLib`/`libImport`, `buildMinimap`, `onRoute`/`injectCardButtons`.
- `calibre-bridge/bridge/main.py` — FastAPI app, CORS/PNA, `/api/*` routes.
- `calibre-bridge/bridge/epub_meta.py` — `enrich_epub` / `enrich_opf_bytes` OPF surgery.
- `calibre-bridge/bridge/calibre.py` — `import_epub` (ingest vs `calibredb`).
- `calibre-bridge/bridge/store.py` — SQLite `books` catalog.
- `calibre-bridge/bridge/config.py` — env-driven `Config`.
