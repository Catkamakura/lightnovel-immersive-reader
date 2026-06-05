# `lightnovel-immersive-reader.user.js` — Developer / LLM Reference

A single-file Tampermonkey userscript that injects a clean, Google-Docs-style **immersive reader** onto the live site `www.lightnovel.fun` *without replacing it*. Everything lives in one IIFE; the UI is mounted in a Shadow DOM so the host page's CSS can never touch it. This document maps the code so a human or an LLM agent can read, operate, and extend it.

> File: `lightnovel-immersive-reader.user.js` · `@version 1.17.0` · vanilla JS, no dependencies.

---

## 1. Top-level shape (IIFE + Shadow DOM)

The whole script is one `(function () { 'use strict'; … })()` IIFE (opens line 21, closes line 1427). There is no module system and no global leakage beyond the host element.

### Mount point and Shadow root

```js
const host = document.createElement('div'); host.id = 'lkir-host';
document.documentElement.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>${CSS}</style> … overlay markup …`;
const $ = (id) => root.getElementById(id);
```

- Host element id: **`lkir-host`** (appended to `<html>`, not `<body>`).
- All styling is inlined via the `CSS` template (lines 312–461) with `:host { all: initial; }` to fully isolate from the page. `$(id)` is the shadow-scoped `getElementById` used everywhere.
- `z-index` of the overlay is `2147483000`; the floating launch button sits even higher (`2147482000` on `.launch`, but the open overlay covers it).

### Key element ids (created in `root.innerHTML`, lines 465+)

| id | Element | Role |
|---|---|---|
| `launch` | `.launch` button | "📖 沉浸阅读" floating launcher (only on `/detail/:aid` pages) |
| `overlay` | `.overlay` | The full-screen reader container; gets state classes (`open`, `ol-on`, `mm-on`, `panel-open`, `splitting`, `marking`, `guide-reveal`) |
| `progress` | `.progress` | Top reading-progress bar |
| `clLeft` / `t-outline` / `t-dlCorner` / `t-set` | left cluster | Outline toggle, download corner (hover-revealed), settings gear |
| `scroll` | `.scroll` | The scroll container (the element whose `scrollTop` everything reads) |
| `content` | `.content` | Where article HTML is rendered |
| `outline` / `outlineTitle` / `outlineTabs` / `outlineNote` / `outlineList` | left panel | The Google-Docs outline (drawn *in-flow*, transforms in; does not push content) |
| `minimap` / `mmCanvas` / `mmView` | right rail | Opt-in Sublime-style minimap |
| `curChip` | `.cur-chip` | Bottom-left "current chapter" chip |
| `close` | `.exit-btn` | "✕ 退出" |
| `rail` / `r-prev` / `r-next` / `r-top` | right floating rail | Prev/next chapter, back-to-top |
| `setPanel` / `setBody` / `setClose` | right slide-in | Settings panel |
| `dlg` / `dlgT` / `dlgMsg` / `dlRange` / `dlFrom` / `dlTo` / `dlgActs` / `dl-lib` / `dl-epub` / `dl-txt` / `dlgClose` | download dialog | Export / send-to-library modal |
| `guide` / `guideSpot` / `guideStep` / `guideTitle` / `guideBody` / `guidePrev` / `guideNext` / `guideDots` / `guideSkip` | feature guide | Re-openable step-by-step tour |
| `scrim` | `.scrim` | Dim backdrop behind panel / mobile outline |
| `toast` | `.toast` | Transient toast (`flashToast`) |

---

## 2. The `S` state object

There is **one** mutable state object `S` (declared `let S = {}` near line 503), reset for each opened article by `resetState(aid)` (lines 508–512). It is *not* class-based — it's a plain bag of fields. Everything that renders reads from `S`.

```js
function resetState(aid) {
  S = { aid, detail: null, raw: '', rawLen: 0, author: '', bookTitle: '', busy: false,
        mode: 'stream', mode2: 'read',
        blocks: [], bclean: [], bounds: [], catalog: [], sections: [], secLabels: [], cat: [], catLabels: [],
        manualSplit: false, cblocks: [], cbclean: [],
        bookmarks: [], bmConfirm: null, outlineTab: 'toc', toc: [], idx: 0, volumes: [], volLabels: [], downloadable: false };
}
```

### Field reference

| Field | Meaning |
|---|---|
| `aid` | Current article id (the book/chapter being read) |
| `detail` | Raw `article/get-detail` payload (title, author, sid, cover, dates…) |
| `raw` | Raw content HTML from `article/get-content` |
| `rawLen` | `textLen(raw)` — visible text length, drives download/volume heuristics |
| `author` | Uploader nickname (`detail.author.nickname`) — **note: uploader, not the real author** |
| `bookTitle` | Cleaned title (`cleanTitle`) |
| `busy` | True while an export/send is running (blocks dialog close) |
| `mode` | **`'stream'`** (one long article chapterized, continuous scroll) or **`'series'`** (web novel, paged per chapter) |
| `mode2` | Interactive sub-mode for stream/series: `'read'` \| `'split'` \| `'bookmark'` |
| `blocks` | `splitBlocks(raw)` output — `[{html, text}]`, the per-paragraph units (stream) |
| `bclean` | Lazy cache of cleaned per-block HTML (`blkHtml`) for `blocks` |
| `bounds` | Sorted block indices that start a chapter (the section boundaries) |
| `catalog` | The detected in-text 目录 entries `[{title, bound}]` (bound may be `null` = "未完成") |
| `sections` | Built by `buildSections()`: `[{title, start, end, head}]` |
| `secLabels` | `chapterLabels(sections…)` — common-prefix-stripped section labels |
| `cat` | Outline catalogue rows `[{title, sec, empty}]` |
| `catLabels` | Labels for `cat` |
| `manualSplit` | True once the user edited boundaries (split persisted per aid) |
| `cblocks` / `cbclean` | Series mode: current chapter's blocks + clean cache |
| `bookmarks` | `[{bi, label}]` — per-chapter (series) or per-book (stream) |
| `bmConfirm` | The `bi` currently awaiting a delete-confirm click |
| `outlineTab` | Active outline tab: `'toc'` \| `'bm'` \| `'vol'` |
| `toc` | Series mode chapter list `[{aid, title, html}]` (html lazy-loaded) |
| `idx` | Series mode: index of the current chapter in `toc` |
| `labels` | Series mode chapter labels (set in `openArticle`/`renderChapter`, not in `resetState`) |
| `volumes` / `volLabels` | Sibling volumes of a single-article book (from `getSeries`) |
| `downloadable` | Whether the ⤓ download corner is shown |

Module-level companions to `S`:

- `savedScroll` — remembered scroll position for the back-to-top toggle.
- `pageAid` — the aid the underlying site page is showing (null if opened from a list); used to keep the address bar in sync on close.
- `suppressOpen` / `suppressTocHover` — short-lived UI guards.

---

## 3. API layer (same-origin web API + envelope)

The reader talks to the site's own JSON API by POSTing to **`/proxy/api/...`** (same-origin, so cookies ride along). Every request is wrapped in the site's "envelope".

### `apiCall(path, d)` — lines 62–69

```js
const body = { is_encrypted: 0, platform: 'pc', client: 'web', sign: '', gz: 0,
  d: Object.assign({ browser_id, session_id }, sk ? { security_key: sk } : {}, d) };
