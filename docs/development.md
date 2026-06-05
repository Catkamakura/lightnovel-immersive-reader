# Development Guide

How to develop, run, and test the **lightnovel-immersive-reader** project — the single-file Tampermonkey userscript and the optional `calibre-bridge` FastAPI companion.

## Prerequisites

| Tool | Needed for | Notes |
| --- | --- | --- |
| **Tampermonkey** (browser extension) | Manual / live testing of the userscript | Install `lightnovel-immersive-reader.user.js` directly; it runs on `https://www.lightnovel.fun/*`. |
| **Node.js** + `npm i` | The `verify/` Playwright harnesses | Installs the only devDependency, `playwright`. |
| `npx playwright install chromium` | Headless browser for the harnesses | One-time browser download. Also available as `npm run playwright:install`. |
| **uv** | The `calibre-bridge` (Python ≥ 3.11) | Runs the bridge and its pytest suite. |
| Running bridge on `:8788` | Only for `verify-lib.mjs` | See [Calibre bridge](#calibre-bridge). |

All Node commands are run from the **repo root** (`lightnovel-immersive-reader-repo/`), because each harness reads the userscript via the relative path `./lightnovel-immersive-reader.user.js`.

## The userscript

The reader is a single vanilla-JS IIFE in `lightnovel-immersive-reader.user.js` (~1370 lines), rendered into a Shadow DOM under host id `lkir-host`. There is no build step — edit the file and reload it in Tampermonkey.

### Syntax check

Before committing any userscript change, run a parse-only check:

```bash
node --check lightnovel-immersive-reader.user.js
```

This catches syntax errors without executing the script (which would fail outside a browser, as it depends on `GM_xmlhttpRequest`, `document`, etc.).

### Manual testing

1. Load the script in Tampermonkey.
2. Open a book on `https://www.lightnovel.fun/detail/<aid>`.
3. Click the floating **launch** button to open the immersive reader.

The harnesses use these live AIDs as fixtures; they are good manual test cases too:

| AID | Shape | Exercises |
| --- | --- | --- |
| `1144661` | Stream, multi-volume (分卷) | Layout, outline, split mode, bookmarks, minimap, guide, volume switch + URL sync |
| `1144697` | Big single article | Chapterized 目录, download, send-to-library |
| `1144698` | Web novel (series, paged) | Per-chapter bookmarks, paged rendering, chapter-range download |

## Verify harnesses (`verify/`)

All three are Playwright scripts that read the userscript from disk, inject a **GM shim** (a fetch-backed stand-in for `GM_xmlhttpRequest`), launch the real site headless, open the reader, and assert against the Shadow DOM. They exit non-zero on any failed check **or** any console/page error, so they double as CI gates. Each runs from the repo root.

| Harness | npm script | What it checks | Requirements |
| --- | --- | --- | --- |
| `verify/verify-userscript.mjs` | `npm run verify` | **32 checks** across groups A (layout/interactions on a stream multi-volume book: outline, split, grouped bookmarks + delete-confirm, theme swatches, settings toggle), D (no-edit-hover, minimap build + drag, guide spotlight/steps/auto-open), B (分卷 switch + URL sync on exit), C (big single article) | `npx playwright install chromium` |
| `verify/verify-webnovel.mjs` | `npm run verify:webnovel` | **7 checks** on a web-novel series: paged `.blk` rendering, per-chapter bookmarks (a different chapter shows only its own), minimap in series, numeric chapter-range download (two number inputs, default = ALL, named ends, clamps invalid input), and the guide **Skip** button responding to a *real mouse click* (regression guard for the `.guide-step` opacity stacking context) | same |
| `verify/verify-lib.mjs` | `npm run verify:lib` | End-to-end reader ↔ bridge: health (`mode=ingest`), 发送到书库 button, EPUB import with parsed metadata (title/translator/series/volume), success dialog, EPUB lands in the CWA ingest folder, book queryable via `/api/lookup` | **bridge running on `:8788`** + chromium |

### Running them

```bash
npm i                                  # once
npx playwright install chromium        # once

node verify/verify-userscript.mjs      # or: npm run verify
node verify/verify-webnovel.mjs        # or: npm run verify:webnovel
node verify/verify-lib.mjs             # or: npm run verify:lib  (needs the bridge up)
```

`verify-userscript.mjs` writes screenshots to `./_shots_userscript/` (e.g. `A1-open.png`, `D1-minimap.png`, `D2-guide.png`) for visual inspection.

### How the GM shim works

The userscript reaches the network only through `GM_xmlhttpRequest`. The harnesses replace it with a page-context shim:

- **`verify-userscript.mjs` / `verify-webnovel.mjs`** inject a trivial shim that proxies to `fetch()` — enough because all calls are same-origin to `lightnovel.fun`.
- **`verify-lib.mjs`** cannot use a page-context fetch: the bridge is `http://127.0.0.1:8788`, which a page-context `fetch` on the `https://` site can't reach (CORS / mixed-content / PNA). The real `GM_xmlhttpRequest` is *privileged* and bypasses all of that. So the shim is **routed through Node** via `page.exposeFunction('__bridgeFetch', …)`, faithfully simulating that bypass — including serializing `FormData`/`Blob` parts (base64 over the bridge) so the multipart EPUB upload works.

This is the practical reminder that **`GM_xmlhttpRequest` bypasses CORS**: any new external host the userscript talks to must be added to the `@connect` list in the metadata block (current hosts: `lightnovel.fun`, `127.0.0.1`, `localhost`, `api.deepseek.com`, `api.kimi.com`, `api.openai.com`, `api.moonshot.cn`).

## Calibre bridge

`calibre-bridge/` is a uv-managed FastAPI app (`bridge/` package, `pyproject.toml`, `Dockerfile`, `docker-compose.yml`).

### Run the bridge (for `verify:lib`)

```bash
uv run uvicorn bridge.main:app --host 127.0.0.1 --port 8788
```

Confirm with `GET http://127.0.0.1:8788/api/health` → should report `{ ok: true, mode: "ingest", … }`. `verify-lib.mjs` cleans and uses `calibre-bridge/_e2e/ingest` as the ingest folder.

### Bridge tests

```bash
uv run pytest
```

Tests live in `calibre-bridge/tests/` (`test_api.py`, `test_epub_meta.py`, `test_store.py`, `conftest.py`). `pytest` (and `anyio`) are in the `dev` optional-dependency group; `uv run` resolves them automatically.

## EPUB validation

The EPUB3 output (from `buildEpub`, and after the bridge's `enrich_epub`) is validated with **epubcheck**. There is no Java locally, so run it via Docker against the EPUB you want to check:

```bash
docker run --rm -v "$PWD":/data eclipse-temurin:17-jre \
  java -jar /data/epubcheck-5.1.0/epubcheck.jar /data/book.epub
```

- **EPUB3 (default) is epubcheck-clean — 0 errors.** Any change to `buildEpub` or to the bridge's EPUB3 enrichment path must keep it that way; re-run epubcheck after touching the OPF, the nav document, the cover wiring, or the `refines`/`belongs-to-collection`/`dcterms:modified` metadata.
- **EPUB2 (the user-selectable fallback) is a lenient-reader format.** epubcheck flags only the `HTM-004` doctype warning on it; that's expected for the EPUB2 path and is acceptable for the fallback (it targets lenient readers, not strict EPUB3 validation).

## Gotchas / conventions

- **`stripTags` collapses newlines.** The shared `stripTags(s)` (around line 85) ends with `.replace(/\s+/g, ' ')`, so it flattens all whitespace into single spaces. For **line-based parsing** (e.g. the credit/卷首 parser, which splits on `\n`), use **`htmlToText(html)`** (around line 199), which preserves line breaks. The LLM credit path and `extractCredits` both feed off `htmlToText`, never `stripTags`.
- **EPUB3 is the default output — do not regress to EPUB2-only.** `buildEpub` writes a real EPUB3 by default (`settings.epubVer: 3`): MARC roles via `<meta refines property="role" scheme="marc:relators">`, series via `belongs-to-collection` (plus `calibre:series` kept), a proper XHTML Navigation Document (`<nav epub:type="toc">` + manifest `properties="nav"`), `dcterms:modified`, and the cover via `properties="cover-image"`. It is **epubcheck-clean (0 errors)** — see [EPUB validation](#epub-validation). There's an **EPUB2 fallback** the user can choose (设置 → 下载 EPUB 版本 / setting `epubVer: 2`), which uses inline `opf:role="aut|trl|ill|edt|bkp"` and `calibre:series`. Keep both code paths; do not drop EPUB3 back to an EPUB2-only writer.
- **The bridge `enrich_epub` must stay version-aware.** `enrich_opf_bytes` detects the package `version` and writes the matching form: for EPUB3 it adds `<meta refines>` role/file-as/collection metadata, **cleans dangling `<meta refines="#id">`** when it removes the `dc:` element they point at (a dangling refines = invalid EPUB3), and refreshes `dcterms:modified`; for EPUB2 it writes `opf:role` attributes. Do not collapse this into a single-version writer or skip the dangling-refines cleanup.
- **Progress is account-scoped — never share across uids.** Reading state is keyed by the `uid` parsed from the site's `security_key` (`<hex>:<uid>:<exp>`) and is export/importable **per account**. Never write one account's progress under another `uid`, and keep import/export uid-isolated.
- **Never hardcode credentials.** The repo is private but contains **no secrets**. LLM API keys and the bridge token are entered at runtime (reader settings → `localStorage`; bridge → env). Do not add keys to source, docs, or tests.
- **`@connect` must list every host.** Because `GM_xmlhttpRequest` bypasses CORS, any new external endpoint requires a matching `@connect` line in the metadata block — otherwise Tampermonkey blocks the request even though the harness shim would let it through.
- **Bump `@version` on every userscript change.** The `// @version` line (currently `1.17.0`) drives Tampermonkey's update mechanism. `package.json` carries its own `version` field (kept in step at `1.17.0`); the authoritative reader version is the `@version` header, so always bump it when you touch the userscript.

### Relevant files

- `lightnovel-immersive-reader.user.js` — the reader (edit + `node --check`)
- `verify/verify-userscript.mjs`, `verify/verify-webnovel.mjs`, `verify/verify-lib.mjs` — harnesses
- `package.json` — npm scripts (`verify`, `verify:webnovel`, `verify:lib`, `playwright:install`)
- `calibre-bridge/pyproject.toml`, `calibre-bridge/tests/` — bridge deps + pytest suite
