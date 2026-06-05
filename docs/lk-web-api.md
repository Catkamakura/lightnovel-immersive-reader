# lightnovel.fun Web API (as consumed by this project)

This is a **reference for the lightnovel.fun web API that this project consumes** — the same JSON
endpoints the site's own front‑end calls in the browser. The reader
(`lightnovel-immersive-reader.user.js`) is a strictly **read‑only consumer** of that API: it never
writes user content and never authenticates on the user's behalf, except to *record reading
history* (one benign call, `history/add-history`, exactly as the site itself does so resume keeps
working). Field names below are simply the ones the script reads from those responses in the
logged‑in browser — treat this as descriptive notes, not an official spec.

> **Audience.** Written for a human contributor *and* for an LLM agent that will operate/extend
> this code. Field names are exactly as the script reads them; where the script tolerates several
> shapes (e.g. `tags` / `tag_list`), that is noted.

---

## 1. Transport: the request "envelope"

Every call is a **same-origin `POST`** to `/proxy/api/...`. The site's own front-end fronts its
backend through a `/proxy/...` reverse proxy on the same origin, so the userscript can call it
directly from page context with cookies attached — no CORS, no API host, no signing.

The request body is a fixed JSON **envelope**; the real parameters live under `d`.

```jsonc
{
  "is_encrypted": 0,        // we always send plaintext
  "platform": "pc",
  "client": "web",
  "sign": "",               // request signature — left empty; the web API accepts it blank
  "gz": 0,                  // gzip flag — off
  "d": {                    // the actual params, plus identity fields injected by apiCall
    "browser_id": "b_xxxxxxxxxxxxxxxx",
    "session_id": "s_xxxxxxxxxxxxxxxx",
    "security_key": "<hex>:<uid>:<exp>",   // present only when logged in
    "...": "endpoint-specific params (aid / sid / page / ...)"
  }
}
```

### How `apiCall` builds it

`apiCall(path, d)` (in `lightnovel-immersive-reader.user.js`) is the single chokepoint for all API
traffic:

```js
async function apiCall(path, d) {
  const sk = findSecurityKey();
  const body = {
    is_encrypted: 0, platform: 'pc', client: 'web', sign: '', gz: 0,
    d: Object.assign(
      { browser_id: ids.browser_id, session_id: ids.session_id },
      sk ? { security_key: sk } : {},
      d
    ),
  };
  const r = await fetch('/proxy' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',     // send the site's cookies
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('code=' + j.code);
  return j.data;
}
```

Key points:

| Aspect | Behavior |
| --- | --- |
| Method / URL | `POST /proxy` + `path` (e.g. `/proxy/api/article/get-detail`). |
| Identity merge | `browser_id` + `session_id` always injected; `security_key` only if found. |
| `d` precedence | Caller's `d` is merged **last**, so per-call params win over defaults. |
| Cookies | `credentials: 'include'` — relies on the logged-in session cookie too. |
| Success contract | Resolves with `j.data` **only when `j.code === 0`**; otherwise throws `Error("code=<n>")`. |

### Identity fields (`browser_id` / `session_id`)

These are **client-minted**, not issued by the server. On first run the script generates them and
persists them in `localStorage` (`LS_IDS`):

```js
function randId(p) { let s = p; const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 16; i++) s += c[(Math.random()*c.length)|0]; return s; }
// ids.browser_id = randId('b_');  ids.session_id = randId('s_');
```

So `browser_id` looks like `b_<16 chars>` and `session_id` like `s_<16 chars>`. The API does not
require them to be server-recognized; they exist because the envelope shape expects them.

---

## 2. Authentication: `security_key`

The web API's notion of "who is logged in" is a single opaque token, the **`security_key`**, with
the format:

```
<hex>:<uid>:<exp>
```

- `<hex>` — an opaque hex token (≥ 16 hex chars).
- `<uid>` — the **numeric user id**. This project treats `uid` as the account identity for
  partitioning reading progress (see `acctId()` and the per-account progress store).
- `<exp>` — an expiry timestamp.

The userscript **never logs in itself**. Instead it scavenges the key the site already stored, via
`findSecurityKey()`:

```js
function findSecurityKey() {
  const re = /^[a-f0-9]{16,}:\d+:\d+$/;
  for (let i = 0; i < localStorage.length; i++) {
    const v = localStorage.getItem(localStorage.key(i)) || '';
    if (re.test(v)) return v;                                   // a raw key stored verbatim
    const m = v.match(/"security_key":"([a-f0-9]+:\d+:\d+)"/);  // or embedded in a JSON blob
    if (m) return m[1];
  }
  return null;
}
```