fetch('/proxy' + path, { method: 'POST', credentials: 'include', body: JSON.stringify(body) });
// throws on j.code !== 0, else returns j.data
```

- `browser_id` / `session_id` are random ids persisted in `localStorage['lkir_ids']` (generated by `randId`, lines 50–54).
- `security_key` is injected only if found.

### `findSecurityKey()` — lines 55–59

Scans **all** of `localStorage` for a value matching `^[a-f0-9]{16,}:\d+:\d+$` (the raw key) or embedded as `"security_key":"<hex>:<uid>:<exp>"`. The middle `\d+` is the **uid** (account id) — see `acctId()`.

### Endpoint helpers (lines 70–73)

| Helper | Endpoint | Returns |
|---|---|---|
| `getDetail(aid)` | `/api/article/get-detail` | detail object |
| `getContent(aid)` | `/api/article/get-content` | `data.content` HTML string |
| `getSeries(sid)` | `/api/series/get-article-list` | article list **sorted by `order`** |
| `addHistory(aid)` | `/api/history/add-history` | fire-and-forget (records read history) |

`lastReadAid(aidSet)` (lines 1100–1117) pages `/api/history/get-history` (up to 4 pages) and returns the first aid that is in the series — this is how web novels resume at the last-read chapter.

### `acctId()` — line 1052

`acctId()` parses the **uid** out of the security key (`<hex>:(uid):exp`), defaulting to `'anon'`. Reading progress is partitioned by this id so two accounts sharing one browser never bleed into each other.

### Binary fetches

`gmBytes(url)` (lines 74–82) uses `GM_xmlhttpRequest` (arraybuffer) to fetch images/covers cross-origin for EPUB embedding. `gmReq(opts)` (line 935) is the generic Promise wrapper used by the Calibre bridge and LLM calls.

---

## 4. Chapterization

The core trick: **detect the in-text 目录 (table of contents) block** and use it to find chapter boundaries — this is keyword-agnostic and works across simplified/traditional. A heading regex is only a *fallback*.

### `chapterize(html)` — lines 117–172

Pipeline:

1. **`splitBlocks(html)`** (line 116) splits on `<br>`, `<p>`, `<div>`, `<h1-6>` into `[{html, text}]`.
2. Find the `TOC_MARKER` line (`目录` / `CONTENTS` / `もくじ`, line 111) within the first 500 blocks; collect the run of short lines after it as `rawToc`. The TOC ends when an earlier entry *re-appears* in the body (exact repeat, or one line containing ≥2 earlier entries — the combined `【第一话】 副标题` body heading).
3. Group label-only lines (`【第一话】`, bare `第N话`) with the following subtitle line (`labelOnly`, line 114).
4. Match each group in the body in document order (loose `contains`, `norm`-folded), producing `toc = [{title, bound}]`. `bound = null` means the chapter is listed but not present (greyed "未完成").
5. **Fallback** (`bounds.length < 2`): use the bracket-tolerant `HEAD_RE` (line 110) and keep only headings with ≥400 chars of body between them.

Returns `{ blocks, bounds, toc }`. Nothing is deleted — heading lines stay inline; sections derive from `bounds` (so the user can re-split freely).

Key normalization helpers: `norm` (line 87, folds full-width digits/letters and common traditional heading chars to simplified, lowercases), `stripBrackets`, `isHead`, `labelOnly`.

### Stream sections vs series chapters

- **Stream** (`mode: 'stream'`): one article, `bounds` cut it into `sections`. `buildSections()` (lines 553–568) turns `bounds` into `[{title, start, end, head}]`, prepends a `卷首` section if content precedes the first boundary, and builds `cat`/`catLabels` (preferring the full detected `catalog` when not manually split).
- **Series** (`mode: 'series'`): a web novel; `S.toc` is the list of chapter aids, each rendered on its own page via `renderChapter`. The decision happens in `openArticle` (see §9).

---

## 5. Rendering

Blocks are rendered as inline **`.blk` spans** (one per paragraph) carrying `data-bi="<index>"`. This is what makes per-block bookmarking and click-to-split possible.

| Function | Lines | Role |
|---|---|---|
| `renderStream(keep)` | 569–596 | Renders all sections for stream mode; each `<section class="ch" id="ch-N">` holds a `.ch-sep` (or editable separator in split mode) + `.ch-inner` of `.blk` spans. Appends the "全书完" tail with the "核对原文末尾" check. Wires `onBodyClick`, then `updateChrome()` + `buildMinimap()`. |
| `renderChapter(i)` | 635–645 | Series mode: loads chapter `i`'s HTML (`ensureHtml`), calls `addHistory`, rewrites the URL to `/detail/<aid>`, splits into `cblocks`, loads that chapter's bookmarks, then `renderSeriesBody()`. |
| `renderSeriesBody(keep)` | 646–664 | Series mode: renders the single current chapter as `.blk` spans + a `.foot` with prev/目录/next buttons. |
| `blkHtml/blockHtml` | 550–551 | Lazily cleans a block's HTML (`lightClean`, lazy-load images, `//` → `https://`) and caches it. |
| `showTail` | 597–603 | Toggles the "last 12 source lines" anti-truncation check box. |

