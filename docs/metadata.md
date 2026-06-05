# Metadata Pipeline & EPUB Credit Mapping

The reader's metadata feature turns LK's thin, uploader-centric metadata into a properly-credited EPUB. This is a flagship feature: it parses the *real* in-text credits (作者/插画/翻译/图源/录入), optionally cleans them up with an LLM, and writes them into the EPUB's OPF using Dublin Core + MARC relator roles so that Calibre / Calibre-Web-Automated (CWA) shelve the book with the correct author, translator, illustrator, series and tags.

Both EPUB output paths share the same metadata object: the userscript's `buildEpub` (plain "下载" → local `.epub`) and the bridge's `enrich_epub` (when "发送到书库" POSTs the file plus a `meta` JSON to the companion). They produce equivalent OPF metadata; the bridge re-writes it server-side so the file stays correct even if it is re-ingested.

> Implementation: `lightnovel-immersive-reader.user.js` — `extractCredits`, `buildLibMeta`, `extractMetaLLM`, `ensureLLMMeta`, `LLM_PRESETS`, `buildEpub` (OPF section). Server side: `calibre-bridge/bridge/epub_meta.py` — `enrich_opf_bytes`, `enrich_epub`, `_split_names`.

---

## 1. Where metadata comes from

There are three sources, applied in increasing priority:

| Source | What it provides | Trust |
| --- | --- | --- |
| **Site detail** (`S.detail`, `S.author`, `S.volumes`) | title, "author", update date, tags/category, series (from multi-volume sets) | Low — the site's `author` is the **uploader's nickname**, not the real writer |
| **In-text 卷首 credit block** (`extractCredits(S.raw)`) | 作者 / 翻译 / 插画 / 图源 / 录入 / 原作, parsed from the chapter text | Medium — rule-based, brittle but local & free |
| **Optional LLM** (`extractMetaLLM` → cached per `aid`) | the same fields, plus cleaned title/series/volume/language | Highest priority **when enabled**; opt-in, costs money, sends text to a third party |

Priority is resolved in `buildLibMeta(llm)`:

1. Seed from site detail (`title`, `author`, `updated`, `tags`, `series`/`volume`).
2. Overwrite with `extractCredits` results — crucially **`cr.author` beats the site author**, because the in-text 作者 is the real author and the site author is the uploader.
3. If an `llm` object is present, its non-null fields (`metaPick`) take final precedence over both.

```js
const cr = extractCredits(S.raw);
if (cr.author) m.author = cr.author;   // the real novel author beats the LK uploader nickname
…
if (llm) { const au = metaPick(llm, 'author'); if (au) m.author = au; }  // LLM wins last
```

`original` (原作) is mapped separately and only emitted as a *second* author if it differs from the primary author.

---

## 2. Rule-based credit parser — `extractCredits`

`extractCredits(raw)` is the always-on, no-cost parser. It runs on the raw chapter HTML and returns `{author, translator, illustrator, source, editor, original}`.

**How it reads the text:**

- Converts HTML to text with **`htmlToText`**, which is *newline-preserving*: `<br>`, block elements (`p,div,hr,h1..h4,li,tr`) become line breaks, and `<img>` becomes the literal `［插图］`. Credit lines therefore survive as discrete lines.
- Looks only at the **first 40 non-empty lines** (`.slice(0, 40)`) — credits live in the 卷首 / front matter.
- For each line it requires a `标签：值` shape: `/^(.{1,14}?)\s*[：:]\s*(.+)$/` (label ≤14 chars, full- or half-width colon).
- **Strips BBCode** from the value: `clean()` removes `[tag]…[/tag]` markers (`/\[\/?[a-z][^\]]*\]/gi`), trims leading colons/space, cuts at the first sentence/pipe separator, and caps at 40 chars.
- Skips values that are URLs (`/^https?:/i`).

**Labels matched** (simplified + traditional, tolerant of spaces; first match per key wins):

| Field key | Label regex (matches, incl. compound/variant forms) |
| --- | --- |
| `author` | `作者` / `著者` |
| `translator` | `翻译/翻譯/翻校`, `译者/譯者`, `汉化/漢化` (covers compound **录入/翻译** rows whose label contains 翻译) |
| `illustrator` | `插畫/插画/插图/插圖`, `绘师/繪師`, `illustration`, `イラスト`, `作画/作畫` (covers **监修·插图** style labels) |
| `source` | `图源/圖源`, `扫图/掃圖` |
| `editor` | `录入/錄入`, `校对/校對` |
| `original` | `原作`, `原著` |

Because the matcher only needs the label *substring* to match the regex, compound labels like `录入/翻译：…` or `监修·插图：…` still classify correctly.

A thin convenience wrapper `extractTranslator(raw)` returns just `.translator`.

---

## 3. Optional LLM extraction

Rule-based parsing is brittle (free-form 卷首 blocks, mixed labels). The optional LLM path sends **only the short header/credit block** to an LLM and asks for a single compact JSON. It is **opt-in, cached, and key-local**.