It scans **every** `localStorage` entry, matching either a bare `<hex>:<uid>:<exp>` value or a key
embedded inside a serialized JSON object (`"security_key":"..."`). `findSecurityKey()` is called
fresh on **every** `apiCall`, so the reader transparently picks up a login/logout that happened in
another tab.

Parsing `uid` out of the key (used for account-scoped progress):

```js
const acctId = () => {
  const sk = findSecurityKey();
  const m = sk && sk.match(/^[a-f0-9]+:(\d+):/);
  return (m && m[1]) || 'anon';     // logged-out reads/writes go under "anon"
};
```

### `user/login` (not used by the reader)

For completeness — the site's login path is `user/login` with `{username, password}` in `d`,
returning a `security_key` in `data`. **This project does not call it**; the reader assumes the
user logged in through the normal site UI and only *reads* the resulting key. Logging in
programmatically is out of scope (and would mean handling raw credentials, which the reader
deliberately avoids).

---

## 3. Endpoints used by the reader

These five paths are the **only** ones `apiCall` is invoked with in the script:

| Path | Params (`d`) | Auth | Purpose in the reader |
| --- | --- | --- | --- |
| `/api/article/get-detail` | `{ aid }` | optional | Article metadata (title, author, `sid`, tags, cover). |
| `/api/article/get-content` | `{ aid }` | anon-OK | Chapter body HTML. |
| `/api/series/get-article-list` | `{ sid }` | optional | Ordered chapter list for a series. |
| `/api/history/add-history` | `{ aid }` | required | Record "I read this" (best-effort, fire-and-forget). |
| `/api/history/get-history` | `{ page }` | required | Recency list used to resume web novels. |

Two further endpoints are noted here for reference but are **not** wired into the
current script: `user/login` (above) and `category/get-article-by-cate` (below).

---

### 3.1 `article/get-detail` — `{ aid }`

```js
const getDetail = (aid) => apiCall('/api/article/get-detail', { aid });
```

Returns the article's metadata. Fields the reader actually reads off `data`:

| Field | Used as | Notes |
| --- | --- | --- |
| `title` | book/chapter title | Cleaned via `cleanTitle()`. |
| `author.nickname` | displayed "author" | **This is the UPLOADER, not the in-text 作者.** See note below. |
| `sid` | series id | `(detail.sid || 0) > 0` triggers a `get-article-list` lookup to decide stream vs. series mode. |
| `tags` / `tag_list` | subject tags | `detailTags(d)` accepts either, plus `category` / `cate_name`, dedupes, caps at 8. |
| `category` / `cate_name` | extra tag | folded into the tag list. |
| cover (various) | EPUB cover | resolved elsewhere; field shape is tolerant. |

> **KEY FINDING — there is no reading-progress field.** `get-detail` carries **no** "last read
> position", "percent", or "resume" field, and the series chapter list (§3.3) carries **no**
> per-chapter "read" flag. The *only* progress signal the API exposes is **history** (§3.4/§3.5).
> This is the root reason the reader resumes web novels from `history/get-history` (last-read
> chapter) and remembers within-article scroll **locally** per `aid`. See the comment block around
> `restoreProg` / `lastReadAid` in the script.

> **author = uploader.** `data.author.nickname` is the account that *uploaded* the post, which is
> usually **not** the novel's real author. The project recovers the true 作者/插画/翻译/etc. by
> parsing the in-text credit block (`extractCredits`) and/or the optional LLM path — never from
> `get-detail.author`.

---

### 3.2 `article/get-content` — `{ aid }`

```js
const getContent = (aid) =>
  apiCall('/api/article/get-content', { aid }).then((d) => d.content || '');
```

Returns the chapter's body. The reader pulls `data.content` (HTML/BBCode-ish markup) and falls back
to `''` if absent. This endpoint is **anonymous-OK**: it works without a `security_key`, which is
why a logged-out user can still open and read content.

Failures here are handled gracefully — a chapter that won't load is shown as
`本章无法获取（可能仅限 App）。`, i.e. an article that exists but is **app-only** (see code `5001`,
§5).

---

### 3.3 `series/get-article-list` — `{ sid }`

```js
const getSeries = (sid) =>
  apiCall('/api/series/get-article-list', { sid })
    .then((l) => (l || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
```

Returns the array of articles in a series. Each element carries at least:

| Field | Used as |
| --- | --- |
| `aid` | the chapter/volume article id |
| `title` | chapter title (labeled via `chapterLabels` / `commonPrefix`) |
| `order` | **sort key** — the list is re-sorted ascending by `order` before use |

The list is returned **already ordered** by the API, but the reader defensively **re-sorts by
`order`** (treating a missing `order` as `0`) so chapter sequence is deterministic. The length and
per-article body length then drive the stream-vs-series-vs-volumes decision (`MANY_CHAPTERS = 20`,
`VOL_LEN = 25000`).