`.blk` interactivity is driven by CSS classes on `.body`: `interactive`, `splitting`, `marking` (see CSS lines 422–425), set from `mode2`. Bookmarked blocks get the `bm` class + an inline `🔖` `.bm-mark`.

---

## 6. Navigation

| Function | Lines | Role |
|---|---|---|
| `pinScroll(targetFn)` | 671–676 | **Instant** scroll that re-pins at `[60,180,360,650]ms` as nearby lazy images finish loading (which shift the target down). Aborts the moment the user scrolls (`Math.abs(... ) <= 2` guard). This is the backbone of every jump. |
| `scrollToSec(i)` | 677 | Jump to `#ch-i` (stream) via `pinScroll`. |
| `secTop(el)` | 549 | Element top relative to the `scroll` container. |
| `streamCur()` | 667 | Which section is currently at the top (top + 90px probe). |
| `goPrev()` / `goNext()` | 678–679 | Series: `renderChapter(idx±1)`. Stream: move between sections (goPrev re-targets the current section's top first, so one press snaps to the heading before stepping back). |
| `toggleTop()` / `updateTopBtn()` | back-to-top | Remembers `savedScroll` and flips the button to "返回". |

Keyboard: `←`/`→` map to `goPrev`/`goNext`; `Esc` unwinds the deepest open layer (guide → split → bookmark → dialog → settings → mobile outline → close). See the `keydown` handler at lines 1385–1390.

---

## 7. The minimap (Sublime-style)

Opt-in (`settings.minimap`), desktop + stream/series only (`minimapOn()`). It draws an **offscreen full-document canvas once**, then blits the visible slice on scroll.

| Function | Lines | Role |
|---|---|---|
| `buildMinimap()` | 1195–1251 | Draws the whole book onto an offscreen canvas `mm._full`: faint alternating per-chapter bands, striped mini "lines" (shorter last line per paragraph), **real image thumbnails** (`drawImage` when the image is loaded), indigo chapter divider lines + numbered tabs, and amber bookmark ticks. Re-runs on late-loading images. Positions the minimap just *left* of the kept native scrollbar (`mm.style.right = scrollbarWidth`). |
| `syncMinimap()` | 1252–1268 | Blits the visible slice of `mm._full` to the on-screen `mmCanvas` (devicePixelRatio-aware) and positions the `mmView` window. For tall books the map itself scrolls (`offset`). |
| `minimapDragTo(clientY)` | 1269–1275 | "Scrub" mode — drag the viewport box; instant (no smooth) so it tracks the cursor. |
| `minimapGoTo(clientY)` | 1282–1286 | **Click-to-content**: jump so the content drawn at the clicked minimap pixel lands centered, using the slice offset/scale **snapshotted at pointer-down**. |
| `scheduleMinimap(d)` | 1287 | Debounced rebuild. |

### The frozen-snapshot trick (click-to-content)

The minimap is a scaled slice of the *whole* document, so `contentY = (sliceOffset + cursorY) / scale`. On `pointerdown` (lines 1359–1368) the handler decides scrub vs goto: grabbing the viewport box → `'scrub'`; clicking elsewhere (e.g. a thumbnail) → `'goto'`, where it snapshots `mmOff = mm._offset` and `mmScaleSnap = mm._scale` into module vars. `minimapGoTo` uses **those snapshots**, not the live values. Reason (commented at lines 1276–1281): the jump scrolls the page, which re-renders the minimap slice; reading the live offset on the follow-up `pointermove` would make a plain click **double-jump** to the wrong spot. Pointer capture is used so the drag follows the cursor even over the host site's own handlers.

---

## 8. Bookmarks

Per-block bookmarks stored in `localStorage` under `BM_KEY(aid)` = `'lkir_bm_' + aid`.

- **`curBmAid()`** (line 525) — the critical scoping rule: web novels (`mode === 'series'`) bookmark per **chapter aid** (`S.toc[S.idx].aid`); a chapterized single article bookmarks per **book** (`S.aid`).
- `loadBM` / `saveBM` (lines 523, 526), `toggleBookmark(bi)` (lines 612–621), `jumpToBlock(bi)` (via `pinScroll`).
- `renderBookmarks(list)` (lines 750–798): stream bookmarks are grouped by the section they fall in; series bookmarks are a flat list under the current chapter title. Delete requires a hover + a `✕`→"确认删除" two-step (`bmConfirm`, auto-resets after 2.8s).
- Entering bookmark mode is wired through the outline's 书签 tab → `selectOutlineTab('bm')` → `enterMode('bookmark')` (lines 693–702, 622–630).

---

## 9. Resume (continue reading)

Verified premise (commented near line 1086): **LK stores no within-article position anywhere.** So:

- **Web novels** resume at the last-read **chapter** from LK's own history — `lastReadAid` matches by aid (handled inside `openArticle`).
- **Single-article books** resume from a **local per-aid scroll fraction**.

Progress is account-scoped under `LS_PROG = 'lir_progress'`, shape `{ <uid>: { <aid>: {p, t} } }`:

| Function | Lines | Role |
|---|---|---|
| `acctId()` | 1052 | uid from the security key (`'anon'` fallback) |
| `progAll()` / `getProg(aid)` | 1054–1055 | Read the active account's slice |
| `saveProg(aid, pct)` | 1056–1062 | Save (only between 3% and 98.5%, else delete), stamped with `Date.now()` |
| `restoreProg(aid, announce)` | 1086–1097 | On load, `pinScroll` to `pct * maxScroll` — but only if still at the top and content hasn't changed under us (`curBmAid() !== aid` guard) |
| `scheduleSaveProg()` | 1098 | Debounced (700ms) save on scroll |
| `exportProg()` / `importProg(text)` | 1064–1085 | Export the **current account only**; import **merges per-account** (newer `t` wins) so a file from another login can't pollute the active one |

Wired into the scroll handler (`scheduleSaveProg`, line 1382) and `closeReader` (final save, line 1173).

---

## 10. Themes

`THEMES` (lines 31–36): `paper`, `sepia`, `green`, `dark`. Plus two pseudo-themes resolved at runtime:

- `'system'` → follows `prefers-color-scheme` (`systemDark()`), picking `THEMES.dark` or `THEMES.paper`.
- `'custom'` → `deriveTheme(hex)` (lines 534–540) computes a full palette (bg/surface/text/muted, dark-or-light by luminance) from one base colour.

`resolveTheme()` (541–545) picks the palette; `applyTheme()` (546) writes CSS custom properties on `#overlay` (`--ir-bg`, `--ir-surface`, `--ir-text`, `--ir-muted`, `--ir-font`, `--ir-fs`, `--ir-lh`, `--ir-width`) and re-schedules the minimap. `FONTS` (37–41): `system` / `sans` / `serif`.

---

## 11. Settings panel

`renderSettings()` (lines 847–937) builds the right slide-in. Fields write straight to the `settings` object and persist via `saveSettings()` (localStorage key `LS_SETTINGS = 'lkir_settings'`). `DEFAULTS` at lines 42–44 (now including `epubVer: 3`).

The panel is organized so the everyday controls sit at the top, a **下载 EPUB 版本** segmented control sits below the resume controls, and the two integrations with external services are **collapsed by default** under native `<details class="set-fold">` blocks tagged 实验性 (`.set-tag`).

| Control id | `settings` key | Notes |
|---|---|---|
| `#sw` swatches / `#s-custom` | `theme`, `customColor` | system / paper / sepia / dark / custom |
| `#s-fs` / `#s-lh` / `#s-w` | `fontSize` / `lineHeight` / `width` | sliders |
| `#s-font` | `font` | 系统 / 黑体 / 宋体 |
| `#s-outline` | `showOutline` | desktop outline sidebar |
| `#s-minimap` | `minimap` | right minimap |
| `#s-auto` | `autoOpen` | auto-immerse on `/detail` |
| `#s-resume` | `resume` | continue reading |
| `#s-progexp` / `#s-progimp` / `#s-progfile` | — | export / import progress |
| `#s-epubver` | `epubVer` | **EPUB 3 / EPUB 2** segmented control; `3` (default) builds EPUB3, `2` the legacy fallback |
| `#s-guide` | — | re-open feature guide |
| `#s-lib` / `#s-liburl` / `#s-libtoken` / `#s-libtest` | `libEnable` / `libUrl` / `libToken` | **inside `<details>` (实验性, collapsed)** — Calibre bridge (test → `GET /api/health`) |
| `#s-llm` / `#s-llmprov` / `#s-llmbase` / `#s-llmkey` / `#s-llmmodel` / `#s-llmtest` | `llmEnable` / `llmProvider` / `llmBase` / `llmKey` / `llmModel` | **inside `<details>` (实验性, collapsed)** — optional LLM metadata; test runs `ensureLLMMeta(S.aid, true)` |

> Experimental / at-your-own-risk: the **发送到书库 (Calibre)** bridge and the **LLM 整理元数据** integration connect to external services (the local bridge and a third-party LLM host), may incur cost, and are used at the user's own risk. API keys and the bridge token are stored **in plaintext in this browser's localStorage** and entered at runtime — never hardcode them.

---

## 12. Export, Calibre bridge & LLM metadata (brief)

These are documented in depth elsewhere; the entry points relevant to the reader:

- **EPUB/TXT/ZIP builders** are hand-rolled (no libraries): `makeZip`/`crc32` (lines 175–195), `buildEpub` (207–303), `buildTxt` (304–308), `download` (309).
- **`buildEpub` emits EPUB3 by default**, or EPUB2 when the user picks it (`settings.epubVer === 2`, read into the local `v3` flag at line 230):
  - **EPUB3 (default, verified epubcheck-clean):** `version="3.0"` package; MARC relator roles via `<dc:creator|contributor id>` + `<meta refines="#id" property="role" scheme="marc:relators">`; series via `belongs-to-collection` (+ `collection-type=series`, `group-position`) **and** the legacy `calibre:series` meta for round-tripping; a proper XHTML **Navigation Document** (`<nav epub:type="toc">`, manifest `properties="nav"`); a `<meta property="dcterms:modified">` timestamp; cover marked via `properties="cover-image"` on the image item.
  - **EPUB2 (fallback):** `version="2.0"`, `opf:role`/`opf:file-as` on creators, `calibre:series`, and the `<meta name="cover">` pointer.
  - Both versions embed reachable images + the cover, write the same NCX, and write searchable `dc:subject` tags for credits that don't round-trip natively. **Images that can't be embedded (fetch failed) are dropped** so the EPUB is always self-contained (no remote refs); LK's custom `img-width`/`img-height`/`loading`/etc. attributes are stripped from `<img>`.
- **Download flow**: `openDlg`/`closeDlg` (1106–1118), `doExport(kind)` (1152–1169), `doSendToLib` (1119–1137), `gatherBook(onP, range)` (1138–1151, series supports a chapter range). `S.busy` guards re-entry.
- **Credit parsing**: `extractCredits(raw)` (939–965) — rule-based 作者/翻译/插画/图源/录入/原作. **The site's reported author is the uploader; the real author is the in-text 作者.** `buildLibMeta(llm)` (1010–1050) merges site + regex + (optional) LLM fields.
- **LLM path**: `LLM_PRESETS` (deepseek / openai / kimicode, lines 966–972), `extractMetaLLM` (983–1002, OpenAI-compatible `/chat/completions` *or* Anthropic `/v1/messages` for Kimi Code), `ensureLLMMeta` (1003–1009, cache-first per aid under `LS_META = 'lir_meta_cache'`). Sends **only the short 卷首 credit block**, never the book.

---

## 13. Feature guide

`GUIDE` (lines 1291–1304) is now a **12-step** array `[{t, b, hl, open?, reveal?, panel?}]`. The steps walk through both the reader UI **and** the settings panel: outline (▤), download corner (⤓), manual split, bookmarks, volumes, navigation rail / minimap, the settings gear (⚙), theme/appearance, the **下载 EPUB 版本** control, resume/progress transfer, the **experimental folds** (Calibre + LLM), and finally 退出.

`openGuide`/`showGuideStep`/`placeSpot` (1307–1341) drive a spotlight (`#guideSpot`) over a highlighted element (`hl` selector). Step flags:

- `open: true` first opens the outline (their targets live there) before placing the spotlight;
- `reveal: true` forces the hover-hidden corner buttons visible (`overlay.guide-reveal`);
- `panel: true` opens the settings panel and `scrollIntoView({block:'center'})`s the target.

For `panel`/`open` steps the spotlight is positioned **after the slide-in / scroll settles** (`setTimeout(place, 280)`; a captured `at = guideIdx` guards against placing a stale spotlight if the user moved on) so the focus box matches the element's real on-screen position; other steps place on the next `requestAnimationFrame`.

While the guide is open the reader is **non-interactive**: `.guide.show` has `pointer-events: auto` and covers the overlay, so it captures all clicks and the reader can't be touched or mis-clicked (the `reveal` class only makes buttons *visible*, not clickable). `maybeAutoGuide()` (1342) auto-shows it once (flag `localStorage['lkir_guided']`).

---

## 14. Bootstrapping & SPA awareness

The site is a SPA, so route changes are intercepted:

- `currentAid()` (1393) parses `/detail/(\d+)` from the path.
- `injectCardButtons()` (1394–1409) adds a hover-reveal 📖 button onto every `a[href^="/detail/"]` card; a `MutationObserver` (1411) re-runs it (debounced) as the DOM changes.
- `onRoute()` (1415–1423) shows/hides `#launch`, auto-opens on `/detail` if `autoOpen`, and closes the reader when navigating away. `history.pushState`/`replaceState` are monkey-patched (1424) and `popstate` is hooked; a `setInterval(onRoute, 800)` is the safety net.
- `openReader(aid)` (1170) / `closeReader()` (1171–1183) toggle the overlay, lock page scroll (`documentElement.style.overflow`), and — when launched from a real detail page — keep the underlying site URL in step on close (so the page behind matches the last book/volume read).

---

## 15. Key functions table

| Function | File location (lines) | Role |
|---|---|---|
| `apiCall` | 62–69 | Envelope POST to `/proxy/api/...` |
| `findSecurityKey` / `acctId` | 55–59 / 1052 | Locate auth key / parse account uid |
| `getDetail` / `getContent` / `getSeries` / `addHistory` | 70–73 | Endpoint helpers |
| `lastReadAid` | 1100–1117 | Last-read chapter from LK history (resume) |
| `chapterize` | 117–172 | TOC-driven (fallback heading) chapter detection |
| `splitBlocks` / `buildSections` | 116 / 553–568 | Paragraph units / stream sections + outline catalogue |
| `renderStream` | 569–596 | Render chapterized single article |
| `renderChapter` / `renderSeriesBody` | 635–645 / 646–664 | Render a web-novel chapter (paged) |
| `pinScroll` | 671–676 | Instant, image-aware re-pinning jump |
| `scrollToSec` / `goPrev` / `goNext` | 677 / 678 / 679 | Section / chapter navigation |
| `buildMinimap` / `syncMinimap` / `minimapGoTo` | 1195–1251 / 1252–1268 / 1282–1286 | Minimap draw / blit / click-to-content (frozen snapshot) |
| `toggleBookmark` / `curBmAid` / `renderBookmarks` | 612–621 / 525 / 750–798 | Bookmarks (per-chapter vs per-book) |
| `saveProg` / `getProg` / `restoreProg` | 1056–1062 / 1055 / 1086–1097 | Account-scoped resume |
| `exportProg` / `importProg` | 1064–1085 | Per-account progress transfer |
| `resolveTheme` / `applyTheme` / `deriveTheme` | 541–545 / 546 / 534–540 | Theming |
| `renderOutline` / `selectOutlineTab` / `enterMode` / `exitMode` | 703–749 / 693–702 / 622–630 / 631 | Outline + interactive modes |
| `renderSettings` | 847–937 | Settings panel (theme, sliders, EPUB version, resume, experimental folds) |
| `extractCredits` / `buildLibMeta` / `ensureLLMMeta` | 939–965 / 1010–1050 / 1003–1009 | Metadata (rule-based + optional LLM) |
| `buildEpub` / `buildTxt` / `makeZip` | 207–303 / 304–308 / 177–195 | Exporters (EPUB3 default / EPUB2 fallback) |
| `openArticle` | 799–846 | Master loader: decides stream vs series, resumes |
| `openReader` / `closeReader` | 1170 / 1171–1183 | Overlay lifecycle |
| `onRoute` / `injectCardButtons` / `currentAid` | 1415–1423 / 1394–1409 / 1393 | SPA route awareness |
| `openGuide` / `showGuideStep` / `placeSpot` | 1307 / 1320–1341 / 1313–1319 | Feature guide (11 steps) |

### `openArticle(aid)` — the decision flow (lines 799–846)

1. `resetState(aid)`, sync URL if needed, fetch `getContent` + `getDetail` in parallel.
2. `chapterize(raw)` → if ≥2 `bounds` (or a saved manual split exists) → **stream** with sections; render, `addHistory`, `restoreProg`. If the article belongs to a multi-volume series, load siblings into `S.volumes`.
3. Otherwise render as a single stream section, then if it has a `sid`: `getSeries`. Decide `kind`:
   - `≤1` item → treat siblings as `volumes`.
   - `≥ MANY_CHAPTERS (20)` → **series** (web novel).
   - in between → sample a couple of siblings; if any is `≥ VOL_LEN (25000)` chars → `volumes`, else `series`.
4. If `series`: build `S.toc`, and when opened at the start with `resume` on, jump to the last-read chapter from history (`lastReadAid`).

---

## 16. Constants worth knowing

```js
LS_SETTINGS = 'lkir_settings';   LS_IDS = 'lkir_ids';
LS_PROG = 'lir_progress';        LS_META = 'lir_meta_cache';
SPLIT_KEY(aid) = 'lkir_split_' + aid;   BM_KEY(aid) = 'lkir_bm_' + aid;
DL_MIN_LEN = 3000;   // single-article download appears above this length
VOL_LEN = 25000;     // article this long ⇒ "volume/book", not a chapter
MANY_CHAPTERS = 20;  // series this large ⇒ web-novel chapters
// settings.epubVer: 3 (default, EPUB3) | 2 (EPUB2 fallback)
```

`@connect` grants in the header allow the bridge (`127.0.0.1`, `localhost`) and LLM hosts (`api.deepseek.com`, `api.kimi.com`, `api.openai.com`, `api.moonshot.cn`) plus the site itself. **Both the bridge integration and these cross-origin LLM connections are experimental** and used at the user's own risk.