**What is sent** (`metaHeaderText`): the site title, the site author, and the **first 1500 chars** of `htmlToText(S.raw)` — never the book body, never images. The system prompt (`LLM_SYS`) instructs the model to return a compressed JSON with keys `title, series, volume, author, illustrator, translator, source, editor, language`, names kept in their original language, unknown → `null`.

**Providers** (`LLM_PRESETS`):

| Provider key | Label | Default base | Default model | Protocol | Endpoint / headers |
| --- | --- | --- | --- | --- | --- |
| `deepseek` (default) | DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | `openai` | `POST {base}/chat/completions`, `Authorization: Bearer <key>` |
| `openai` | OpenAI 兼容 | `https://api.openai.com/v1` | `gpt-4o-mini` | `openai` | `POST {base}/chat/completions`, `Authorization: Bearer <key>` |
| `kimicode` | Kimi Code | `https://api.kimi.com/coding` | `kimi-for-coding` | `anthropic` | `POST {base}/v1/messages`, headers `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `User-Agent: claude-code/0.1.0` |

The OpenAI-style call sends `{model, temperature:0, max_tokens:500, messages:[system, user]}` and reads `choices[0].message.content`. The Anthropic-style (Kimi Code) call sends `{model, max_tokens:500, system, messages:[user]}` and concatenates the `content[].text` blocks. The reply is parsed leniently (`parseJsonLoose`) — it tolerates surrounding prose by slicing from the first `{` to the last `}`.

**Caching** (`LS_META` = `lir_meta_cache`): results are cached **per `aid`** (book-level, shared across accounts) with `_t` timestamp and `_model`. `ensureLLMMeta(aid, force)` is **cache-first** — it only calls the LLM when there is no cached result (or `force`), so ten downloads cost at most one API call. Both "发送到书库" and plain "下载" (`doExport`) trigger the LLM via `ensureLLMMeta` when it is enabled (cached per book, so repeated runs on the same book are free); the settings "测试 / 重新整理" button forces a fresh call.

**Key storage & warning:** the API key, base and model live only in the browser's `localStorage` (entered in settings). The settings panel shows the cost/risk warning verbatim:

> ⚠️ API Key 等仅以明文保存在你本机浏览器（localStorage）；启用后下载 / 发送时会把「卷首文本」发往第三方 LLM，可能产生费用，风险自负。建议先自行查阅本脚本源码后再启用。

---

## 4. EPUB OPF mapping

The resolved `meta` object (`buildLibMeta`) is written into the OPF. As of v1.14.0 the output is a real **EPUB3 (`<package version="3.0">`) by default** — verified **epubcheck-clean (0 errors)**. An **EPUB2 fallback** (`<package version="2.0">`, `xmlns:opf`) is selectable (设置 → 下载 EPUB 版本, setting key `epubVer`: `3` default, `2`). Both EPUB paths are **version-aware** and share the same mapping: the userscript's `buildEpub` (`const v3 = String(settings.epubVer||3) !== '2'`) and the bridge's `enrich_opf_bytes` (`is3 = (root.get("version") or "2.0").startswith("3")`).

The difference between the two versions is purely *how* the same logical metadata is encoded:

| Logical field | EPUB3 (default) encoding | EPUB2 (fallback) encoding |
| --- | --- | --- |
| MARC relator role | `<meta refines="#id" property="role" scheme="marc:relators">` on a `dc:creator`/`dc:contributor` carrying `id` | `opf:role="…"` attribute on the element |
| file-as (sort name) | `<meta refines="#id" property="file-as">` | `opf:file-as="…"` attribute |
| Series | `<meta property="belongs-to-collection" id="…">` + `collection-type=series` + `group-position` refines **and** `calibre:series`/`calibre:series_index` (kept for Calibre) | `<meta name="calibre:series">` / `calibre:series_index` only |
| Cover | `properties="cover-image"` on the manifest item | same item attr **plus** legacy `<meta name="cover" content="cover-img"/>` |
| TOC / nav | XHTML Navigation Document `nav.xhtml` with `<nav epub:type="toc">`, manifest `properties="nav"` (NCX kept too) | `nav.xhtml` is a plain page; NCX is the TOC |
| Release id | required `<meta property="dcterms:modified">` (UTC, seconds precision) | — (not emitted) |

The Dublin-Core ↔ field mapping itself is identical across versions:

| `meta` field | OPF element | MARC relator | Native Calibre column? | Searchable tag fallback (`dc:subject`) |
| --- | --- | --- | --- | --- |
| `author` | `dc:creator` (file-as = author) | `aut` | ✅ Authors | — |
| `original` (原作, if ≠ author) | 2nd `dc:creator` | `aut` | ✅ Authors (extra author) | — |
| `translator` | `dc:contributor` (one per name) | `trl` | ❌ (round-trips, invisible) | ✅ `译者:<name>` |
| `illustrator` | `dc:contributor` (one per name) | `ill` | ❌ (round-trips, invisible) | ✅ `插画:<name>` |
| `editor` (录入/校对) | `dc:contributor` (one per name) | `edt` | ✅ surfaced | — |
| `sourceGroup` (图源) | `dc:contributor` (one per name) | `bkp` | ✅ surfaced | ✅ `图源:<name>` |
| `series` | `belongs-to-collection` (v3) + `calibre:series` | — | ✅ Series | — |
| `volume` | `group-position` (v3) + `calibre:series_index` | — | ✅ Series index | — |
| `title` | `dc:title` | — | ✅ Title | — |
| `language` | `dc:language` (`zh` / `zh-Hant` / `zh-Hans`) | — | ✅ Languages | — |
| `updated` | `dc:date` | — | ✅ (date) | — |
| `tags` | `dc:subject` (one each) | — | ✅ Tags | — |
| `lkUrl` | `dc:source` (+ bridge: `dc:identifier scheme="url"`) | — | partial | — |
| `aid` | (bridge) `dc:identifier scheme="lknovel"` | — | ✅ identifier | — |

### Why the tag fallback exists

Calibre natively surfaces only a subset of MARC relator roles — practically **`aut`, `edt`, `bkp`**. Roles like **`trl` and `ill` round-trip in the OPF but are invisible** in Calibre's UI and unsearchable, in *both* EPUB versions. To keep translator/illustrator/图源 discoverable, **both EPUB paths additionally emit a `dc:subject` tag**: `译者:<name>`, `插画:<name>`, `图源:<name>`. (图源 group is doubly covered — `bkp` role *and* a `图源:` tag.)

### Multi-name credits → one contributor each

A combined credit string like `李雷、悦梦/EMT` must not become a single mangled contributor. Both sides split on the same separators and emit one element per name:

- Userscript `personsMulti(val, role)` splits on `[、，,\/／&＆]` and routes each name through `person('contributor', n, role)` (which emits the v3 refines-role or the v2 `opf:role` form).
- Bridge `_split_names(v)` splits on `[、，,/／&＆]`, each name added via `_add_person(...)`.

```js
// userscript buildEpub
const personsMulti = (val, role) => String(val||'').split(/[、，,\/／&＆]/)
  .map(s=>s.trim()).filter(Boolean)
  .map(n => person('contributor', n, role)).join('');