> Note: `data` here is the **array itself** (`(l || [])`), not an object wrapping a `list` field —
> contrast with `get-history` (§3.5).

---

### 3.4 `history/add-history` — `{ aid }`

```js
const addHistory = (aid) => apiCall('/api/history/add-history', { aid }).catch(() => {});
```

The reader's **only mutation**. Called when a chapter/article is opened, to push it onto the
account's server-side history so resume (§3.5) and the site's own "continue reading" stay in sync.
It is **fire-and-forget**: errors are swallowed (`.catch(() => {})`), so a logged-out user or a
failed write never blocks reading. Requires a valid `security_key` to have any effect.

---

### 3.5 `history/get-history` — `{ page }`

The account's **recency-sorted** reading history — the project's sole progress signal for web
novels. Paged; the reader walks pages 1..4 until it finds a chapter belonging to the open series:

```js
async function lastReadAid(aidSet) {
  for (let p = 1; p <= 4; p++) {
    const data = await apiCall('/api/history/get-history', { page: p });
    const list = (data && data.list) || [];
    if (!list.length) break;                       // ran out of history
    for (const it of list) if (aidSet.has(it.aid)) return it.aid;   // most recent match wins
  }
  return null;
}
```

Response shape:

```jsonc
{
  "list": [
    { "aid": 12345, "sid": 678, "last_time": 1700000000, "...": "..." },
    // ... most-recent first
  ],
  "page_info": { /* paging metadata */ }
}
```

| Field | Used as |
| --- | --- |
| `list[]` | recency-ordered history entries (newest first) |
| `list[].aid` | matched against the open series' chapter `aid`s to find the last-read chapter |
| `list[].sid` | series id (available; the reader matches on `aid`) |
| `list[].last_time` | read timestamp (available; the reader relies on list order, not this value) |
| `page_info` | paging metadata; the reader instead stops when `list` is empty |

Because order is recency-descending, the **first** entry whose `aid` is in the open series' chapter
set is the last-read chapter — exactly what `lastReadAid` returns, and what
`openArticle`/`renderChapter` use to resume a web novel at the right chapter. Requires
`security_key`.

---

### 3.6 `category/get-article-by-cate` (not currently used)

A browse/listing endpoint, noted here for reference. Params in `d`:

```jsonc
{ "gid": 106, "parent_gid": <n>, "page": <n>, "type": <n> }
```

Observed `gid` values:

| `gid` | Meaning |
| --- | --- |
| `106` | 最新 (latest) |
| `107` | 整卷 (full volumes) |

It returns a paged list of articles for the category and could back a future in-reader "browse /
discover" surface. **The current `lightnovel-immersive-reader.user.js` does not call it** — listed
here so a future contributor/agent knows the path and parameter names without re-deriving them.

---

## 4. Response envelope & success contract

All responses share the wrapper:

```jsonc
{ "code": 0, "data": <payload>, "...": "..." }
```

`apiCall` enforces a strict success contract: **`code === 0` ⇒ resolve `data`; anything else ⇒
throw `Error("code=" + code)`.** There is no partial-success handling — a non-zero `code` is always
an exception at the call site. Callers then degrade gracefully:

- `getContent` failures → `本章无法获取（可能仅限 App）。`
- `getDetail`/`getContent` pair failure on open → `无法加载该内容（可能仅限 App 或已删除）。`
- `getSeries`, `addHistory`, `getHistory` failures are caught and treated as "no data".

---

## 5. Known codes

| `code` | Meaning | Reader handling |
| --- | --- | --- |
| `0` | Success | `apiCall` returns `data`. |
| `5001` | **App-only / removed** — content exists but is not served to the web client (or has been pulled). | Surfaces as the "可能仅限 App 或已删除" / "本章无法获取（可能仅限 App）" fallbacks; the chapter is shown as unavailable rather than crashing. |

Other non-zero codes propagate as `Error("code=<n>")` and are caught by the relevant guard
(`.catch(...)` or the `try/catch` in `openArticle`). The reader makes no attempt to distinguish them
beyond `5001`.

---

## 6. Quick map: code → endpoint

| Helper (in `lightnovel-immersive-reader.user.js`) | Endpoint |
| --- | --- |
| `apiCall(path, d)` | builds the envelope, `POST /proxy<path>` |
| `getDetail(aid)` | `article/get-detail` |
| `getContent(aid)` | `article/get-content` |
| `getSeries(sid)` | `series/get-article-list` |
| `addHistory(aid)` | `history/add-history` |
| `lastReadAid(aidSet)` | `history/get-history` (paged 1..4) |
| `findSecurityKey()` / `acctId()` | locate / parse `security_key` (`<hex>:<uid>:<exp>`) |
| — *(not called)* | `user/login`, `category/get-article-by-cate` |