```

```python
# bridge epub_meta.py
def _split_names(v):
    return [p.strip() for p in re.split(r"[、，,/／&＆]", str(v)) if p.strip()]
```

### Self-contained output

Images that can't be fetched/embedded are **dropped** (the `<img>` is removed) so the EPUB never carries remote references and stays self-contained. LK's custom `img-width`/`img-height` (and other non-standard) attributes are stripped from embedded images.

### Authoritative vs. extra fields

In `buildEpub`, `dc:title` and the primary `dc:creator` (passed as the `author` argument, already resolved by `buildLibMeta`/`extractCredits`) stay authoritative; the `meta` object only adds the *extra* contributors, series, date, and tags. The bridge's `enrich_opf_bytes` is more aggressive — it **removes and replaces** existing `dc:creator`, `dc:contributor`, and `dc:subject` elements from `meta`. Being version-aware, it also:

- **cleans dangling refines** — when it removes a `dc:creator`/`dc:contributor` it also drops any `<meta refines="#id">` that pointed at it (a dangling refines is invalid EPUB3);
- **refreshes `dcterms:modified`** — re-stamps the EPUB3 release identifier on every enrich (and writes the v3 refines-role form / v2 `opf:role` to match the package version);
- is **idempotent** on re-import: it preserves the package `unique-identifier`, and only re-adds `scheme="lknovel"` / `scheme="url"` identifiers if not already present.

---

## 5. End-to-end flow

```
S.raw (chapter HTML) ──htmlToText──▶ extractCredits ──┐
S.detail / S.author / S.volumes ─────────────────────┤
                                                      ├─▶ buildLibMeta(llm) ─▶ meta {}
metaHeaderText() ─▶ extractMetaLLM ─▶ cache(aid) ─llm─┘            │
                                                                  ├─▶ buildEpub(..., meta)  → local .epub  (download)
                                                                  └─▶ libImport(meta, bytes) → POST /api/import
                                                                                                    │
                                                          calibre-bridge: enrich_epub(epub, meta) ──┘
                                                                  → rewrites OPF → CWA ingest folder
```

- **下载 (plain download):** `doExport('epub')` triggers `ensureLLMMeta` when LLM is enabled (cached per book), else uses any cached result. `author` resolved as `metaPick(llm,'author') || extractCredits(S.raw).author || S.author || '未知'`.
- **发送到书库 (send to library):** triggers `ensureLLMMeta` (live call if enabled & uncached), builds the same `libMeta`, ships the EPUB + `meta` JSON to the bridge, which re-enriches the OPF and drops the file into CWA's ingest folder.
