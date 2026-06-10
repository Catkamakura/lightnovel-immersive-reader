// ==UserScript==
// @name         轻读 · LightNovel 沉浸阅读 (Immersive Reader)
// @namespace    https://lightnovel.fun/immersive-reader
// @version      2.0.0
// @description  为 lightnovel.fun 提供干净的沉浸式阅读器（分章 / 书签 / 缩略图 / 主题 / 续读 / 导出 EPUB·TXT）。A clean immersive reader for lightnovel.fun (chapterize, bookmarks, minimap, themes, resume, EPUB/TXT export).
// @description:zh-CN  为 lightnovel.fun 提供干净的沉浸式阅读器（分章 / 书签 / 缩略图 / 主题 / 续读 / 导出 EPUB·TXT）。
// @description:en  A clean immersive reader for lightnovel.fun (chapterize, bookmarks, minimap, themes, resume, EPUB/TXT export).
// @author       masiro
// @match        https://www.lightnovel.fun/*
// @icon         https://www.lightnovel.fun/favicon.ico
// @homepageURL  https://github.com/Catkamakura/lightnovel-immersive-reader
// @supportURL   https://github.com/Catkamakura/lightnovel-immersive-reader/issues
// @updateURL    https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js
// @downloadURL  https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      lightnovel.fun
// @connect      127.0.0.1
// @connect      localhost
// @connect      api.deepseek.com
// @connect      api.kimi.com
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ============================ config ============================ */
  const LS_SETTINGS = 'lkir_settings';
  const LS_IDS = 'lkir_ids';
  const DL_MIN_LEN = 3000;     // single-article download appears above this length
  const VOL_LEN = 25000;       // an article this long is treated as a "volume/book", not a chapter
  const MANY_CHAPTERS = 20;    // a series with this many items is treated as web-novel chapters

  const THEMES = {
    paper: { label: '纸白', bg: '#f5f5f7', surface: '#ffffff', text: '#1f2328', muted: '#8a9099', dark: false },
    sepia: { label: '护眼', bg: '#e9ddc7', surface: '#f3e9d6', text: '#5b4636', muted: '#9c8466', dark: false },
    green: { label: '青豆', bg: '#cce8cf', surface: '#d6efd8', text: '#33443a', muted: '#6f8a76', dark: false },
    dark: { label: '夜间', bg: '#15171a', surface: '#1d2024', text: '#c8ccd2', muted: '#6b7280', dark: true },
  };
  const FONTS = {
    system: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif',
    sans: '"Helvetica Neue","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
    serif: 'Georgia,"Songti SC","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif',
  };
  const DEFAULTS = { theme: 'system', customColor: '#f3ead6', fontSize: 19, lineHeight: 1.9, width: 740, font: 'system', autoOpen: false, showOutline: true, minimap: false, lang: 'system',
    libEnable: false, libUrl: 'http://127.0.0.1:8788', libToken: '', resume: true,
    llmEnable: false, llmProvider: 'openai', llmBase: '', llmKey: '', llmModel: '', epubVer: 3,
    foldAdv: false, seamlessScroll: true };
  const WIN_KEEP = 12;      // seamless web-novel: max chapters kept in the DOM at once (distant ones unload to spacers)
  const CHUNK_BLOCKS = 30;  // seamless web-novel: blocks per lazy-rendered .chunk (content-visibility: auto)

  let settings = (() => { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); } catch { return Object.assign({}, DEFAULTS); } })();
  const saveSettings = () => localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));

  /* ===================== i18n (中文 / English) ===================== */
  // The source strings are Chinese (the keys). t() returns them unchanged in 中文, or the English value
  // in English mode (falling back to the Chinese). Default language follows the browser; overridable in 设置.
  const UI_LANG = (() => { const l = String(navigator.language || navigator.userLanguage || 'en').toLowerCase(); return l.indexOf('zh') === 0 ? 'zh' : 'en'; })();
  const curLang = () => { const s = settings.lang; return (s === 'zh' || s === 'en') ? s : UI_LANG; };
  const EN = {
    '📖 沉浸阅读': '📖 Immersive Read', '✕ 退出': '✕ Exit', '✓ 完成调整': '✓ Done',
    '目录 / 大纲': 'Outline', '下载整本（EPUB / TXT）': 'Download (EPUB / TXT)', '阅读设置': 'Reading settings', '退出沉浸阅读 (Esc)': 'Exit reader (Esc)',
    '加载中…': 'Loading…', '无法加载该内容（可能仅限 App 或已删除）。': 'Could not load this content (app-only or removed).',
    '上一章': 'Prev', '下一章': 'Next', '顶部': 'Top', '返回': 'Back', '回到顶部': 'Back to top',
    '目录': 'Contents', '书签': 'Bookmarks', '分卷': 'Volumes', '未完成': 'todo',
    '下载 / 发送整本': 'Download / Send', '下载 / 发送（可选章节范围）': 'Download / Send (chapter range)', '下载 / 发送整本（全书）': 'Download / Send (whole book)',
    '选择导出格式': 'Choose a format', '从': 'From', '到': 'To', '章节范围': 'Chapter range',
    '选择章节范围': 'Choose a chapter range', '整本': 'All', '再点一章设为结束': 'Now tap the end chapter', '点一章设为开始，再点一章设为结束': 'Tap a chapter to start, then another to end',
    '📚 发送到书库（Calibre）': '📚 Send to library (Calibre)', '📖 EPUB（封面+插图）': '📖 EPUB (cover + images)', '📄 TXT（纯文本）': '📄 TXT (plain text)', '取消': 'Cancel',
    '跳过': 'Skip', '‹ 上一步': '‹ Back', '下一步 ›': 'Next ›', '完成 ✓': 'Done ✓',
    // settings
    '主题': 'Theme', '跟随系统': 'System', '纸白': 'Paper', '护眼': 'Sepia', '夜间': 'Night', '自定义': 'Custom',
    '自定义底色（如 #AA4A44）': 'Custom background (e.g. #AA4A44)', '字号': 'Font size', '行距': 'Line height', '页宽': 'Page width', '字体': 'Font',
    '系统': 'System', '黑体': 'Sans', '宋体': 'Serif',
    '显示目录侧栏（电脑端）': 'Show outline sidebar (desktop)', '右侧缩略图 Minimap（电脑端）': 'Minimap (desktop)', '进入详情页自动沉浸': 'Auto-open reader on a detail page',
    '网文连续滚动': 'Continuous scroll (web novels)', '像起点那样：滚到底自动接上下一章、向上滚动接上一章；章节会提前在后台取好、远处章节自动卸载。关掉则一章一页、用上一章 / 下一章翻页。': 'Qidian-style: reaching the bottom flows into the next chapter and scrolling up into the previous one; chapters are prefetched in the background and distant ones unload. Turn off for one-chapter-per-page with Prev / Next.',
    '语言': 'Language', '阅读进度': 'Reading progress', '网文回到上次看的章节，单篇回到上次的位置': 'Web novels return to the last chapter; single articles to the last position',
    '导出进度': 'Export', '导入进度': 'Import', '进度只存在本机、按登录账号分开存放；换设备时导出再导入即可（不会与其它账号混用）。': 'Progress is stored locally per signed-in account; export then import to move it between devices (never mixed across accounts).',
    '📖 功能向导 / 使用说明': '📖 Feature guide', '界面做了精简、很多功能被收了起来；忘记某个功能怎么用时，随时点这里重看分步引导。': 'The UI is intentionally minimal and tucks features away — open this anytime for the step-by-step guide.',
    '下载 EPUB 版本': 'EPUB version', '默认生成更规范的 EPUB 3（现行标准）；个别老设备 / 老阅读器不兼容时再切回 EPUB 2。': 'Generates the more standards-compliant EPUB 3 by default; switch to EPUB 2 only for older devices/readers.',
    '高级（实验性）': 'Advanced (experimental)', '高级 / 实验性功能': 'Advanced (experimental)', '实验性': 'experimental', '查看说明': 'Show help',
    '发送到书库（Calibre）': 'Send to library (Calibre)', '启用书库': 'Enable library', 'Token（可选，留空即不校验）': 'Token (optional)',
    '测试连接': 'Test connection', '连接中…': 'Connecting…', '请先填写书库地址': 'Enter the library address first',
    '用 LLM 整理元数据': 'Tidy metadata with an LLM', '启用 LLM 整理': 'Enable LLM tidy-up', 'API Key（仅存于本机浏览器）': 'API key (kept in this browser only)',
    '用当前书测试 / 重新整理': 'Test / re-run on this book', '请先勾选「启用 LLM 整理」': 'Enable LLM tidy-up first', '请先填写 API Key': 'Enter the API key first', '请先打开一本书再测试': 'Open a book first', '整理中…（仅发送卷首文本）': 'Working… (only the front-matter is sent)',
    '若使用其它接口地址，需在脚本头部加一行 @connect 你的域名（或在 Tampermonkey 弹窗里允许）。': 'For a custom endpoint host, add a `@connect <host>` line to the userscript header (or allow it in the Tampermonkey prompt).',
    '需自行搭建 calibre-bridge 并允许脚本连接该地址，自担风险。': 'Run your own calibre-bridge and allow the script to connect to it — at your own risk.',
    'API Key 明文存于本机浏览器；会把卷首文本发往第三方、可能产生费用，自担风险。': 'The API key is stored in plaintext in this browser; the front-matter is sent to a third party (may cost money) — at your own risk.',
    '已连接 ✓ 模式 ': 'Connected ✓ mode ', ' · 已收录 ': ' · ', ' 本': ' books',
    '连接失败：': 'Connection failed: ', ' · 请确认 calibre-bridge 已启动且地址正确': ' · check the bridge is running at this address',
    '整理中…': 'Working…', '整理失败或无结果（看上方提示）': 'Failed or no result (see the message above)', '已整理 ✓ ': 'Done ✓ ',
    '作者': 'Author', '插画': 'Illustrator', '译者': 'Translator', '卷': 'Vol.', 'OpenAI 兼容': 'OpenAI-compatible',
    '‹ 上一章': '‹ Prev', '下一章 ›': 'Next ›',
    '还没有书签。当前为书签模式——点击正文任意段落即可添加': "No bookmarks yet. You're in bookmark mode — click any paragraph to add", '（每章独立）。': ' (per chapter).',
    '调整分章': 'Adjust splits', '完成': 'Finish', '重置': 'Reset', '取消分章': 'undo split', '在此分章': 'split here',
    '点击任意段落＝在此分章；点击正文里「✕ 取消分章」可合并相邻章节。': 'Click any paragraph to split there; “✕ undo split” in the text merges adjacent chapters.',
    '已发送到书库 ✓': 'Sent to the library ✓', '（CWA 正在导入）': ' (CWA is importing)', '发送失败：': 'Send failed: ', ' · 请确认本机 calibre-bridge 已启动': ' · check the local calibre-bridge is running', '导出失败：': 'Export failed: ',
    // toasts (static)
    '已添加书签': 'Bookmark added', '已移除书签': 'Bookmark removed', '不是续读进度文件': 'Not a progress file', '文件读取失败：不是有效的 JSON': 'Read failed: invalid JSON',
    '本章暂无内容（可能未翻译）': 'No content for this chapter (maybe untranslated)', '该书由站点分章，无需手动调整': 'This book is already split by the site', '该模式暂不支持': 'Not available in this mode',
    // toast prefixes (dynamic) + progress
    '已续读至 ': 'Resumed at ', '已为你续读至 ': 'Resumed at ', '已导入 ': 'Imported ', 'LLM 整理失败：': 'LLM failed: ',
    '正在准备…': 'Preparing…', '正在用 LLM 整理元数据…': 'Tidying metadata with the LLM…', '正在打包章节…': 'Collecting chapters…', '正在获取封面…': 'Fetching cover…', '正在打包 EPUB…': 'Packaging EPUB…', '正在生成 EPUB…': 'Building EPUB…', '正在发送到书库…': 'Sending to the library…', '完成 ✓': 'Done ✓',
    // always-visible chapter meta / tail / outline notes / settings-close tooltip
    '章节': 'chapters', '全书完': 'The End', '关闭设置': 'Close settings',
    '书签模式：点击正文段落即可添加 / 移除（仅当前章节）。': 'Bookmark mode: tap any paragraph to add / remove (this chapter only).',
    '书签模式：点击正文段落即可添加 / 移除；下方按所在章节分组。': 'Bookmark mode: tap any paragraph to add / remove; grouped by chapter below.',
    '提示：当前在「目录」，再点一次「目录」即可调整分章。': 'Tip: you are on “Contents” — tap “Contents” again to adjust splits.',
    '本篇为单段内容。再点一次上方「目录」即可进入分章调整、自行划分。': 'This is a single section. Tap “Contents” above again to split it yourself.',
    '核对原文末尾（确认未删减）': 'Check the source ending (verify nothing was cut)', '段': 'blocks',
    '原文最后 ': "Source's last ", ' 行（与上方正文结尾一致，未删减）：': ' lines (identical to the ending above, uncut):',
  };
  const t = (zh) => (curLang() === 'en' && EN[zh]) ? EN[zh] : zh;
  // "第 N / N 章" (ZH) / "Ch. N / N" (EN); n = 1-based position, total = chapter count
  const chMeta = (n, total) => curLang() === 'en' ? ('Ch. ' + n + ' / ' + total) : ('第 ' + n + ' / ' + total + ' 章');
  // apply the current language to the static chrome (built once); re-applied whenever the language changes
  function refreshChrome() {
    const set = (id, zh) => { const el = $(id); if (el) el.textContent = t(zh); };
    const ttl = (id, zh) => { const el = $(id); if (el) el.title = t(zh); };
    set('launch', '📖 沉浸阅读'); set('editFloat', '✓ 完成调整');
    set('close', '✕ 退出'); ttl('close', '退出沉浸阅读 (Esc)');
    ttl('t-outline', '目录 / 大纲'); ttl('t-dlCorner', '下载整本（EPUB / TXT）'); ttl('t-set', '阅读设置');
    [['r-prev', '上一章'], ['r-next', '下一章']].forEach(([id, zh]) => { const b = $(id); if (!b) return; b.title = t(zh); const lb = b.querySelector('span:not(.ic)'); if (lb) lb.textContent = t(zh); });
    ttl('r-top', '回到顶部');
    const h3 = $('setPanel') && $('setPanel').querySelector('h3'); if (h3 && h3.firstChild) h3.firstChild.textContent = t('阅读设置') + ' ';
    set('dl-lib', '📚 发送到书库（Calibre）'); set('dl-epub', '📖 EPUB（封面+插图）'); set('dl-txt', '📄 TXT（纯文本）'); set('dlgClose', '取消');
    set('guideSkip', '跳过'); set('guidePrev', '‹ 上一步');
    const ld = $('content') && $('content').querySelector('.loading'); if (ld) ld.textContent = t('加载中…');
  }
  function applyLang() { refreshChrome(); try { if (S.aid) renderOutline(); updateTopBtn(); } catch { /* */ } if ($('guide') && $('guide').classList.contains('show')) showGuideStep(); }

  /* ====================== envelope ids / auth ====================== */
  function randId(p) { let s = p; const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 16; i++) s += c[(Math.random() * c.length) | 0]; return s; }
  const ids = (() => { try { return JSON.parse(localStorage.getItem(LS_IDS) || '{}'); } catch { return {}; } })();
  if (!ids.browser_id) ids.browser_id = randId('b_');
  ids.session_id = ids.session_id || randId('s_');
  localStorage.setItem(LS_IDS, JSON.stringify(ids));
  function findSecurityKey() {
    const re = /^[a-f0-9]{16,}:\d+:\d+$/;
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) || ''; if (re.test(v)) return v; const m = v.match(/"security_key":"([a-f0-9]+:\d+:\d+)"/); if (m) return m[1]; } } catch { /* */ }
    return null;
  }

  /* ============================== API ============================== */
  async function apiCall(path, d) {
    const sk = findSecurityKey();
    const body = { is_encrypted: 0, platform: 'pc', client: 'web', sign: '', gz: 0, d: Object.assign({ browser_id: ids.browser_id, session_id: ids.session_id }, sk ? { security_key: sk } : {}, d) };
    const r = await fetch('/proxy' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
    const j = await r.json();
    if (j.code !== 0) throw new Error('code=' + j.code);
    return j.data;
  }
  const getDetail = (aid) => apiCall('/api/article/get-detail', { aid });
  const getContent = (aid) => apiCall('/api/article/get-content', { aid }).then((d) => d.content || '');
  const getSeries = (sid) => apiCall('/api/series/get-article-list', { sid }).then((l) => (l || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
  const addHistory = (aid) => apiCall('/api/history/add-history', { aid }).catch(() => {});
  function gmBytes(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({ method: 'GET', url, responseType: 'arraybuffer', timeout: 30000,
          onload: (r) => { if (r.status >= 200 && r.status < 300 && r.response) { const mime = ((r.responseHeaders || '').match(/content-type:\s*([^\r\n;]+)/i) || [, 'image/jpeg'])[1].trim(); resolve({ bytes: new Uint8Array(r.response), mime }); } else reject(new Error('img ' + r.status)); },
          onerror: () => reject(new Error('img error')), ontimeout: () => reject(new Error('img timeout')) });
      } catch (e) { reject(e); }
    });
  }

  /* ============================ helpers ============================ */
  const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[　]/g, ' ').replace(/\s+/g, ' ').trim();
  const ST_FOLD = { 話: '话', 後: '后', 錄: '录', 節: '节', 閒: '闲', 終: '终', 聲: '声', 記: '记', 號: '号', 間: '间', 戰: '战', 卷: '卷', 話语: '话语' };
  const norm = (s) => (s || '').replace(/[\s　]/g, '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30))   // full-width digits -> half
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))      // full-width letters -> half
    .replace(/[話後錄節閒終聲記號間戰]/g, (c) => ST_FOLD[c] || c)                          // common trad heading chars -> simp (so TOC/body match across scripts)
    .toLowerCase();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const decodeHtml = (s) => { if (!s || s.indexOf('&') < 0) return s || ''; const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };
  const safeFile = (s) => (String(s || 'book').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'book');
  const cleanTitle = (t) => decodeHtml((t || '').replace(/\s*\[[^\]]*\]\s*$/g, '').trim() || (t || ''));
  function commonPrefix(strs) { if (strs.length < 2) return ''; let p = strs[0]; for (const t of strs) { let i = 0; while (i < p.length && i < t.length && p[i] === t[i]) i++; p = p.slice(0, i); if (!p) break; } return p; }
  function chapterLabels(titles) { const p = commonPrefix(titles); const out = p.length < 6 ? titles.slice() : titles.map((t) => (t.slice(p.length).replace(/^[\s·:：、\-—_.]+/, '').trim() || t)); return out.map(decodeHtml); }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => { [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }); });
    doc.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    doc.querySelectorAll('img').forEach((img) => { const s = img.getAttribute('src'); if (s && s.startsWith('//')) img.setAttribute('src', 'https:' + s); img.setAttribute('loading', 'lazy'); });
    return doc.body.innerHTML;
  }

  /* ====================== auto chapterizer ======================== */
  // Heading pattern is only a FALLBACK; primary detection uses the in-text 目錄 block (keyword-agnostic).
  const HEAD_RE = /^(?:第\s*[0-9０-９一二三四五六七八九十百千零〇兩两]+\s*[話话章回卷部節节]|序\s*(?:[章話话幕])?|終\s*[章話话]|最[終终]\s*[話话章]|幕\s*間|幕\s*间|間\s*章|间\s*章|楔\s*子|引\s*子|尾\s*[聲声]|後\s*記|后\s*记|あとがき|プロローグ|エピローグ|Chapter\s*\d+|Prologue|Epilogue|Part\s*\d+)/i;
  const TOC_MARKER = /^(?:CONTENTS?|目\s*[錄录次]|もくじ|Contents)$/i;
  const stripBrackets = (t) => (t || '').replace(/^[\s　【\[［（(〔「『]+/, '').replace(/[\s　】\]］）)〕」』]+$/, '');
  // a "label-only" TOC line: a bracketed tag (【第一话】/【闲话】/[番外]) or a bare chapter number with no subtitle
  const labelOnly = (t) => /^[【\[［（(〔「『]\s*[^】\]］）)〕」』]{1,12}\s*[】\]］）)〕」』]\s*$/.test(t) || /^第\s*[0-9０-９一二三四五六七八九十百千零〇兩两]+\s*[话話章回卷節节]\s*$/.test(t);
  const isHead = (t) => { if (!t || t.length > 44) return false; return HEAD_RE.test(t) || HEAD_RE.test(stripBrackets(t)); };
  function splitBlocks(html) { return html.split(/<br\s*\/?>|<\/?p[^>]*>|<\/?div[^>]*>|<\/?h[1-6][^>]*>/i).map((h) => ({ html: h, text: stripTags(h) })); }
  function chapterize(html) {
    const B = splitBlocks(html); const N = B.length;
    // 1) find the in-text 目录 / CONTENTS marker, then the run of short lines after it = raw TOC entries
    let marker = -1;
    for (let i = 0; i < Math.min(N, 500); i++) { if (TOC_MARKER.test(B[i].text.trim())) { marker = i; break; } }
    const rawToc = []; const seenToc = [];
    if (marker >= 0) {
      let blanks = 0;
      for (let i = marker + 1; i < N; i++) {
        const t = B[i].text.trim();
        if (!t) { blanks++; if (blanks >= 3 && rawToc.length) break; continue; }
        blanks = 0; if (t.length > 48) break;
        const nt = norm(t);
        // the body repeats chapter 1's heading right after the 目录 → that re-appearance marks the TOC's end.
        // detect it precisely: an EXACT repeat of an earlier entry, or a single line containing ≥2 distinct
        // earlier entries (a combined "【第一话】 掷骰子问题" body heading). Avoids false-stopping on a later
        // legit entry that merely shares a substring with an earlier one (番外篇 / 番外篇·终).
        if (rawToc.length >= 2) {
          if (seenToc.includes(nt)) break;
          const hits = new Set(seenToc.filter((c) => c.length >= 2 && nt.includes(c)));
          if (hits.size >= 2) break;
        }
        rawToc.push({ i, text: t }); seenToc.push(nt); if (rawToc.length > 300) break;
      }
    }
    let toc = [], bounds = [];
    if (rawToc.length >= 2) {
      // 2) group the raw lines into chapters: a label-only line (【第一话】) absorbs the following subtitle
      const groups = [];
      for (let k = 0; k < rawToc.length; k++) {
        if (labelOnly(rawToc[k].text) && k + 1 < rawToc.length && !labelOnly(rawToc[k + 1].text) && !isHead(rawToc[k + 1].text)) { groups.push([rawToc[k], rawToc[k + 1]]); k++; }
        else groups.push([rawToc[k]]);
      }
      // 3) match each chapter in the body (loose contains, in document order); a heading line may be the
      //    label, the subtitle, or both combined — any of the group's lines (raw + bracket-stripped) counts.
      const tocEnd = rawToc[rawToc.length - 1].i; let ptr = tocEnd + 1;
      const match = (nb, nd) => nb === nd || (nd.length >= 4 && nb.includes(nd)) || (nb.length >= 4 && nd.includes(nb));
      groups.forEach((g) => {
        const needles = []; g.forEach((x) => { const a = norm(x.text); if (a) needles.push(a); const b = norm(stripBrackets(x.text)); if (b && b !== a) needles.push(b); });
        let found = null;
        for (let i = ptr; i < N; i++) { const bt = B[i].text.trim(); if (!bt || bt.length > 80) continue; const nb = norm(bt); if (needles.some((nd) => nd.length >= 2 && match(nb, nd))) { found = i; break; } }
        if (found != null) ptr = found + 1;
        toc.push({ title: g.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim(), bound: found });
      });
      bounds = [...new Set(toc.map((t) => t.bound).filter((b) => b != null))].sort((a, b) => a - b);
    }
    // 4) fallback when no usable 目录: bracket-tolerant heading pattern + substantial body between headings
    if (bounds.length < 2) {
      const H = []; B.forEach((b, i) => { if (isHead(b.text)) H.push(i); });
      const fb = H.filter((h, k) => { const s = H[k] + 1, e = k + 1 < H.length ? H[k + 1] : N; let n = 0; for (let j = s; j < e; j++) n += B[j].text.length; return n >= 400; });
      if (fb.length >= 2) { bounds = fb; toc = fb.map((i) => ({ title: B[i].text.trim(), bound: i })); }
    }
    // nothing deleted — heading lines stay inline; sections derive from bounds (user-editable).
    // toc = the full chapter catalogue from the 目录 (entries with bound=null are listed greyed as 未完成).
    return { blocks: B, bounds: bounds.length >= 2 ? bounds : [], toc };
  }

  /* ================== EPUB / TXT (web-API content) ================ */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(entries) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data), size = data.length;
      const lh = new Uint8Array(30 + name.length); const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true); dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); lh.set(name, 30);
      parts.push(lh, data);
      const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); ch.set(name, 46);
      central.push(ch); off += lh.length + size;
    }
    let cs = 0; central.forEach((c) => (cs += c.length));
    const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cs, true); ev.setUint32(16, off, true);
    const all = [...parts, ...central, eocd]; let tot = 0; all.forEach((c) => (tot += c.length));
    const o = new Uint8Array(tot); let p = 0; for (const c of all) { o.set(c, p); p += c.length; } return o;
  }
  const U8 = (s) => new TextEncoder().encode(s);
  const extOf = (m) => (m.includes('png') ? 'png' : m.includes('gif') ? 'gif' : m.includes('webp') ? 'webp' : m.includes('svg') ? 'svg' : 'jpg');
  function uuid() { try { return crypto.randomUUID(); } catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }); } }
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    doc.querySelectorAll('img').forEach((i) => i.replaceWith('［插图］'));
    doc.querySelectorAll('p,div,hr,h1,h2,h3,h4,li,tr').forEach((b) => b.append('\n'));
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  async function buildEpub(bookTitle, author, srcUrl, chapters, coverUrl, onP, meta) {
    const urls = new Set();
    chapters.forEach((ch) => { const d = new DOMParser().parseFromString(ch.html, 'text/html'); d.querySelectorAll('img').forEach((img) => { let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s; if (/^https?:/i.test(s)) urls.add(s); }); });
    const imgMap = new Map(); let idx = 0; const ul = [...urls];
    for (let i = 0; i < ul.length; i++) { onP && onP(`正在嵌入插图 ${i + 1}/${ul.length}…`); try { const { bytes, mime } = await gmBytes(ul[i]); imgMap.set(ul[i], { name: 'img_' + (idx++) + '.' + extOf(mime), bytes, mime }); } catch { /* remote */ } }
    // cover: prefer the book's cover field; else the first portrait-ish content image
    onP && onP('正在获取封面…');
    let coverImg = null, coverMeta = '';
    if (coverUrl) { let u = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl; try { const { bytes, mime } = await gmBytes(u); coverImg = { name: 'cover.' + extOf(mime), bytes, mime }; } catch { /* */ } }
    if (!coverImg) {
      outer: for (const ch of chapters) {
        const d = new DOMParser().parseFromString(ch.html, 'text/html');
        for (const img of d.querySelectorAll('img')) {
          const w = +(img.getAttribute('img-width') || img.getAttribute('width') || 0), h = +(img.getAttribute('img-height') || img.getAttribute('height') || 0);
          if (w && h && h < w * 1.15) continue; // skip landscape banners
          let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s; if (!/^https?:/i.test(s)) continue;
          try { const { bytes, mime } = await gmBytes(s); coverImg = { name: 'cover.' + extOf(mime), bytes, mime }; break outer; } catch { /* */ }
        }
      }
    }
    onP && onP('正在打包 EPUB…');
    const labels = chapterLabels(chapters.map((c) => c.title));
    const bid = 'urn:uuid:' + uuid();
    const v3 = String(settings.epubVer || 3) !== '2';               // EPUB3 by default; settings lets the user fall back to EPUB2
    const xhtmlOf = (ch, n) => {
      const d = new DOMParser().parseFromString('<div class="ch">' + ch.html + '</div>', 'text/html');
      d.querySelectorAll('script,style,iframe,object,embed').forEach((x) => x.remove());
      d.querySelectorAll('*').forEach((el) => { [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }); });
      d.querySelectorAll('img').forEach((img) => {
        let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s;
        const l = imgMap.get(s);
        if (!l) { img.remove(); return; }              // not embedded (fetch failed) → drop it so the EPUB stays self-contained (no remote refs)
        [...img.attributes].forEach((a) => { if (!/^(alt|class|id|width|height)$/i.test(a.name)) img.removeAttribute(a.name); }); // strip LK's img-width/img-height/loading/etc.
        img.setAttribute('src', 'images/' + l.name);
        if (!img.getAttribute('alt')) img.setAttribute('alt', '');
      });
      let bx; try { bx = new XMLSerializer().serializeToString(d.body.firstChild); } catch { bx = '<div>' + esc(htmlToText(ch.html)).replace(/\n/g, '<br/>') + '</div>'; }
      return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>' + esc(labels[n] || ch.title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>' + esc(ch.title) + '</h1>' + bx + '</body></html>';
    };
    const manifest = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', '<item id="css" href="style.css" media-type="text/css"/>'];
    const spine = [], nav = [];
    const entries = [
      { name: 'mimetype', data: U8('application/epub+zip') },
      { name: 'META-INF/container.xml', data: U8('<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
      { name: 'OEBPS/style.css', data: U8('body{font-family:serif;line-height:1.8;margin:1em auto;max-width:42em;padding:0 1em}h1{font-size:1.3em;text-align:center;margin:1.2em 0;line-height:1.4}p{margin:.6em 0}img{max-width:100%;height:auto;display:block;margin:1em auto}hr{border:none;border-top:1px solid #ccc;margin:1.4em 0}ol.lkir-toc{list-style:decimal;line-height:2.1;padding-left:1.6em}ol.lkir-toc a{text-decoration:none;color:#3358cc}') },
    ];
    // a clickable in-content 目录 page (also the EPUB3 Navigation Document when v3)
    const navLinks = chapters.map((ch, n) => '<li><a href="chap_' + n + '.xhtml">' + esc(labels[n] || ch.title) + '</a></li>').join('');
    const navOl = '<ol class="lkir-toc">' + navLinks + '</ol>';
    const navBody = v3 ? ('<nav epub:type="toc" id="toc"><h1>目录</h1>' + navOl + '</nav>') : ('<h1>目录</h1>' + navOl);
    entries.push({ name: 'OEBPS/nav.xhtml', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"' + (v3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : '') + '><head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>' + navBody + '</body></html>') });
    manifest.push('<item id="navpage" href="nav.xhtml" media-type="application/xhtml+xml"' + (v3 ? ' properties="nav"' : '') + '/>');
    spine.push('<itemref idref="navpage"/>');
    nav.push('<navPoint id="nptoc" playOrder="1"><navLabel><text>目录</text></navLabel><content src="nav.xhtml"/></navPoint>');
    chapters.forEach((ch, n) => { const f = 'chap_' + n + '.xhtml'; entries.push({ name: 'OEBPS/' + f, data: U8(xhtmlOf(ch, n)) }); manifest.push('<item id="ch' + n + '" href="' + f + '" media-type="application/xhtml+xml"/>'); spine.push('<itemref idref="ch' + n + '"/>'); nav.push('<navPoint id="np' + n + '" playOrder="' + (n + 2) + '"><navLabel><text>' + esc(labels[n] || ch.title) + '</text></navLabel><content src="' + f + '"/></navPoint>'); });
    imgMap.forEach((v) => { entries.push({ name: 'OEBPS/images/' + v.name, data: v.bytes }); manifest.push('<item id="' + v.name.replace(/\W/g, '_') + '" href="images/' + v.name + '" media-type="' + v.mime + '"/>'); });
    if (coverImg) {
      entries.push({ name: 'OEBPS/images/' + coverImg.name, data: coverImg.bytes });
      manifest.push('<item id="cover-img" href="images/' + coverImg.name + '" media-type="' + coverImg.mime + '" properties="cover-image"/>');
      entries.push({ name: 'OEBPS/cover.xhtml', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>封面</title></head><body style="margin:0;padding:0;text-align:center"><img src="images/' + coverImg.name + '" alt="cover" style="max-width:100%;height:auto"/></body></html>') });
      manifest.push('<item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      spine.unshift('<itemref idref="coverpage"/>');
      coverMeta = v3 ? '' : '<meta name="cover" content="cover-img"/>';  // v3 marks the cover via properties="cover-image" on the item
    }
    // Full credit set in the OPF. EPUB3 (default) writes MARC roles via <meta refines property="role"> and
    // series via belongs-to-collection; EPUB2 (fallback) uses opf:role + calibre:series. Calibre natively
    // surfaces aut/edt/bkp; trl/ill round-trip invisibly, so we also drop a searchable dc:subject tag.
    const md = meta || {};
    let mid = 0; const nid = () => 'cr' + (mid++);
    const person = (tag, name, role, fileAs) => {                   // <dc:creator|contributor> with a MARC relator role
      if (!name) return '';
      if (v3) { const id = nid(); return '<dc:' + tag + ' id="' + id + '">' + esc(name) + '</dc:' + tag + '>'
          + '<meta refines="#' + id + '" property="role" scheme="marc:relators">' + role + '</meta>'
          + (fileAs ? '<meta refines="#' + id + '" property="file-as">' + esc(fileAs) + '</meta>' : ''); }
      return '<dc:' + tag + ' opf:role="' + role + '"' + (fileAs ? ' opf:file-as="' + esc(fileAs) + '"' : '') + '>' + esc(name) + '</dc:' + tag + '>';
    };
    const personsMulti = (val, role) => String(val || '').split(/[、，,\/／&＆]/).map((s) => s.trim()).filter(Boolean).map((n) => person('contributor', n, role)).join('');
    const cmeta = (name, content) => (content != null && content !== '') ? '<meta name="' + name + '" content="' + esc(String(content)) + '"/>' : '';
    const subj = (v) => v ? '<dc:subject>' + esc(String(v)) + '</dc:subject>' : '';
    let seriesMeta = '';
    if (md.series) {
      if (v3) { const id = nid(); seriesMeta += '<meta property="belongs-to-collection" id="' + id + '">' + esc(String(md.series)) + '</meta><meta refines="#' + id + '" property="collection-type">series</meta>'
          + (md.volume != null && md.volume !== '' ? '<meta refines="#' + id + '" property="group-position">' + esc(String(md.volume)) + '</meta>' : ''); }
      seriesMeta += cmeta('calibre:series', md.series) + (md.volume != null && md.volume !== '' ? cmeta('calibre:series_index', md.volume) : '');
    }
    const creators = person('creator', author, 'aut', author)
      + ((md.original && md.original !== author) ? person('creator', md.original, 'aut') : '');
    const extraMeta = personsMulti(md.translator, 'trl') + personsMulti(md.illustrator, 'ill') + personsMulti(md.editor, 'edt') + personsMulti(md.sourceGroup, 'bkp')
      + seriesMeta
      + (md.updated ? '<dc:date>' + esc(String(md.updated)) + '</dc:date>' : '')
      + (md.tags || []).map(subj).join('')
      + subj(md.translator && '译者:' + md.translator) + subj(md.illustrator && '插画:' + md.illustrator) + subj(md.sourceGroup && '图源:' + md.sourceGroup);
    const modMeta = v3 ? '<meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</meta>' : '';
    entries.push({ name: 'OEBPS/content.opf', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="' + (v3 ? '3.0' : '2.0') + '" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>' + esc(bookTitle) + '</dc:title>' + creators + '<dc:language>zh</dc:language><dc:identifier id="bookid">' + bid + '</dc:identifier><dc:source>' + esc(srcUrl) + '</dc:source>' + modMeta + extraMeta + coverMeta + '</metadata><manifest>' + manifest.join('') + '</manifest><spine toc="ncx">' + spine.join('') + '</spine></package>') });
    entries.push({ name: 'OEBPS/toc.ncx', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="' + bid + '"/><meta name="dtb:depth" content="1"/></head><docTitle><text>' + esc(bookTitle) + '</text></docTitle><navMap>' + nav.join('') + '</navMap></ncx>') });
    return { bytes: makeZip(entries), name: safeFile(bookTitle) + '.epub' };
  }
  function buildTxt(bookTitle, author, srcUrl, chapters) {
    let out = bookTitle + '\n作者：' + author + '\n来源：' + srcUrl + '\n\n';
    chapters.forEach((ch) => { out += '\n\n========== ' + ch.title + ' ==========\n\n' + htmlToText(ch.html) + '\n'; });
    return { text: out, name: safeFile(bookTitle) + '.txt' };
  }
  function download(data, name, mime) { const b = new Blob([data], { type: mime }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }

  /* ============================== CSS ============================= */
  const CSS = `
:host { all: initial; } * { box-sizing: border-box; font-family: var(--ir-font); }
.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--ir-bg); color: var(--ir-text); display: none; } .overlay.open { display: block; }
.cluster { position: absolute; top: 14px; z-index: 14; display: flex; align-items: center; gap: 6px; }
.cl-left { left: 14px; }
.cbtn { width: 36px; height: 36px; border: none; border-radius: 11px; background: color-mix(in srgb, var(--ir-surface) 70%, transparent); backdrop-filter: blur(8px); color: var(--ir-text); cursor: pointer; font-size: 17px; line-height: 1; display: flex; align-items: center; justify-content: center; opacity: .4; box-shadow: 0 1px 5px rgba(0,0,0,.12); transition: opacity .16s, background .16s, transform .16s; }
.cbtn:hover { opacity: 1; background: color-mix(in srgb, var(--ir-surface) 97%, transparent); }
.cl-left:hover #t-outline { opacity: .92; }
.cbtn.reveal { opacity: 0; pointer-events: none; transform: translateX(-6px); }
.cl-left:hover .cbtn.reveal { opacity: .85; pointer-events: auto; transform: none; }
.overlay.panel-open #t-set { opacity: 1 !important; pointer-events: auto !important; transform: none !important; }
/* 沉浸阅读 / 退出 sit clear of the right-edge minimap so toggling it never shifts them */
.exit-btn { position: absolute; right: 116px; bottom: 26px; z-index: 16; display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; cursor: pointer; border-radius: 999px; background: color-mix(in srgb, var(--ir-surface) 92%, transparent); color: var(--ir-text); font-size: 13.5px; font-weight: 700; box-shadow: 0 6px 22px rgba(0,0,0,.2); border: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); backdrop-filter: blur(8px); transition: transform .15s, color .15s; }
.exit-btn:hover { transform: translateY(-2px); color: #e0533d; }
.overlay.panel-open .exit-btn { display: none; }
.edit-float { display: none; }
.icon-btn { width: 36px; height: 36px; border: none; background: none; cursor: pointer; color: var(--ir-text); opacity: .72; border-radius: 9px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; } .icon-btn:hover { opacity: 1; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); }
.progress { position: absolute; top: 0; left: 0; height: 3px; background: #6366f1; z-index: 13; width: 0; transition: width .12s; }
.scroll { position: absolute; inset: 0; overflow-y: auto; }
.content { max-width: var(--ir-width); margin: 0 auto; padding: 64px 24px 96px; font-size: var(--ir-fs); line-height: var(--ir-lh); }
.content h1.t { font-size: 1.5em; font-weight: 800; text-align: center; margin: 0 0 12px; } .content .meta { text-align: center; color: var(--ir-muted); font-size: .72em; margin-bottom: 36px; }
.body p { margin: 0 0 .9em; } .body img { max-width: 100% !important; height: auto !important; display: block; margin: 1.3em auto; border-radius: 8px; } .body a { color: #6366f1; word-break: break-all; } .body hr { border: none; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 35%, transparent); margin: 1.4em 0; } .body table { max-width: 100%; }
/* seamless web-novel flow: a WIDE, unmistakable gap between chapters (hairline + centered ornament).
   The divider is part of the chapter BELOW it and only the book's true first chapter (data-ci="0")
   goes without one — position-independent, so prepending can't change a neighbour's height and
   shift the page. Spacers stand in for unloaded chapters. */
.chap { margin-top: 30px; }
.chap:not([data-ci="0"])::before { content: '❖'; display: block; text-align: center; color: color-mix(in srgb, var(--ir-muted) 75%, transparent); font-size: .85em; line-height: 1; padding-top: 52px; margin: 0 0 52px; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 26%, transparent); }
.chap h1.t { font-size: 1.42em; font-weight: 800; text-align: center; margin: 0 0 10px; line-height: 1.4; }
.chap .meta { text-align: center; color: var(--ir-muted); font-size: .72em; margin-bottom: 30px; }
.chap-spacer { width: 100%; }
/* lazy chunk rendering: offscreen chunks skip layout/paint entirely; contain-intrinsic-size (inline,
   estimated from text length) is the placeholder height, and 'auto' remembers the real height once
   rendered so a re-skipped chunk can never shift the scroll position */
.chunk { content-visibility: auto; }
.flow-load { text-align: center; color: var(--ir-muted); font-size: .8em; padding: 18px 0; }
/* flow owns all scroll compensation (spacer math + ResizeObserver pinning) — turn the browser's native
   scroll anchoring off so the two never double-correct the same mutation */
.scroll.flow { overflow-anchor: none; }
.foot { display: flex; gap: 12px; justify-content: space-between; margin-top: 50px; padding-top: 24px; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 22%, transparent); }
.foot button { flex: 1; padding: 12px; border-radius: 12px; cursor: pointer; font-size: 14px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); background: var(--ir-surface); color: var(--ir-text); } .foot button.primary { background: #6366f1; color: #fff; border-color: #6366f1; } .foot button:disabled { opacity: .35; cursor: not-allowed; }
.rail { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 7px 5px; border-radius: 18px; background: color-mix(in srgb, var(--ir-surface) 90%, transparent); border: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); backdrop-filter: blur(10px); box-shadow: 0 8px 26px rgba(0,0,0,.16); }
.rail button { width: 52px; padding: 8px 4px; border: none; background: none; color: var(--ir-text); cursor: pointer; border-radius: 12px; opacity: .7; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; } .rail button:hover:not(:disabled) { opacity: 1; color: #6366f1; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); } .rail button:disabled { opacity: .28; cursor: not-allowed; } .rail .ic { font-size: 16px; line-height: 1; } .rail .sep { height: 1px; margin: 3px 8px; background: color-mix(in srgb, var(--ir-muted) 20%, transparent); }
@media (max-width: 820px) { .rail { display: none; } }
.panel { position: absolute; top: 0; bottom: 0; width: 340px; z-index: 10; background: var(--ir-surface); color: var(--ir-text); box-shadow: 0 0 40px rgba(0,0,0,.3); display: flex; flex-direction: column; transition: transform .26s; } .panel.right { right: 0; transform: translateX(100%); } .panel.left { left: 0; transform: translateX(-100%); } .panel.show { transform: translateX(0); }
.panel h3 { margin: 0; padding: 18px 18px 12px; font-size: 15px; font-weight: 700; display: flex; align-items: center; } .panel h3 .x { margin-left: auto; } .panel .pbody { padding: 10px 14px 18px; overflow-y: auto; }
.ctabs { display: flex; gap: 6px; padding: 0 16px 12px; border-bottom: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); }
.ctabs button { flex: 1; padding: 7px; border: none; background: color-mix(in srgb, var(--ir-muted) 12%, transparent); color: var(--ir-text); border-radius: 9px; cursor: pointer; font-size: 13px; font-weight: 600; opacity: .7; } .ctabs button.active { background: #6366f1; color: #fff; opacity: 1; }
.grp { margin-bottom: 22px; } .grp .lbl { font-size: 13px; font-weight: 600; opacity: .8; margin-bottom: 10px; } .grp .lbl b { color: #6366f1; margin-left: 4px; }
.swatches { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; } .sw { height: 44px; border-radius: 10px; border: 2px solid transparent; cursor: pointer; font-size: 12px; font-weight: 600; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); } .sw.active { border-color: #6366f1; }
.custom-in { display: flex; align-items: center; gap: 8px; } .custom-in input { flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: color-mix(in srgb, var(--ir-muted) 8%, transparent); color: var(--ir-text); font-size: 13px; font-family: ui-monospace, Menlo, Consolas, monospace; } .custom-sw { width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
.lib-in { width: 100%; margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: color-mix(in srgb, var(--ir-muted) 8%, transparent); color: var(--ir-text); font-size: 12.5px; font-family: ui-monospace, Menlo, Consolas, monospace; }
input[type=range] { width: 100%; accent-color: #6366f1; }
.seg { display: inline-flex; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); border-radius: 9px; overflow: hidden; } .seg button { padding: 6px 14px; border: none; background: none; color: var(--ir-text); cursor: pointer; font-size: 13px; } .seg button.active { background: #6366f1; color: #fff; }
.toggle { display: flex; align-items: center; justify-content: space-between; }
.cat-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; border: none; background: none; color: inherit; cursor: pointer; padding: 9px 8px; border-radius: 8px; font-size: 13px; opacity: .8; } .cat-item:hover { background: color-mix(in srgb, var(--ir-muted) 14%, transparent); opacity: 1; } .cat-item.active { color: #6366f1; font-weight: 650; opacity: 1; background: color-mix(in srgb, #6366f1 12%, transparent); } .cat-item .n { flex-shrink: 0; min-width: 1.8em; text-align: right; opacity: .45; }
.scrim { position: absolute; inset: 0; z-index: 9; background: rgba(0,0,0,.25); display: none; } .scrim.show { display: block; }
.loading { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--ir-muted); font-size: 14px; }
.dlg { position: absolute; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.4); } .dlg.show { display: flex; } .dlg-card { width: 320px; max-height: 90vh; overflow-y: auto; background: var(--ir-surface); color: var(--ir-text); border-radius: 16px; padding: 22px; box-shadow: 0 16px 50px rgba(0,0,0,.4); text-align: center; } .dlg-card .t { font-size: 17px; font-weight: 800; margin-bottom: 6px; } .dlg-card .m { font-size: 13px; opacity: .65; margin-bottom: 18px; min-height: 1.2em; } .dlg-card .acts { display: flex; flex-direction: column; gap: 10px; } .dlg-card .acts button { padding: 12px; border-radius: 11px; border: none; cursor: pointer; font-size: 14px; font-weight: 700; } .dl-range { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; text-align: left; }
.dl-rng-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.dl-rng-right { display: flex; align-items: center; gap: 8px; font-weight: 400; }
#dlRngCount { opacity: .55; font-size: 11px; font-variant-numeric: tabular-nums; }
.dl-rng-all { border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); background: none; color: var(--ir-text); border-radius: 7px; padding: 3px 9px; cursor: pointer; font-size: 11px; opacity: .82; }
.dl-rng-all:hover { opacity: 1; border-color: #6366f1; color: #6366f1; }
.dl-rng-tip { font-size: 11px; opacity: .6; margin-bottom: 8px; line-height: 1.4; min-height: 1.3em; }
.dl-nums { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
.dl-nums label { display: flex; align-items: center; gap: 5px; font-size: 12px; opacity: .8; }
.dl-nums input[type=number] { width: 72px; padding: 6px 8px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: color-mix(in srgb, var(--ir-muted) 8%, transparent); color: var(--ir-text); font-size: 13px; font-weight: 700; text-align: center; }
.dl-nums input[type=number]:focus { outline: none; border-color: #6366f1; }
.dl-num-sep { opacity: .5; font-weight: 700; }
/* the chapter range picker: click a start chapter, then an end chapter (hotel/flight style) */
.dlg-card.has-range { width: 380px; max-width: 92vw; }
.dl-list { max-height: 44vh; overflow-y: auto; margin: 0 0 14px; border: 1px solid color-mix(in srgb, var(--ir-muted) 22%, transparent); border-radius: 10px; padding: 4px; }
.dl-ch { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; border: none; background: none; color: inherit; cursor: pointer; padding: 7px 9px; border-radius: 7px; font-size: 12.5px; opacity: .85; }
.dl-ch:hover { background: color-mix(in srgb, var(--ir-muted) 14%, transparent); opacity: 1; }
.dl-ch .n { flex-shrink: 0; min-width: 2.2em; text-align: right; opacity: .45; font-variant-numeric: tabular-nums; }
.dl-ch .ttl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-ch.in { background: color-mix(in srgb, #6366f1 13%, transparent); opacity: 1; }
.dl-ch.end1 { background: #4f46e5; color: #fff; opacity: 1; font-weight: 650; }
.dl-ch.end1 .n { opacity: .85; color: #fff; }
.dlg-card .acts .lib { background: #4f46e5; color: #fff; } .dlg-card .acts .lib:hover { background: #4338ca; } .dlg-card .acts .epub { background: color-mix(in srgb, #6366f1 16%, transparent); color: var(--ir-text); } .dlg-card .acts .txt { background: color-mix(in srgb, var(--ir-muted) 18%, transparent); color: var(--ir-text); } .dlg-card .cancel { margin-top: 14px; border: none; background: none; color: var(--ir-muted); cursor: pointer; font-size: 13px; }
.ch-sep { height: 0; border-top: 1px dashed color-mix(in srgb, var(--ir-muted) 32%, transparent); margin: 2.4em auto 1.8em; max-width: 60%; }
.ch-inner { display: block; }
.body.editing .ch-inner { font-size: .94em; }
.blk { display: inline; border-radius: 4px; cursor: pointer; }
.body.editing .blk { box-shadow: -10px 0 0 -8px transparent; }
.body.editing .blk:hover { background: color-mix(in srgb, #6366f1 16%, transparent); box-shadow: -1.4em 0 0 -2px #6366f1; }
.body.editing .blk:hover::before { content: '＋分章'; position: relative; left: -1.3em; font-size: 10px; color: #fff; }
.ch-sep.edit { height: auto; max-width: 100%; margin: 1.4em 0 .8em; border: none; display: flex; align-items: center; gap: 10px; padding: 6px 8px; background: color-mix(in srgb, #6366f1 10%, transparent); border-radius: 8px; }
.sep-x { border: none; background: #e0533d; color: #fff; border-radius: 7px; padding: 4px 9px; cursor: pointer; font-size: 12px; font-weight: 600; }
.sep-t { font-size: 13px; font-weight: 700; opacity: .8; }
.r-tail { max-width: var(--ir-width); margin: 60px auto 0; text-align: center; }
.r-end { color: var(--ir-muted); font-size: .8em; margin-bottom: 14px; }
.r-tail-btn { border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: var(--ir-surface); color: var(--ir-text); border-radius: 10px; padding: 8px 16px; cursor: pointer; font-size: 12.5px; opacity: .8; }
.r-tail-btn:hover { opacity: 1; }
.r-tail-box { margin-top: 14px; text-align: left; border: 1px dashed color-mix(in srgb, var(--ir-muted) 35%, transparent); border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.7; opacity: .85; }
.tail-h { font-size: 12px; opacity: .6; margin-bottom: 8px; }
.tail-l { white-space: pre-wrap; }
.cat-item.empty { opacity: .42; cursor: default; }
.cat-item.empty:hover { background: none; }
.cat-tag { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--ir-muted) 24%, transparent); }
.cat-note { opacity: .5; font-size: 13px; padding: 8px 14px; line-height: 1.65; }
.set-btn { width: 100%; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); background: color-mix(in srgb, #6366f1 8%, transparent); color: var(--ir-text); border-radius: 10px; padding: 10px; cursor: pointer; font-size: 13.5px; font-weight: 600; }
.set-hint { font-size: 11.5px; opacity: .5; margin-top: 7px; line-height: 1.5; }
/* advanced / experimental — accessible disclosure (button + region), not <details> */
.set-adv { border-top: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); margin-top: 16px; padding-top: 4px; }
.set-adv-h { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none; color: var(--ir-text); cursor: pointer; font-weight: 600; font-size: 13.5px; font-family: inherit; padding: 10px 2px; }
.set-adv-h .set-adv-caret { margin-left: auto; opacity: .55; font-size: 11px; transition: transform .15s; }
.set-adv-h[aria-expanded="true"] .set-adv-caret { transform: rotate(90deg); }
.set-adv-body[hidden] { display: none; }
.set-adv-body { padding-top: 2px; }
.set-sub { padding-top: 14px; margin-top: 6px; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 14%, transparent); }
.set-sub:first-child { border-top: none; padding-top: 4px; margin-top: 0; }
.set-sub-h { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 650; margin-bottom: 4px; }
.set-tag { font-size: 10px; font-weight: 600; color: #c9702f; background: color-mix(in srgb, #c9702f 14%, transparent); border-radius: 6px; padding: 1px 6px; }
.qmark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 50%; font-size: 10px; font-weight: 700; line-height: 1; background: color-mix(in srgb, var(--ir-muted) 26%, transparent); color: var(--ir-text); cursor: pointer; opacity: .65; vertical-align: middle; flex-shrink: 0; font-family: inherit; }
.qmark:hover { opacity: 1; }
.qmark.on { opacity: 1; background: color-mix(in srgb, #6366f1 80%, transparent); color: #fff; }
/* ? help: a floating popover anchored to the button (not an inline accordion) */
.qpop { position: absolute; z-index: 30; max-width: 250px; background: var(--ir-surface); color: var(--ir-text); border: 1px solid color-mix(in srgb, var(--ir-muted) 24%, transparent); border-radius: 10px; padding: 9px 11px; font-size: 11.5px; line-height: 1.55; box-shadow: 0 10px 30px rgba(0,0,0,.3); opacity: .96; display: none; }
.qpop.show { display: block; }
/* toggle rows are real <label>s so clicking the text flips the checkbox */
.toggle { cursor: pointer; gap: 6px; }
.toggle .lbl { margin: 0; }
.toggle input[type=checkbox] { margin-left: auto; }
input[type=checkbox] { accent-color: #6366f1; width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
.toast { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%) translateY(10px); z-index: 40; background: rgba(20,22,28,.94); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.outline { position: absolute; left: 0; top: 0; bottom: 0; width: 312px; max-width: 86vw; z-index: 12; background: var(--ir-bg); display: flex; flex-direction: column; padding-top: 60px; transform: translateX(-100%); transition: transform .22s ease; }
.overlay.ol-on .outline { transform: none; }
.ol-title { flex-shrink: 0; padding: 12px 18px 0; margin-bottom: 14px; font-size: 14.5px; font-weight: 750; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: break-word; }
.ol-title:empty { display: none; }
.ol-tabs { display: flex; gap: 6px; padding: 2px 14px 9px; }
.ol-tabs button { flex: 1; padding: 7px 6px; border: none; background: color-mix(in srgb, var(--ir-muted) 12%, transparent); color: var(--ir-text); border-radius: 8px; cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .68; white-space: nowrap; }
.ol-tabs button.active { background: #6366f1; color: #fff; opacity: 1; }
.ol-tabs .lbl-edit { display: none; }
.ol-tabs .tab-toc.active:hover { background: #e8902e; color: #fff; }
.ol-tabs .tab-toc.active:hover .lbl { display: none; }
.ol-tabs .tab-toc.active:hover .lbl-edit { display: inline; }
/* freshly-activated 目录 (mouse still on it after a click) must NOT immediately show the edit affordance */
.ol-tabs .tab-toc.active.no-edit-hover:hover { background: #6366f1; color: #fff; }
.ol-tabs .tab-toc.active.no-edit-hover:hover .lbl { display: inline; }
.ol-tabs .tab-toc.active.no-edit-hover:hover .lbl-edit { display: none; }
.ol-tabs .tab-done { background: #e0533d; color: #fff; opacity: 1; }
.ol-tabs .tab-done:hover { background: #cf4631; }
.ol-note { padding: 0 16px 8px; font-size: 11.5px; opacity: .58; line-height: 1.5; }
.ol-note:empty { display: none; }
.ol-list { flex: 1; overflow-y: auto; padding: 2px 12px 80px; position: relative; }
.ol-list::before { content: ''; position: absolute; left: 19px; top: 4px; bottom: 80px; width: 1.5px; background: color-mix(in srgb, var(--ir-muted) 20%, transparent); border-radius: 2px; }
.bm-grp { margin: 2px 0 4px; }
.bm-grp-h { font-weight: 650; opacity: .9 !important; }
.bm-grp-h .n { opacity: .5; }
.bm-item { padding-left: 24px !important; }
.bm-item .n { min-width: 1.4em; }
.bm-del { margin-left: auto; opacity: 0; padding: 1px 6px; border-radius: 6px; flex-shrink: 0; transition: opacity .14s; }
.bm-item:hover .bm-del { opacity: .55; }
.bm-del:hover { opacity: 1 !important; color: #e0533d; }
.bm-del.confirm { opacity: 1 !important; background: #e0533d; color: #fff; font-size: 11px; font-weight: 700; }
.cur-chip { position: absolute; left: 16px; bottom: 14px; z-index: 6; font-size: 11.5px; opacity: .5; background: color-mix(in srgb, var(--ir-surface) 82%, transparent); backdrop-filter: blur(6px); border: 1px solid color-mix(in srgb, var(--ir-muted) 16%, transparent); padding: 4px 11px; border-radius: 999px; max-width: 52%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; transition: opacity .2s; }
.cur-chip:hover { opacity: .92; } .cur-chip:empty { display: none; }
.overlay.ol-on .cur-chip { display: none; }   /* the open outline already shows the current chapter — hide the chip so a long name can't leak past the panel */
.bm-mark { color: #e8a33d; margin-right: 5px; cursor: pointer; font-size: .82em; vertical-align: .1em; }
.body.stream .blk.bm { background: color-mix(in srgb, #e8a33d 13%, transparent); border-radius: 4px; box-shadow: -3px 0 0 0 #e8a33d; }
.body.interactive .blk { cursor: pointer; border-radius: 4px; }
.body.interactive .blk:hover { background: color-mix(in srgb, #6366f1 15%, transparent); box-shadow: -1.3em 0 0 -2px #6366f1; }
.body.interactive.splitting .blk:hover::before { content: '＋分章'; position: relative; left: -1.25em; font-size: 10px; color: #fff; }
.body.interactive.marking .blk:hover::before { content: '＋书签'; position: relative; left: -1.25em; font-size: 10px; color: #fff; }
@media (max-width: 820px) {
  .outline { position: fixed; left: 0; top: 0; bottom: 0; width: 300px !important; z-index: 16; transform: translateX(-100%); transition: transform .2s ease; box-shadow: 0 0 44px rgba(0,0,0,.4); padding-top: 16px; }
  .overlay.ol-on .outline { transform: none; }
  .cur-chip { left: 12px; bottom: 10px; }
  .overlay.splitting .edit-float { display: inline-flex; position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 17; align-items: center; gap: 6px; padding: 10px 18px; border: none; border-radius: 999px; background: #e0533d; color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); cursor: pointer; }
}
/* ----- minimap (opt-in, canvas — pagemap-style abstract map of the whole book) ----- */
.minimap { position: absolute; right: 0; top: 0; bottom: 0; width: 96px; z-index: 4; overflow: hidden; background: color-mix(in srgb, var(--ir-muted) 8%, transparent); border-left: 1px solid color-mix(in srgb, var(--ir-muted) 16%, transparent); cursor: pointer; touch-action: none; user-select: none; }
.mm-canvas { position: absolute; top: 0; left: 0; }
/* current-screen window: neutral (theme text colour), deliberately NOT indigo so it doesn't blend with chapter marks */
.mm-view { position: absolute; left: 0; right: 0; min-height: 12px; background: color-mix(in srgb, var(--ir-text) 9%, transparent); border-top: 2px solid color-mix(in srgb, var(--ir-text) 55%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--ir-text) 55%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ir-bg) 40%, transparent); pointer-events: none; }
.minimap:active { cursor: grabbing; }
/* the native browser scrollbar is KEPT; JS positions the minimap just to its left (minimap right = scrollbar width) */
.overlay.mm-on .rail { right: 116px; }
@media (max-width: 820px) { .minimap { display: none !important; } .exit-btn { right: 16px; } .overlay.mm-on .rail { right: 16px; } }
/* ----- feature guide (re-openable from settings) ----- */
.guide { position: absolute; inset: 0; z-index: 21; display: none; pointer-events: none; }
.guide.show { display: block; pointer-events: auto; }   /* capture all clicks → reader can't be touched/mis-clicked during the guide */
.guide-card { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(560px, 88vw); background: var(--ir-surface); color: var(--ir-text); border-radius: 16px; box-shadow: 0 18px 54px rgba(0,0,0,.45); padding: 16px 20px 14px; pointer-events: auto; }
.guide-step { font-size: 11px; opacity: .5; font-weight: 700; letter-spacing: .05em; }
.guide-t { font-size: 16px; font-weight: 800; margin: 4px 0 6px; }
.guide-b { font-size: 13px; line-height: 1.7; opacity: .85; min-height: 3.4em; }
.guide-acts { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.guide-acts button { border: none; border-radius: 10px; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 700; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); color: var(--ir-text); }
.guide-acts button.primary { background: #6366f1; color: #fff; }
.guide-dots { display: flex; flex: 1; justify-content: center; gap: 6px; }
.guide-dots span { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, var(--ir-muted) 35%, transparent); }
.guide-dots span.on { background: #6366f1; }
.guide-skip { position: absolute; top: 12px; right: 14px; z-index: 2; border: none; background: none; color: var(--ir-muted); cursor: pointer; font-size: 12px; padding: 4px 6px; }   /* z-index: sit above .guide-step (opacity:.5 makes it a stacking context that would otherwise eat the click) */
.guide-hl { outline: 3px solid #6366f1 !important; outline-offset: 2px; border-radius: 8px; }
.guide-spot { position: absolute; border-radius: 10px; border: 2px solid color-mix(in srgb, #6366f1 85%, transparent); box-shadow: 0 0 0 9999px rgba(0,0,0,.55); pointer-events: none; display: none; transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease; }
.guide.show .guide-spot { display: block; }
.overlay.guide-reveal .cbtn.reveal { opacity: .95 !important; transform: none !important; }   /* reveal = make the hover button visible, NOT interactive (the guide blocks clicks) */
.launch { position: fixed; right: 116px; bottom: 26px; z-index: 2147482000; display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border: none; cursor: pointer; border-radius: 999px; background: #4f46e5; color: #fff; font-size: 14px; font-weight: 700; box-shadow: 0 4px 14px rgba(0,0,0,.18); font-family: system-ui,sans-serif; transition: transform .15s, background .15s; } .launch:hover { transform: translateY(-2px); background: #4338ca; }
@media (max-width: 820px) { .launch { right: 16px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

  const host = document.createElement('div'); host.id = 'lkir-host'; document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <button class="launch" id="launch">📖 沉浸阅读</button>
    <div class="overlay" id="overlay">
      <div class="progress" id="progress"></div>
      <div class="cluster cl-left" id="clLeft">
        <button class="cbtn" id="t-outline" title="目录 / 大纲"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
        <button class="cbtn reveal" id="t-dlCorner" title="下载整本（EPUB / TXT）" style="display:none">⤓</button>
        <button class="cbtn reveal" id="t-set" title="阅读设置">⚙</button>
      </div>
      <div class="scroll" id="scroll"><div class="content" id="content"><div class="loading">加载中…</div></div></div>
      <aside class="outline" id="outline">
        <div class="ol-title" id="outlineTitle"></div>
        <div class="ol-tabs" id="outlineTabs"></div>
        <div class="ol-note" id="outlineNote"></div>
        <div class="ol-list" id="outlineList"></div>
      </aside>
      <div class="minimap" id="minimap" style="display:none"><canvas class="mm-canvas" id="mmCanvas"></canvas><div class="mm-view" id="mmView"></div></div>
      <div class="cur-chip" id="curChip"></div>
      <button class="exit-btn" id="close" title="退出沉浸阅读 (Esc)">✕ 退出</button>
      <button class="edit-float" id="editFloat">✓ 完成调整</button>
      <div class="rail" id="rail">
        <button id="r-prev" title="上一章"><span class="ic">▲</span><span>上一章</span></button>
        <button id="r-next" title="下一章"><span class="ic">▼</span><span>下一章</span></button>
        <div class="sep"></div>
        <button id="r-top" title="回到顶部"><span class="ic">↑</span><span class="lb">顶部</span></button>
      </div>
      <div class="scrim" id="scrim"></div>
      <div class="panel right" id="setPanel"><h3>阅读设置 <button class="icon-btn x" id="setClose">✕</button></h3><div class="pbody" id="setBody"></div></div>
      <div class="dlg" id="dlg"><div class="dlg-card"><div class="t" id="dlgT">下载 / 发送整本</div><div class="m" id="dlgMsg">选择导出格式</div><div class="dl-range" id="dlRange" style="display:none"><div class="dl-rng-head"><span id="dlRngLbl">章节范围</span><span class="dl-rng-right"><span id="dlRngCount" aria-live="polite"></span><button class="dl-rng-all" id="dlRngAll">整本</button></span></div><div class="dl-nums"><label><span id="dlFromLbl">从</span><input type="number" id="dlFrom" min="1" value="1" inputmode="numeric" autocomplete="off"></label><span class="dl-num-sep">–</span><label><span id="dlToLbl">到</span><input type="number" id="dlTo" min="1" value="1" inputmode="numeric" autocomplete="off"></label></div><div class="dl-rng-tip" id="dlRngTip" aria-live="polite"></div><div class="dl-list" id="dlList" role="group" aria-label="章节范围"></div></div><div class="acts" id="dlgActs"><button class="lib" id="dl-lib" style="display:none">📚 发送到书库（Calibre）</button><button class="epub" id="dl-epub">📖 EPUB（封面+插图）</button><button class="txt" id="dl-txt">📄 TXT（纯文本）</button></div><button class="cancel" id="dlgClose">取消</button></div></div>
      <div class="guide" id="guide"><div class="guide-spot" id="guideSpot"></div><div class="guide-card"><button class="guide-skip" id="guideSkip">跳过</button><div class="guide-step" id="guideStep"></div><div class="guide-t" id="guideTitle"></div><div class="guide-b" id="guideBody"></div><div class="guide-acts"><button id="guidePrev">‹ 上一步</button><div class="guide-dots" id="guideDots"></div><button id="guideNext" class="primary">下一步 ›</button></div></div></div>
      <div class="qpop" id="qpop" role="tooltip"></div>
      <div class="toast" id="toast"></div>
    </div>`;
  const $ = (id) => root.getElementById(id);
  refreshChrome();   // render the static chrome in the current language

  /* =========================== state ============================= */
  // mode 'stream' (one article, chapterized into editable sections) | 'series' (web-novel, paged per aid)
  // mode2 'read' | 'split' | 'bookmark' (interactive sub-modes for stream)
  let S = {};
  let savedScroll = null;
  let pageAid = null;        // the aid the underlying site page is showing (null if opened from a list)
  let suppressOpen = false;  // briefly ignore auto-open right after we sync the site URL on close
  let suppressTocHover = false; // after clicking onto 目录, don't show the 调整分章 hover until the mouse leaves
  let dlFrom = 0, dlTo = 0, dlPhase = 'start'; // series download range picker (0-based inclusive; phase = which click comes next)
  function resetState(aid) {
    if (S && S.flow) flowTeardown();
    S = { aid, detail: null, raw: '', rawLen: 0, author: '', bookTitle: '', busy: false, mode: 'stream', mode2: 'read',
      blocks: [], bclean: [], bounds: [], catalog: [], sections: [], secLabels: [], cat: [], catLabels: [], manualSplit: false,
      cblocks: [], cbclean: [],
      bookmarks: [], bmConfirm: null, outlineTab: 'toc', toc: [], idx: 0, volumes: [], volLabels: [], downloadable: false,
      flow: false, win: { first: 0, last: 0 } };   // seamless web-novel: contiguous loaded-chapter window
  }
  resetState(null);
  const lightClean = (s) => (s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
  const textLen = (h) => stripTags(h).length;
  const isMobile = () => !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
  const SPLIT_KEY = (aid) => 'lkir_split_' + aid;
  const BM_KEY = (aid) => 'lkir_bm_' + aid;
  function loadSplit(aid) { try { const v = JSON.parse(localStorage.getItem(SPLIT_KEY(aid)) || 'null'); return v && Array.isArray(v.bounds) ? v : null; } catch { return null; } }
  function saveSplit() { try { localStorage.setItem(SPLIT_KEY(S.aid), JSON.stringify({ bounds: S.bounds })); } catch { /* */ } S.manualSplit = true; }
  function clearSplit() { try { localStorage.removeItem(SPLIT_KEY(S.aid)); } catch { /* */ } S.manualSplit = false; }
  function loadBM(aid) { try { const v = JSON.parse(localStorage.getItem(BM_KEY(aid)) || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } }
  // web novels bookmark per CHAPTER (the chapter's own aid); a chapterized single article bookmarks per book
  const curBmAid = () => (S.mode === 'series' && S.toc[S.idx]) ? S.toc[S.idx].aid : S.aid;
  function saveBM() { try { localStorage.setItem(BM_KEY(curBmAid()), JSON.stringify(S.bookmarks)); } catch { /* */ } }
  function flashToast(t) { const el = $('toast'); el.textContent = (curLang() === 'en' && EN[t]) ? EN[t] : t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1800); }

  // theme resolution: 'system' follows the OS, 'custom' derives a palette from one base colour
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec((h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lumOf = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  function deriveTheme(hex) {
    const bg = hexRgb(hex) || hexRgb('#f3ead6'); const dark = lumOf(bg) < 0.42;
    const text = dark ? [221, 225, 231] : [31, 35, 40];
    const surface = dark ? mixRgb(bg, [255, 255, 255], 0.08) : mixRgb(bg, [255, 255, 255], 0.5);
    return { label: '自定义', bg: toHex(bg), surface: toHex(surface), text: toHex(text), muted: toHex(mixRgb(bg, text, 0.45)), dark };
  }
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function resolveTheme() {
    if (settings.theme === 'custom') return deriveTheme(settings.customColor);
    if (settings.theme === 'system') return systemDark() ? THEMES.dark : THEMES.paper;
    return THEMES[settings.theme] || THEMES.paper;
  }
  function applyTheme() { const t = resolveTheme(); const o = $('overlay'); o.style.setProperty('--ir-bg', t.bg); o.style.setProperty('--ir-surface', t.surface); o.style.setProperty('--ir-text', t.text); o.style.setProperty('--ir-muted', t.muted); o.style.setProperty('--ir-font', FONTS[settings.font]); o.style.setProperty('--ir-fs', settings.fontSize + 'px'); o.style.setProperty('--ir-lh', settings.lineHeight); o.style.setProperty('--ir-width', settings.width + 'px'); scheduleMinimap(220); }

  /* ----- stream model ----- */
  const secTop = (el) => el.getBoundingClientRect().top - $('scroll').getBoundingClientRect().top + $('scroll').scrollTop;
  function blkHtml(blocks, cache, i) { if (cache[i] == null) { let h = lightClean(blocks[i].html); h = h.replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])\/\//gi, '$1https://').replace(/<img\b/gi, '<img loading="lazy" '); cache[i] = h; } return cache[i]; }
  function blockHtml(i) { return blkHtml(S.blocks, S.bclean, i); }
  const curBlocks = () => (S.mode === 'series' ? S.cblocks : S.blocks);
  function buildSections() {
    const B = S.blocks, bd = S.bounds, secs = [];
    if (!bd.length) { secs.push({ title: S.bookTitle || '正文', start: 0, end: B.length, head: false }); }
    else {
      if (bd[0] > 0) secs.push({ title: '卷首', start: 0, end: bd[0], head: false });
      for (let i = 0; i < bd.length; i++) { const s = bd[i], e = i + 1 < bd.length ? bd[i + 1] : B.length; secs.push({ title: B[s].text.trim() || '章节', start: s, end: e, head: true }); }
    }
    S.sections = secs; S.secLabels = chapterLabels(secs.map((s) => s.title));
    const cat = []; const hasPre = secs[0] && secs[0].title === '卷首';
    const boundToSec = new Map(); secs.forEach((s, i) => { if (s.head) boundToSec.set(s.start, i); });
    if (hasPre) cat.push({ title: '卷首', sec: 0, empty: false });
    if (S.catalog.length && !S.manualSplit) {
      S.catalog.forEach((t) => { const si = t.bound != null ? boundToSec.get(t.bound) : undefined; cat.push({ title: t.title, sec: si == null ? null : si, empty: si == null }); });
    } else { secs.forEach((s, i) => { if (i === 0 && hasPre) return; cat.push({ title: s.title, sec: i, empty: false }); }); }
    S.cat = cat; S.catLabels = chapterLabels(cat.map((c) => c.title));
  }
  function renderStream(keep) {
    buildSections();
    const inter = S.mode2 !== 'read'; const bm = new Set(S.bookmarks.map((b) => b.bi));
    const y = keep ? $('scroll').scrollTop : 0;
    let html = '';
    S.sections.forEach((sec, si) => {
      let inner = '';
      for (let bi = sec.start; bi < sec.end; bi++) {
        const isBm = bm.has(bi); const mark = isBm ? `<span class="bm-mark" data-jump="${bi}">🔖</span>` : '';
        inner += `<span class="blk${isBm ? ' bm' : ''}" data-bi="${bi}">${mark}${blockHtml(bi)}</span><br/>`;
      }
      let sep = '';
      if (si > 0) sep = S.mode2 === 'split'
        ? `<div class="ch-sep edit"><button class="sep-x" data-bi="${sec.start}">✕ 取消分章</button><span class="sep-t">${esc(S.secLabels[si] || sec.title)}</span></div>`
        : '<div class="ch-sep"></div>';
      html += `<section class="ch" id="ch-${si}">${sep}<div class="ch-inner">${inner}</div></section>`;
    });
    html += `<div class="r-tail"><div class="r-end">— ${t('全书完')} · ${S.sections.length} ${t('段')} —</div><button class="r-tail-btn" id="tailBtn">${t('核对原文末尾（确认未删减）')}</button><div class="r-tail-box" id="tailBox" style="display:none"></div></div>`;
    $('content').innerHTML = `<div class="body stream${inter ? ' interactive' : ''}${S.mode2 === 'split' ? ' splitting' : ''}${S.mode2 === 'bookmark' ? ' marking' : ''}">${html}</div>`;
    if (keep) $('scroll').scrollTop = y; else { $('scroll').scrollTop = 0; savedScroll = null; }
    $('progress').style.width = '0';
    $('overlay').classList.toggle('splitting', S.mode2 === 'split');
    $('overlay').classList.toggle('marking', S.mode2 === 'bookmark');
    const tb = $('content').querySelector('#tailBtn'); if (tb) tb.onclick = showTail;
    $('content').querySelector('.body').addEventListener('click', onBodyClick);
    updateChrome();
    buildMinimap(); scheduleMinimap(700);
  }
  function showTail() {
    const box = $('content').querySelector('#tailBox'); if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    const tail = S.blocks.map((b) => b.text).filter((t) => t).slice(-12);
    box.innerHTML = '<div class="tail-h">' + esc(t('原文最后 ')) + tail.length + esc(t(' 行（与上方正文结尾一致，未删减）：')) + '</div>' + tail.map((l) => '<div class="tail-l">' + esc(l) + '</div>').join('');
    box.style.display = '';
  }
  function onBodyClick(e) {
    if (S.mode2 === 'split') { const x = e.target.closest('.sep-x'); if (x) { e.preventDefault(); removeBound(Number(x.dataset.bi)); return; } const blk = e.target.closest('.blk'); if (blk) { e.preventDefault(); addBound(Number(blk.dataset.bi)); } return; }
    if (S.mode2 === 'bookmark') { const blk = e.target.closest('.blk'); if (blk) { e.preventDefault(); if (S.flow) toggleBookmarkFlow(Number(blk.dataset.ci), Number(blk.dataset.bi)); else toggleBookmark(Number(blk.dataset.bi)); } }
  }
  function keepRender() { const y = $('scroll').scrollTop; renderStream(true); $('scroll').scrollTop = y; }
  function addBound(bi) { if (bi <= 0 || S.bounds.includes(bi)) return; S.bounds = [...S.bounds, bi].sort((a, b) => a - b); saveSplit(); keepRender(); renderOutline(); }
  function removeBound(bi) { S.bounds = S.bounds.filter((b) => b !== bi); saveSplit(); keepRender(); renderOutline(); }
  function resetSplit() { clearSplit(); const det = chapterize(S.raw); S.bounds = det.bounds; S.catalog = det.toc || []; keepRender(); renderOutline(); }
  function toggleBookmark(bi) {
    const blocks = curBlocks();
    const i = S.bookmarks.findIndex((b) => b.bi === bi);
    if (i >= 0) { S.bookmarks.splice(i, 1); flashToast('已移除书签'); }
    else { S.bookmarks.push({ bi, label: ((blocks[bi] && blocks[bi].text) || '［图片］').slice(0, 30) }); S.bookmarks.sort((a, b) => a.bi - b.bi); flashToast('已添加书签'); }
    saveBM(); if (S.mode === 'series') renderSeriesBody(true); else keepRender(); renderOutline();
  }
  function jumpToBlock(bi) { const sel = S.flow ? '.chap[data-ci="' + S.idx + '"] .blk[data-bi="' + bi + '"]' : '.blk[data-bi="' + bi + '"]'; const el = $('content').querySelector(sel); if (el) pinScroll(() => secTop(el) - 40); }

  /* ----- interactive modes ----- */
  function enterMode(m) {
    if (m === 'split' && S.mode !== 'stream') { flashToast('该书由站点分章，无需手动调整'); return; }
    if (m === 'bookmark' && S.mode !== 'stream' && S.mode !== 'series') { flashToast('该模式暂不支持'); return; }
    if (S.mode2 === m) { exitMode(); return; }
    S.mode2 = m; S.bmConfirm = null;
    S.outlineTab = m === 'split' ? 'toc' : 'bm';
    if (S.flow) flowRefresh(); else if (S.mode === 'series') renderSeriesBody(true); else keepRender();
    if (!isMobile()) openOutline(true); renderOutline();
  }
  function exitMode() { if (S.mode2 === 'read') return; S.mode2 = 'read'; S.bmConfirm = null; suppressTocHover = true; if (S.flow) flowRefresh(); else if (S.mode === 'stream') keepRender(); else if (S.mode === 'series') renderSeriesBody(true); renderOutline(); }

  /* ----- series (paged) ----- */
  // single-flight per chapter: a prefetch and a render that race for the same chapter share one request
  function ensureHtml(i) {
    const c = S.toc[i];
    if (c.html != null) return Promise.resolve(c.html);
    if (!c._p) c._p = getContent(c.aid).then((h) => (c.html = h)).catch(() => (c.html = '<p>本章无法获取（可能仅限 App）。</p>')).finally(() => { delete c._p; });
    return c._p;
  }
  async function renderChapter(i) {
    S.idx = i; savedScroll = null; S.mode2 = S.outlineTab === 'bm' ? 'bookmark' : 'read'; updateTopBtn();
    const c = S.toc[i]; $('scroll').scrollTop = 0; $('progress').style.width = '0';
    if (c.html == null) $('content').innerHTML = '<div class="loading">' + t('加载中…') + '</div>';
    const html = await ensureHtml(i); if (S.idx !== i) return;
    addHistory(c.aid); if (pageAid != null) { try { history.replaceState(history.state, '', '/detail/' + c.aid); } catch { /* */ } }
    // render the web-novel chapter as editable .blk spans (per-chapter bookmarks + minimap), still paged
    S.cblocks = splitBlocks(html); S.cbclean = []; S.bookmarks = loadBM(c.aid); S.bmConfirm = null;
    renderSeriesBody();
    updateChrome();
  }
  function renderSeriesBody(keep) {
    const i = S.idx, c = S.toc[i]; if (!c) return;
    const bm = new Set(S.bookmarks.map((b) => b.bi)); const inter = S.mode2 === 'bookmark';
    let inner = '';
    S.cblocks.forEach((blk, bi) => { const isBm = bm.has(bi); const mark = isBm ? `<span class="bm-mark" data-jump="${bi}">🔖</span>` : ''; inner += `<span class="blk${isBm ? ' bm' : ''}" data-bi="${bi}">${mark}${blkHtml(S.cblocks, S.cbclean, bi)}</span><br/>`; });
    const y = keep ? $('scroll').scrollTop : 0;
    $('content').innerHTML = '<h1 class="t">' + esc(S.labels[i] || c.title) + '</h1>' +
      '<div class="meta">' + esc(S.author) + (S.toc.length > 1 ? ' · ' + esc(chMeta(i + 1, S.toc.length)) : '') + '</div>' +
      '<div class="body stream' + (inter ? ' interactive marking' : '') + '">' + inner + '</div>' +
      '<div class="foot"><button id="f-prev">' + t('‹ 上一章') + '</button><button id="f-cat">' + t('目录') + '</button><button id="f-next" class="primary">' + t('下一章 ›') + '</button></div>';
    if (keep) $('scroll').scrollTop = y; else $('scroll').scrollTop = 0;
    $('progress').style.width = '0';
    const fp = $('content').querySelector('#f-prev'); if (fp) fp.onclick = goPrev;
    const fn = $('content').querySelector('#f-next'); if (fn) fn.onclick = goNext;
    const fc = $('content').querySelector('#f-cat'); if (fc) fc.onclick = () => { selectOutlineTab('toc'); openOutline(true); }; // route through selectOutlineTab so it exits bookmark mode
    $('content').querySelector('.body').addEventListener('click', onBodyClick);
    $('overlay').classList.toggle('marking', inter); $('overlay').classList.remove('splitting');
    buildMinimap(); scheduleMinimap(700);
  }

  /* ----- series (SEAMLESS continuous flow v2, 起点-style) -----
     A window of stacked chapter sections; the scroll flows into the next/prev chapter at each window
     edge and distant chapters unload to height-spacers. Why v2 (v1.19's flow was removed as too slow):
       1. PREFETCH — chapter HTML is fetched 2 ahead / 1 behind while reading, so reaching an edge is a
          memory-only append instead of a network wait;
       2. LAZY CHUNK RENDERING — chapter bodies are split into .chunk wrappers (content-visibility:auto
          + an estimated contain-intrinsic-size), so offscreen text costs no layout/paint until it nears
          the viewport — appends are cheap no matter how big the chapter is;
       3. EDGE TRIGGERS RELATIVE TO THE WINDOW (v1 used absolute scrollTop, so after a far jump the
          upward flow hit a void of blank spacer), separate append/prepend single-flight guards, and a
          leap into spacer territory (native scrollbar drag) rebuilds around the estimated chapter;
       4. EXACT SPACER ACCOUNTING — the top spacer only changes by the very amount inserted/removed next
          to it, and a ResizeObserver on every .chunk re-pins the viewport when content ABOVE it changes
          height (first-render corrections, late images) — no scroll jumps, no double-correction
          (native overflow-anchor is off in flow). ----- */
  let flowRO = null, flowGen = 0, flowVoidT = 0, flowPreT = 0, flowAppendBusy = false, flowPrependBusy = false;
  let flowDir = 1, flowLastTop = 0;   // last user scroll direction (+down/−up); programmatic moves resync flowLastTop
  const flowChunkH = new WeakMap();   // chunk el -> last seen height (-1 = baseline pending)
  function chapBlocks(i) { const c = S.toc[i]; if (!c.blocks) { c.blocks = splitBlocks(c.html || ''); c.bclean = []; } return c.blocks; }
  function chapBm(i) { const c = S.toc[i]; if (!c.bm) c.bm = loadBM(c.aid); return c.bm; }
  function chapAvg() { let sum = 0, n = 0; for (const c of S.toc) if (c.h) { sum += c.h; n++; } return n ? sum / n : 2400; }
  function estH(i) { return (S.toc[i] && S.toc[i].h) ? S.toc[i].h : chapAvg(); }
  // chars per wrapped line at the current font/width (CJK glyphs ≈ 1 font-size each) → estimated lines per block
  function flowCpl() { const cw = Math.min(settings.width || 740, $('scroll').clientWidth || 9999) - 48; return Math.max(8, Math.floor(cw / (settings.fontSize || 19))); }
  const blkLines = (blk, cpl) => blk.text ? Math.max(1, Math.ceil(blk.text.length / cpl)) : (/<img\b/i.test(blk.html) ? 14 : 1);
  function chapInnerHtml(i) {
    const blocks = chapBlocks(i), c = S.toc[i], bm = new Set(chapBm(i).map((b) => b.bi)), inter = S.mode2 === 'bookmark';
    const cpl = flowCpl(), lh = (settings.fontSize || 19) * (settings.lineHeight || 1.9);
    let body = '';
    for (let s = 0; s < blocks.length; s += CHUNK_BLOCKS) {
      const e = Math.min(blocks.length, s + CHUNK_BLOCKS);
      let lines = 0, inner = '';
      for (let bi = s; bi < e; bi++) {
        lines += blkLines(blocks[bi], cpl);
        const isBm = bm.has(bi); const mark = isBm ? `<span class="bm-mark" data-ci="${i}" data-jump="${bi}">🔖</span>` : '';
        inner += `<span class="blk${isBm ? ' bm' : ''}" data-ci="${i}" data-bi="${bi}">${mark}${blkHtml(blocks, c.bclean, bi)}</span><br/>`;
      }
      body += `<div class="chunk" data-ck="${s}" style="contain-intrinsic-size:auto ${Math.round(lines * lh)}px">${inner}</div>`;
    }
    return '<h1 class="t">' + esc(S.labels[i] || c.title) + '</h1><div class="meta">' + esc(S.author) + ' · ' + esc(chMeta(i + 1, S.toc.length)) + '</div>'
      + '<div class="body stream' + (inter ? ' interactive marking' : '') + '">' + body + '</div>';
  }
  function observeChunks(sec) { if (flowRO) sec.querySelectorAll('.chunk').forEach((ck) => { flowChunkH.set(ck, -1); flowRO.observe(ck); }); }
  function chapSection(i) {
    const sec = document.createElement('section'); sec.className = 'ch chap'; sec.id = 'chap-' + i; sec.dataset.ci = i;
    sec.dataset.label = S.labels[i] || S.toc[i].title || ''; sec.innerHTML = chapInnerHtml(i); observeChunks(sec); return sec;
  }
  const chapEl = (i) => $('content').querySelector('.chap[data-ci="' + i + '"]');
  const chapTop = (i) => { const sec = chapEl(i); return sec ? secTop(sec) : 0; };
  function measure(i) { const sec = chapEl(i); if (sec) S.toc[i].h = sec.offsetHeight; }
  // A chunk that changes height while sitting fully ABOVE the viewport (first real render correcting the
  // estimate, a late image decoding) shifts everything below — counter it so the visible text never moves.
  function onFlowResize(entries) {
    if (!S.flow) return;
    const sc = $('scroll'); let shift = 0;
    for (const en of entries) {
      const ck = en.target; if (!ck.isConnected) continue;
      const h = Math.round(en.borderBoxSize && en.borderBoxSize.length ? en.borderBoxSize[0].blockSize : ck.offsetHeight);
      const prev = flowChunkH.get(ck); flowChunkH.set(ck, h);
      if (prev == null || prev < 0 || h === prev) continue;
      if (secTop(ck) + Math.min(prev, h) <= sc.scrollTop + 1) shift += h - prev;
    }
    if (shift) { sc.scrollTop = Math.max(0, sc.scrollTop + shift); flowLastTop = sc.scrollTop; }
  }
  const topSpacerH = () => { const el = $('flowTop'); return el ? (parseFloat(el.style.height) || 0) : 0; };
  const setTopSpacer = (px) => { const el = $('flowTop'); if (el) el.style.height = Math.max(0, Math.round(px)) + 'px'; };
  function setBotSpacer() { const el = $('flowBot'); if (!el) return; let h = 0; for (let j = S.win.last + 1; j < S.toc.length; j++) h += estH(j); el.style.height = Math.round(h) + 'px'; }
  function flowLoadHint(on) { const el = $('content') && $('content').querySelector('#flowLoad'); if (el) el.style.display = on ? '' : 'none'; }
  // fire-and-forget: warm the NEXT chapter right away; the one after it and the one behind follow on a
  // short delay so a window move costs one request up front, not a three-request burst
  function flowPrefetch() {
    if (!S.flow) return;
    const nxt = S.win.last + 1;
    if (nxt < S.toc.length && S.toc[nxt].html == null) ensureHtml(nxt);
    const gen = flowGen;
    clearTimeout(flowPreT);
    flowPreT = setTimeout(() => {
      if (!S.flow || gen !== flowGen) return;
      [S.win.last + 2, S.win.first - 1].forEach((j) => { if (j >= 0 && j < S.toc.length && S.toc[j].html == null) ensureHtml(j); });
    }, 900);
  }
  function flowTeardown() {
    flowGen++; flowAppendBusy = flowPrependBusy = false; clearTimeout(flowVoidT); clearTimeout(flowPreT);
    if (flowRO) { flowRO.disconnect(); flowRO = null; }
    const sc = $('scroll'); if (sc) sc.classList.remove('flow');
    S.flow = false;
  }
  async function renderFlow(start) {
    flowGen++; const gen = flowGen;
    S.flow = true; S.idx = start; S.win = { first: start, last: start };
    S.mode2 = S.outlineTab === 'bm' ? 'bookmark' : 'read';
    flowAppendBusy = flowPrependBusy = false;
    $('content').innerHTML = '<div class="loading">' + t('加载中…') + '</div>';
    await ensureHtml(start);
    if (gen !== flowGen || !S.flow || S.mode !== 'series' || S.aid == null) return;
    S.bookmarks = chapBm(start); S.bmConfirm = null;
    if (flowRO) flowRO.disconnect();
    flowRO = new ResizeObserver(onFlowResize);
    const wrap = document.createElement('div'); wrap.id = 'flow';
    const top = document.createElement('div'); top.className = 'chap-spacer'; top.id = 'flowTop';
    const load = document.createElement('div'); load.className = 'flow-load'; load.id = 'flowLoad'; load.style.display = 'none'; load.textContent = t('加载中…'); load.setAttribute('role', 'status');
    const bot = document.createElement('div'); bot.className = 'chap-spacer'; bot.id = 'flowBot';
    wrap.appendChild(top); wrap.appendChild(chapSection(start)); wrap.appendChild(load); wrap.appendChild(bot);
    $('content').innerHTML = ''; $('content').appendChild(wrap);
    $('scroll').classList.add('flow');
    wrap.addEventListener('click', onBodyClick);
    measure(start);
    let th = 0; for (let j = 0; j < start; j++) th += estH(j);
    setTopSpacer(th); setBotSpacer(); flowTail();
    $('scroll').scrollTop = start <= 0 ? 0 : Math.max(0, chapTop(start) - 4); $('progress').style.width = '0';
    flowDir = 1; flowLastTop = $('scroll').scrollTop;   // assume forward reading until the user scrolls up
    addHistory(S.toc[start].aid); if (pageAid != null) { try { history.replaceState(history.state, '', '/detail/' + S.toc[start].aid); } catch { /* */ } }
    $('overlay').classList.toggle('marking', S.mode2 === 'bookmark'); $('overlay').classList.remove('splitting');
    updateChrome(); buildMinimap(); scheduleMinimap(700);
    flowPrefetch();
    restoreFlowProg(start);   // restore the within-chapter position for the resumed chapter
    flowOnScroll();           // kick the runway build (no scroll event fires when scrollTop didn't change)
  }
  async function flowAppend() {
    if (flowAppendBusy || !S.flow || S.win.last >= S.toc.length - 1) return;
    const i = S.win.last + 1, gen = flowGen; flowAppendBusy = true;
    try {
      if (S.toc[i].html == null) { flowLoadHint(true); await ensureHtml(i); }   // prefetch usually made this instant
      if (gen !== flowGen || !S.flow || S.win.last !== i - 1) return;
      $('flowLoad').before(chapSection(i)); S.win.last = i; measure(i);
      flowTrim('top');
      setBotSpacer(); flowTail(); flowReresolveActive(); flowPrefetch(); scheduleMinimap(300);
    } finally { flowAppendBusy = false; flowLoadHint(false); }
    flowOnScroll();   // keep extending until there's a full pad of runway (a scroll event won't re-fire on its own)
  }
  async function flowPrepend() {
    if (flowPrependBusy || !S.flow || S.win.first <= 0) return;
    const i = S.win.first - 1, gen = flowGen; flowPrependBusy = true;
    try {
      await ensureHtml(i);
      if (gen !== flowGen || !S.flow || S.win.first !== i + 1) return;
      const sc = $('scroll'), T = topSpacerH();
      const used = i === 0 ? T : Math.min(estH(i), T);   // the spacer shrinks by exactly what the scroll math adds back
      $('flowTop').after(chapSection(i)); S.win.first = i; measure(i);
      setTopSpacer(T - used);
      sc.scrollTop = Math.max(0, sc.scrollTop + (S.toc[i].h || 0) - used);   // keep the viewport pinned to what it was showing
      flowLastTop = sc.scrollTop;   // programmatic move — don't let it flip the perceived scroll direction
      flowTrim('bot');
      flowTail(); flowReresolveActive(); flowPrefetch(); scheduleMinimap(300);
    } finally { flowPrependBusy = false; }
    flowOnScroll();
  }
  // Trim the far side of an over-full window — but only sections that are at least a full pad beyond the
  // viewport, so a book of tiny chapters can't ping-pong load/unload between the two edge triggers.
  function flowTrim(side) {
    const sc = $('scroll'), pad = Math.max(1200, sc.clientHeight * 1.5);
    while (S.win.last - S.win.first + 1 > WIN_KEEP) {
      if (side === 'top') {
        const nf = chapEl(S.win.first + 1);
        if (!nf || secTop(nf) > sc.scrollTop - pad) break;
        flowUnload('top');
      } else {
        const nl = chapEl(S.win.last - 1);
        if (!nl || secTop(nl) + nl.offsetHeight < sc.scrollTop + sc.clientHeight + pad) break;
        flowUnload('bot');
      }
    }
  }
  function flowUnload(side) {
    const i = side === 'top' ? S.win.first : S.win.last;
    const sec = chapEl(i); if (!sec) return;
    S.toc[i].h = sec.offsetHeight; sec.remove();
    // growing the top spacer by the exact measured height of what was removed = zero net shift below it
    if (side === 'top') { setTopSpacer(topSpacerH() + S.toc[i].h); S.win.first = i + 1; }
    else { S.win.last = i - 1; setBotSpacer(); }
  }
  // an edge unload can drop the section S.idx points at — re-resolve so the outline highlight / chip /
  // bookmark target never point at a removed section until the next scroll tick
  function flowReresolveActive() { if (S.idx < S.win.first || S.idx > S.win.last) flowSetActive(flowActiveFromScroll()); }
  // a "全书完" marker once the final chapter is in the window
  function flowTail() {
    const have = $('content').querySelector('#flowTail');
    if (S.win.last >= S.toc.length - 1) { if (!have) { const d = document.createElement('div'); d.id = 'flowTail'; d.className = 'r-tail'; d.innerHTML = '<div class="r-end">— ' + esc(t('全书完')) + ' · ' + S.toc.length + ' ' + esc(t('章节')) + ' —</div>'; $('flowLoad').before(d); } }
    else if (have) have.remove();
  }
  // whichever loaded section's top sits at/above the viewport top probe = the active chapter
  function flowActiveFromScroll() {
    const probe = $('scroll').scrollTop + 90; let act = S.win.first;
    for (let i = S.win.first; i <= S.win.last; i++) { const sec = chapEl(i); if (sec && secTop(sec) <= probe) act = i; }
    return act;
  }
  function flowOnScroll() {
    const sc = $('scroll'), firstSec = chapEl(S.win.first), lastSec = chapEl(S.win.last);
    if (!firstSec || !lastSec) return;
    const winTop = secTop(firstSec), winBot = secTop(lastSec) + lastSec.offsetHeight;
    const vTop = sc.scrollTop, vBot = vTop + sc.clientHeight, pad = Math.max(1200, sc.clientHeight * 1.5);
    const dy = vTop - flowLastTop; if (dy) flowDir = dy; flowLastTop = vTop;
    const slack = sc.clientHeight / 2;   // a momentum flick may overshoot the edge a little — that's not a leap
    // leapt clear outside the loaded window (native-scrollbar drag into spacer territory)?
    // once the scroll settles, rebuild the window around the estimated landing chapter.
    if (vBot < winTop - slack || vTop > winBot + slack) {
      clearTimeout(flowVoidT);
      flowVoidT = setTimeout(() => {
        if (!S.flow || mmDrag) return;
        const fs = chapEl(S.win.first), ls = chapEl(S.win.last); if (!fs || !ls) return;
        const mid = $('scroll').scrollTop + $('scroll').clientHeight / 2;
        const wt = secTop(fs), wb = secTop(ls) + ls.offsetHeight;
        if (mid >= wt && mid <= wb) return;   // scrolled back inside meanwhile
        let target;
        if (mid < wt) { let acc = wt; target = 0; for (let j = S.win.first - 1; j >= 0; j--) { acc -= estH(j); if (mid >= acc) { target = j; break; } } }
        else { let acc = wb; target = S.toc.length - 1; for (let j = S.win.last + 1; j < S.toc.length; j++) { acc += estH(j); if (mid <= acc) { target = j; break; } } }
        renderFlow(target);
      }, 240);
      return;
    }
    // direction-gated: only extend in the direction the reader is moving (or once clearly past an
    // edge), so opening a mid-book chapter doesn't eagerly fetch both neighbours at once. The 8px
    // tolerance covers renderFlow's "chapTop - 4" parking spot — that's not really past the edge.
    if (vTop < winTop + pad && (flowDir < 0 || vTop < winTop - 8)) flowPrepend();
    if (vBot > winBot - pad && (flowDir > 0 || vBot > winBot + 8)) flowAppend();
    const act = flowActiveFromScroll();
    if (act !== S.idx) flowSetActive(act);
  }
  function flowSetActive(i) {
    S.idx = i; S.bookmarks = chapBm(i); updateCurrent();
    $('r-prev').disabled = i <= 0; $('r-next').disabled = i >= S.toc.length - 1;
    if (S.outlineTab === 'bm') renderOutline();   // the 书签 list follows the active chapter
    clearTimeout(S._flowHistT); S._flowHistT = setTimeout(() => { if (S.flow && S.idx === i && S.toc[i]) { addHistory(S.toc[i].aid); if (pageAid != null) { try { history.replaceState(history.state, '', '/detail/' + S.toc[i].aid); } catch { /* */ } } } }, 600);
  }
  function flowGoto(i) {
    if (i < 0 || i >= S.toc.length) return;
    if (i >= S.win.first && i <= S.win.last && chapEl(i)) { const sec = chapEl(i); pinScroll(() => secTop(sec) - 4); flowSetActive(i); return; }
    renderFlow(i);   // far jump → rebuild the window around i
  }
  function toggleBookmarkFlow(ci, bi) {
    const blocks = chapBlocks(ci), list = chapBm(ci);
    const k = list.findIndex((b) => b.bi === bi);
    if (k >= 0) { list.splice(k, 1); flashToast('已移除书签'); }
    else { list.push({ bi, label: ((blocks[bi] && blocks[bi].text) || '［图片］').slice(0, 30) }); list.sort((a, b) => a.bi - b.bi); flashToast('已添加书签'); }
    try { localStorage.setItem(BM_KEY(S.toc[ci].aid), JSON.stringify(list)); } catch { /* */ }
    // surgical update of the one block — no section re-render, so chunk render state (and scroll) stay put
    const sec = chapEl(ci), blkEl = sec && sec.querySelector('.blk[data-bi="' + bi + '"]');
    if (blkEl) {
      const on = k < 0; blkEl.classList.toggle('bm', on);
      const old = blkEl.querySelector('.bm-mark'); if (old) old.remove();
      if (on) { const m = document.createElement('span'); m.className = 'bm-mark'; m.dataset.ci = ci; m.dataset.jump = bi; m.textContent = '🔖'; blkEl.prepend(m); }
    }
    if (ci === S.idx) S.bookmarks = list;
    renderOutline(); scheduleMinimap(150);
  }
  // toggling bookmark mode only changes classes on the loaded chapter bodies — no DOM rebuild
  function flowRefresh() {
    const inter = S.mode2 === 'bookmark';
    for (let i = S.win.first; i <= S.win.last; i++) { const sec = chapEl(i); const b = sec && sec.querySelector('.body'); if (b) { b.classList.toggle('interactive', inter); b.classList.toggle('marking', inter); } }
    $('overlay').classList.toggle('marking', inter); $('overlay').classList.remove('splitting');
  }

  /* ----- navigation ----- */
  function streamCur() { const secs = [...$('content').querySelectorAll('section.ch')]; const y = $('scroll').scrollTop + 90; let cur = 0; secs.forEach((s, i) => { if (secTop(s) <= y) cur = i; }); return cur; }
  // Instant jump that re-pins a few times as nearby lazy images finish loading (they shift the
  // target down, which used to leave clicks landing "just before" the heading). The slow smooth
  // animation also made jumps feel laggy — instant is snappy. Aborts the moment the user scrolls.
  function pinScroll(targetFn) {
    const el = $('scroll');
    const pin = () => { el.scrollTop = Math.max(0, targetFn()); return el.scrollTop; };
    let last = pin();
    [60, 180, 360, 650].forEach((d) => setTimeout(() => { if (Math.abs(el.scrollTop - last) <= 2) last = pin(); }, d));
  }
  function scrollToSec(i) { const s = $('content').querySelector('#ch-' + i); if (!s) return; pinScroll(() => secTop(s) - 10); }
  function goPrev() { if (S.flow) { flowGoto(S.idx - 1); return; } if (S.mode === 'series') { if (S.idx > 0) renderChapter(S.idx - 1); return; } const c = streamCur(); const s = $('content').querySelector('#ch-' + c); const atTop = s && secTop(s) >= $('scroll').scrollTop - 16; scrollToSec(atTop ? Math.max(0, c - 1) : c); }
  function goNext() { if (S.flow) { flowGoto(S.idx + 1); return; } if (S.mode === 'series') { if (S.idx < S.toc.length - 1) renderChapter(S.idx + 1); return; } const c = streamCur(); if (c < S.sections.length - 1) scrollToSec(c + 1); }

  function updateChrome() {
    if (S.mode === 'series') { $('r-prev').disabled = S.idx <= 0; $('r-next').disabled = S.idx >= S.toc.length - 1; } else { $('r-prev').disabled = false; $('r-next').disabled = false; }
    if (S.mode === 'stream') S.downloadable = S.sections.length > 1 || S.rawLen >= DL_MIN_LEN;
    $('t-dlCorner').style.display = S.downloadable ? '' : 'none';
    renderOutline(); updateCurrent();
  }

  /* ----- left outline (chapters / bookmarks / volumes) ----- */
  function openOutline(on) { $('overlay').classList.toggle('ol-on', on); updateScrim(); }
  function toggleOutline() { openOutline(!$('overlay').classList.contains('ol-on')); }
  function updateScrim() { const need = $('setPanel').classList.contains('show') || (isMobile() && $('overlay').classList.contains('ol-on')); $('scrim').classList.toggle('show', need); }
  // switching the outline tab also drives the interactive mode: 书签 tab = bookmark mode, others = read mode
  function selectOutlineTab(t) {
    if (t === 'bm') {
      S.outlineTab = 'bm';
      if ((S.mode === 'stream' || S.mode === 'series') && S.mode2 !== 'bookmark') enterMode('bookmark'); else renderOutline();
      return;
    }
    if (t === S.outlineTab && S.mode2 === 'read') return;
    if (S.mode2 !== 'read') exitMode();
    S.outlineTab = t; renderOutline();
  }
  function renderOutline() {
    const otTitle = S.bookTitle || (S.detail && S.detail.title) || '';
    $('outlineTitle').textContent = otTitle; $('outlineTitle').title = otTitle;   // full title on hover (it's clamped to 2 lines)
    const tabsWrap = $('outlineTabs');
    if (S.mode2 === 'split') {
      // split (manual chapter editing) repurposes the tab bar: red 完成 where 目录 was, 重置 where 书签 was
      tabsWrap.innerHTML = `<button class="tab-done" data-act="done">${t('✓ 完成调整')}</button><button class="tab-reset" data-act="reset">↺ ${t('重置')}</button>`;
      tabsWrap.querySelector('[data-act="done"]').onclick = exitMode;
      tabsWrap.querySelector('[data-act="reset"]').onclick = resetSplit;
      $('outlineNote').textContent = t('点击任意段落＝在此分章；点击正文里「✕ 取消分章」可合并相邻章节。');
    } else {
      const tabs = [['toc', t('目录')]]; if (S.mode === 'stream' || S.mode === 'series') tabs.push(['bm', t('书签')]); if (S.volumes.length > 1) tabs.push(['vol', t('分卷')]);
      if (!tabs.some((t) => t[0] === S.outlineTab)) S.outlineTab = 'toc';
      const canSplit = S.mode === 'stream';
      tabsWrap.innerHTML = tabs.map(([k, l]) => {
        const a = S.outlineTab === k ? ' active' : '';
        if (k === 'toc' && canSplit) return `<button class="tab-toc${a}${(a && suppressTocHover) ? ' no-edit-hover' : ''}" data-t="toc"><span class="lbl">${t('目录')}</span><span class="lbl-edit">✂️ ${t('调整分章')}</span></button>`;
        return `<button class="${a}" data-t="${k}">${l}</button>`;
      }).join('');
      tabsWrap.querySelectorAll('button').forEach((b) => {
        if (b.dataset.t === 'toc' && canSplit) {
          b.onmouseleave = () => { suppressTocHover = false; b.classList.remove('no-edit-hover'); };
          b.onclick = () => { if (S.outlineTab === 'toc' && S.mode2 === 'read' && !b.classList.contains('no-edit-hover')) enterMode('split'); else { suppressTocHover = true; selectOutlineTab('toc'); } };
        } else b.onclick = () => selectOutlineTab(b.dataset.t);
      });
      $('outlineNote').textContent =
        S.outlineTab === 'bm' ? (S.mode === 'series' ? t('书签模式：点击正文段落即可添加 / 移除（仅当前章节）。') : t('书签模式：点击正文段落即可添加 / 移除；下方按所在章节分组。'))
        : (S.outlineTab === 'toc' && canSplit && S.cat.length > 1 ? t('提示：当前在「目录」，再点一次「目录」即可调整分章。') : '');
    }
    const list = $('outlineList');
    if (S.outlineTab === 'vol') {
      list.innerHTML = S.volumes.map((v, i) => `<button class="cat-item ${v.aid === S.aid ? 'active' : ''}" data-aid="${v.aid}" title="${esc(v.title)}"><span class="n">${i + 1}</span><span>${esc(S.volLabels[i] || v.title)}</span></button>`).join('');
      list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); openArticle(Number(b.dataset.aid)); }));
    } else if (S.outlineTab === 'bm') {
      renderBookmarks(list);
    } else if (S.mode === 'series') {
      // A web novel can have 1000+ chapters — build the chapter buttons ONCE. On a page turn the list is
      // identical, so skip the rebuild (updateCurrent moves the highlight, and the outline keeps its scroll).
      const sig = S.toc.length + ':' + (S.toc[0] ? S.toc[0].aid : 0);
      if (list.dataset.sig !== sig || !list.querySelector('.cat-item[data-i]')) {
        list.dataset.sig = sig;
        list.innerHTML = S.toc.map((c, i) => `<button class="cat-item ${i === S.idx ? 'active' : ''}" data-i="${i}" title="${esc(c.title)}"><span class="n">${i + 1}</span><span>${esc(S.labels[i] || c.title)}</span></button>`).join('');
        list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); if (S.flow) flowGoto(Number(b.dataset.i)); else renderChapter(Number(b.dataset.i)); }));
      }
    } else if (S.cat.length <= 1) {
      list.innerHTML = '<div class="cat-note">' + t('本篇为单段内容。再点一次上方「目录」即可进入分章调整、自行划分。') + '</div>';
    } else {
      const cur = streamCur();
      list.innerHTML = S.cat.map((c, i) => `<button class="cat-item ${c.empty ? 'empty' : ''} ${c.sec === cur ? 'active' : ''}" data-sec="${c.sec == null ? '' : c.sec}" title="${esc(c.title)}"><span class="n">${i + 1}</span><span>${esc(S.catLabels[i] || c.title)}</span>${c.empty ? '<span class="cat-tag">' + t('未完成') + '</span>' : ''}</button>`).join('');
      list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { const sec = b.dataset.sec; if (sec === '') { flashToast('本章暂无内容（可能未翻译）'); return; } if (isMobile()) openOutline(false); list.querySelectorAll('.cat-item').forEach((it) => it.classList.toggle('active', it === b)); scrollToSec(Number(sec)); }));
    }
    updateCurrent();
  }
  // 书签 list grouped under the chapter each bookmark sits in; delete needs a hover + confirm
  function renderBookmarks(list) {
    if (!S.bookmarks.length) { list.innerHTML = '<div class="cat-note">' + t('还没有书签。当前为书签模式——点击正文任意段落即可添加') + (S.mode === 'series' ? t('（每章独立）。') : '。') + '</div>'; return; }
    // web novel: bookmarks belong to the CURRENT chapter only → a flat list under the chapter title
    const secOf = S.mode === 'series'
      ? () => 0
      : (bi) => { for (let i = 0; i < S.sections.length; i++) { const s = S.sections[i]; if (bi >= s.start && bi < s.end) return i; } return Math.max(0, S.sections.length - 1); };
    const groups = new Map();
    S.bookmarks.forEach((b) => { const si = secOf(b.bi); if (!groups.has(si)) groups.set(si, []); groups.get(si).push(b); });
    if (S.mode === 'series') {
      const t = (S.labels && S.labels[S.idx]) || (S.toc[S.idx] && S.toc[S.idx].title) || '本章';
      let h = `<div class="bm-grp"><div class="cat-item bm-grp-h" style="cursor:default"><span class="n">▎</span><span>${esc(t)}</span></div>`;
      (groups.get(0) || []).sort((a, b) => a.bi - b.bi).forEach((b) => { const cf = S.bmConfirm === b.bi; h += `<button class="cat-item bm-item" data-jump="${b.bi}" title="${esc(b.label)}"><span class="n">🔖</span><span>${esc(b.label)}</span><span class="bm-del${cf ? ' confirm' : ''}" data-del="${b.bi}">${cf ? '确认删除' : '✕'}</span></button>`; });
      list.innerHTML = h + '</div>';
      list.querySelectorAll('.bm-item').forEach((b) => (b.onclick = (e) => { const del = e.target.closest('.bm-del'); if (del) { e.stopPropagation(); const bi = Number(del.dataset.del); if (S.bmConfirm === bi) { S.bmConfirm = null; if (S.flow) toggleBookmarkFlow(S.idx, bi); else toggleBookmark(bi); } else { S.bmConfirm = bi; renderOutline(); clearTimeout(S._bmT); S._bmT = setTimeout(() => { if (S.bmConfirm === bi) { S.bmConfirm = null; renderOutline(); } }, 2800); } return; } S.bmConfirm = null; if (isMobile()) openOutline(false); jumpToBlock(Number(b.dataset.jump)); }));
      return;
    }
    let html = '';
    [...groups.keys()].sort((a, b) => a - b).forEach((si) => {
      const t = S.secLabels[si] || (S.sections[si] && S.sections[si].title) || '正文';
      html += `<div class="bm-grp"><button class="cat-item bm-grp-h" data-sec="${si}" title="${esc(t)}"><span class="n">▎</span><span>${esc(t)}</span></button>`;
      groups.get(si).sort((a, b) => a.bi - b.bi).forEach((b) => {
        const cf = S.bmConfirm === b.bi;
        html += `<button class="cat-item bm-item" data-jump="${b.bi}" title="${esc(b.label)}"><span class="n">🔖</span><span>${esc(b.label)}</span><span class="bm-del${cf ? ' confirm' : ''}" data-del="${b.bi}">${cf ? '确认删除' : '✕'}</span></button>`;
      });
      html += `</div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('.bm-grp-h').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); scrollToSec(Number(b.dataset.sec)); }));
    list.querySelectorAll('.bm-item').forEach((b) => (b.onclick = (e) => {
      const del = e.target.closest('.bm-del');
      if (del) {
        e.stopPropagation(); const bi = Number(del.dataset.del);
        if (S.bmConfirm === bi) { S.bmConfirm = null; toggleBookmark(bi); }
        else { S.bmConfirm = bi; renderOutline(); clearTimeout(S._bmT); S._bmT = setTimeout(() => { if (S.bmConfirm === bi) { S.bmConfirm = null; renderOutline(); } }, 2800); }
        return;
      }
      S.bmConfirm = null; if (isMobile()) openOutline(false); jumpToBlock(Number(b.dataset.jump));
    }));
  }
  // coarse 0..1 reading fraction WITHIN the active chapter (series mode), for the book-wide % estimate
  function chapFrac() {
    const sc = $('scroll'); if (!sc) return 0;
    if (S.flow) { const sec = chapEl(S.idx); if (!sec) return 0; const h = sec.offsetHeight || 1; const d = sc.scrollTop - chapTop(S.idx); return Math.max(0, Math.min(1, d / h)); }
    const max = sc.scrollHeight - sc.clientHeight; return max > 0 ? Math.max(0, Math.min(1, sc.scrollTop / max)) : 0;
  }
  function updateCurrent(chipOnly) {
    const list = $('outlineList');
    if (S.mode === 'series') {
      const N = S.toc.length, name = (S.labels && S.labels[S.idx]) || S.bookTitle || '';
      // "<chapter> · Ch i / N · ~B%" — a coarse book-wide position readout
      let readout = '';
      if (N > 1) { const bookPct = Math.round(((S.idx + chapFrac()) / N) * 100); readout = ' · ' + chMeta(S.idx + 1, N) + ' · ~' + bookPct + '%'; }
      $('curChip').textContent = name + readout;
      if (chipOnly) return;   // scroll-tick refresh of the % only — don't yank the outline list around
      if (list) {
        let act = null;
        list.querySelectorAll('.cat-item').forEach((it) => { const on = it.dataset.i === String(S.idx); it.classList.toggle('active', on); if (on) act = it; });
        if (act) { const lr = list.getBoundingClientRect(), ar = act.getBoundingClientRect(); if (ar.height && (ar.top < lr.top || ar.bottom > lr.bottom)) list.scrollTop += (ar.top - lr.top) - list.clientHeight / 2 + ar.height / 2; }   // keep the current chapter in view on prev/next
      }
      return;
    }
    const cur = streamCur(); const sec = S.sections[cur];
    $('curChip').textContent = sec ? (S.secLabels[cur] || sec.title) : '';
    if (list && S.outlineTab === 'toc') { let any = false; list.querySelectorAll('.cat-item').forEach((it) => { const on = it.dataset.sec === String(cur); it.classList.toggle('active', on); any = any || on; }); }
  }

  function sampleOthers(series, aid, n) { const o = series.filter((s) => s.aid !== aid); if (o.length <= n) return o.map((s) => s.aid); const out = []; const step = Math.max(1, Math.floor(o.length / n)); for (let i = 0; i < n; i++) out.push(o[Math.min(o.length - 1, i * step)].aid); return [...new Set(out)]; }

  async function openArticle(aid) {
    resetState(aid); exitMode();
    // keep the address bar in step with what's open (so closing lands on the right book/volume),
    // but only when we were launched from a real detail page — never hijack a list page's URL.
    if (pageAid != null && aid !== currentAid()) { try { history.replaceState(history.state, '', '/detail/' + aid); } catch { /* */ } }
    $('content').innerHTML = '<div class="loading">' + t('加载中…') + '</div>'; $('t-dlCorner').style.display = 'none';
    let raw, detail;
    try { [raw, detail] = await Promise.all([getContent(aid), getDetail(aid)]); }
    catch { $('content').innerHTML = '<div class="loading">' + t('无法加载该内容（可能仅限 App 或已删除）。') + '</div>'; return; }
    if (S.aid !== aid) return;
    S.detail = detail; S.raw = raw; S.rawLen = textLen(raw); S.author = (detail.author && detail.author.nickname) || ''; S.bookTitle = cleanTitle(detail.title);
    S.bookmarks = loadBM(aid);
    const det = chapterize(raw); S.blocks = det.blocks; S.catalog = det.toc || [];
    const saved = loadSplit(aid);
    if (det.bounds.length >= 2 || (saved && saved.bounds.length)) {
      S.mode = 'stream';
      if (saved && saved.bounds.length) { S.bounds = saved.bounds.filter((b) => b > 0 && b < S.blocks.length); S.manualSplit = true; } else S.bounds = det.bounds;
      renderStream(); addHistory(aid); restoreProg(aid, true);
      if ((detail.sid || 0) > 0) getSeries(detail.sid).then((s) => { if (S.aid !== aid) return; if (s.length > 1) { S.volumes = s; S.volLabels = chapterLabels(s.map((x) => x.title)); updateChrome(); } }).catch(() => {});
      return;
    }
    S.mode = 'stream'; S.bounds = []; renderStream(); addHistory(aid); restoreProg(aid, true);
    if ((detail.sid || 0) > 0) {
      const series = await getSeries(detail.sid).catch(() => []);
      if (S.aid !== aid || !series.length) return;
      let kind = 'series';
      if (series.length <= 1) kind = 'volumes';
      else if (series.length < MANY_CHAPTERS) { let maxLen = S.rawLen; for (const sa of sampleOthers(series, aid, 2)) { try { maxLen = Math.max(maxLen, textLen(await getContent(sa))); } catch { /* */ } if (maxLen >= VOL_LEN) break; } kind = maxLen >= VOL_LEN ? 'volumes' : 'series'; }
      if (S.aid !== aid) return;
      if (kind === 'series') {
        S.mode = 'series'; S.toc = series.map((s) => ({ aid: s.aid, title: s.title, html: null }));
        const ci = S.toc.findIndex((t) => t.aid === aid); if (ci >= 0) S.toc[ci].html = raw;
        S.labels = chapterLabels(S.toc.map((c) => c.title)); S.bookTitle = cleanTitle(commonPrefix(series.map((s) => s.title))) || cleanTitle(detail.title); S.downloadable = true;
        // web novel: if opened at the very start, continue from the chapter LK remembers we last read
        let start = ci < 0 ? 0 : ci, resumed = false;
        if (settings.resume && start <= 0) {
          const lr = await lastReadAid(new Set(S.toc.map((t) => t.aid)));
          if (S.aid !== aid) return;
          const li = lr != null ? S.toc.findIndex((t) => t.aid === lr) : -1;
          if (li > 0) { start = li; resumed = true; }
        }
        S.idx = start; if (settings.seamlessScroll) renderFlow(start); else renderChapter(start);
        if (resumed) flashToast(t('已续读至 ') + (S.labels[S.idx] || ('第' + (S.idx + 1) + '章')));
      } else { S.volumes = series; S.volLabels = chapterLabels(series.map((s) => s.title)); updateChrome(); }
    } else { updateChrome(); }
  }

  /* ===================== settings panel ======================= */
  // Each ? is a real button (data-q = help text). Click pops a small floating note anchored to the
  // button — replaces the native title= tooltip (which only appeared after a long hover).
  function hideQPop() { const p = $('qpop'); if (!p) return; p.classList.remove('show'); if (p._owner) { p._owner.classList.remove('on'); p._owner.setAttribute('aria-expanded', 'false'); } p._owner = null; }
  function showQPop(q, txt) {
    const p = $('qpop');
    if (p._owner && p._owner !== q) { p._owner.classList.remove('on'); p._owner.setAttribute('aria-expanded', 'false'); }   // switching popovers
    p.textContent = txt; p._owner = q; p.classList.add('show');
    q.classList.add('on'); q.setAttribute('aria-expanded', 'true');
    // position relative to the overlay (which is inset:0, so viewport coords work); right-align to the
    // button, open downward, and flip above / clamp if it would overflow the viewport edge.
    const r = q.getBoundingClientRect(), pr = p.getBoundingClientRect(), m = 8;
    let left = Math.min(r.right - pr.width, window.innerWidth - pr.width - m);
    if (left < m) left = m;
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - m) top = Math.max(m, r.top - pr.height - 6);
    p.style.left = left + 'px'; p.style.top = top + 'px';
  }
  function bindQmarks(scope) {
    scope.querySelectorAll('.qmark').forEach((q) => {
      const txt = q.getAttribute('data-q'); if (!txt) return;
      q.setAttribute('aria-label', t('查看说明')); q.setAttribute('aria-expanded', 'false');
      q.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const open = $('qpop')._owner === q && $('qpop').classList.contains('show'); if (open) hideQPop(); else showQPop(q, txt); };
    });
  }
  function renderSettings() {
    hideQPop();                                   // a re-render drops the old ? buttons → close any open help popover
    const body = $('setBody');
    const lp = llmPreset();
    const v3sel = String(settings.epubVer || 3) !== '2';
    const sysL = !['zh', 'en'].includes(settings.lang);
    body.innerHTML =
      `<div class="grp"><div class="lbl">语言 · Language</div><div class="seg" id="s-lang"><button data-l="system" class="${sysL ? 'active' : ''}">${t('跟随系统')}</button><button data-l="zh" class="${settings.lang === 'zh' ? 'active' : ''}">中文</button><button data-l="en" class="${settings.lang === 'en' ? 'active' : ''}">English</button></div></div>
       <div class="grp"><div class="lbl">${t('主题')}</div><div class="swatches" id="sw"></div>
         <div id="customRow" style="${settings.theme === 'custom' ? '' : 'display:none'};margin-top:10px"><div class="lbl">${t('自定义底色（如 #AA4A44）')}</div><div class="custom-in"><input type="text" id="s-custom" maxlength="7" value="${esc(settings.customColor)}" placeholder="#AA4A44"><span class="custom-sw" id="customSw" style="background:${esc(settings.customColor)}"></span></div></div>
       </div>
       <div class="grp"><div class="lbl">${t('字号')} <b id="v-fs">${settings.fontSize}</b></div><input type="range" id="s-fs" min="14" max="28" step="1" value="${settings.fontSize}"></div>
       <div class="grp"><div class="lbl">${t('行距')} <b id="v-lh">${settings.lineHeight.toFixed(1)}</b></div><input type="range" id="s-lh" min="1.4" max="2.6" step="0.1" value="${settings.lineHeight}"></div>
       <div class="grp"><div class="lbl">${t('页宽')} <b id="v-w">${settings.width}</b></div><input type="range" id="s-w" min="560" max="1000" step="20" value="${settings.width}"></div>
       <div class="grp"><div class="lbl">${t('字体')}</div><div class="seg" id="s-font"><button data-f="system" class="${settings.font === 'system' ? 'active' : ''}">${t('系统')}</button><button data-f="sans" class="${settings.font === 'sans' ? 'active' : ''}">${t('黑体')}</button><button data-f="serif" class="${settings.font === 'serif' ? 'active' : ''}">${t('宋体')}</button></div></div>
       <label class="grp toggle"><span class="lbl">${t('显示目录侧栏（电脑端）')}</span><input type="checkbox" id="s-outline" ${settings.showOutline ? 'checked' : ''}></label>
       <label class="grp toggle"><span class="lbl">${t('右侧缩略图 Minimap（电脑端）')}</span><input type="checkbox" id="s-minimap" ${settings.minimap ? 'checked' : ''}></label>
       <label class="grp toggle"><span class="lbl">${t('网文连续滚动')}</span><button type="button" class="qmark" data-q="${esc(t('像起点那样：滚到底自动接上下一章、向上滚动接上一章；章节会提前在后台取好、远处章节自动卸载。关掉则一章一页、用上一章 / 下一章翻页。'))}">?</button><input type="checkbox" id="s-seamless" ${settings.seamlessScroll ? 'checked' : ''}></label>
       <label class="grp toggle"><span class="lbl">${t('进入详情页自动沉浸')}</span><input type="checkbox" id="s-auto" ${settings.autoOpen ? 'checked' : ''}></label>
       <label class="grp toggle"><span class="lbl">${t('阅读进度')}</span><button type="button" class="qmark" data-q="${esc(t('网文回到上次看的章节，单篇回到上次的位置'))}">?</button><input type="checkbox" id="s-resume" ${settings.resume ? 'checked' : ''}></label>
       <div class="grp" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="set-btn" id="s-progexp" style="flex:1">⤓ ${t('导出进度')}</button><button class="set-btn" id="s-progimp" style="flex:1">⤒ ${t('导入进度')}</button><button type="button" class="qmark" data-q="${esc(t('进度只存在本机、按登录账号分开存放；换设备时导出再导入即可（不会与其它账号混用）。'))}">?</button><input type="file" id="s-progfile" accept="application/json,.json" style="display:none"></div>
       <div class="grp" style="display:flex;gap:8px;align-items:center"><button class="set-btn" id="s-guide" style="flex:1">${t('📖 功能向导 / 使用说明')}</button><button type="button" class="qmark" data-q="${esc(t('界面做了精简、很多功能被收了起来；忘记某个功能怎么用时，随时点这里重看分步引导。'))}">?</button></div>
       <div class="grp"><div class="lbl">${t('下载 EPUB 版本')}</div><div class="seg" id="s-epubver"><button data-v="3" class="${v3sel ? 'active' : ''}">EPUB&nbsp;3</button><button data-v="2" class="${!v3sel ? 'active' : ''}">EPUB&nbsp;2</button></div><div class="set-hint">${t('默认生成更规范的 EPUB 3（现行标准）；个别老设备 / 老阅读器不兼容时再切回 EPUB 2。')}</div></div>
       <section class="set-adv">
         <button type="button" class="set-adv-h" id="s-adv-toggle" aria-expanded="${settings.foldAdv ? 'true' : 'false'}" aria-controls="s-adv-body"><span>${t('高级 / 实验性功能')}</span><span class="set-adv-caret" aria-hidden="true">▸</span></button>
         <div class="set-adv-body" id="s-adv-body" role="region" aria-label="${esc(t('高级 / 实验性功能'))}"${settings.foldAdv ? '' : ' hidden'}>
           <section class="set-sub">
             <div class="set-sub-h">📚 <span>${t('发送到书库（Calibre）')}</span> <span class="set-tag">${t('实验性')}</span><button type="button" class="qmark" data-q="${esc(t('需自行搭建 calibre-bridge 并允许脚本连接该地址，自担风险。'))}">?</button></div>
             <label class="grp toggle" style="margin:8px 0 0"><span class="lbl">${t('启用书库')}</span><input type="checkbox" id="s-lib" ${settings.libEnable ? 'checked' : ''}></label>
             <input type="text" id="s-liburl" class="lib-in" value="${esc(settings.libUrl || '')}" placeholder="http://127.0.0.1:8788">
             <input type="text" id="s-libtoken" class="lib-in" value="${esc(settings.libToken || '')}" placeholder="${esc(t('Token（可选，留空即不校验）'))}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other">
             <button class="set-btn" id="s-libtest">${t('测试连接')}</button>
             <div class="set-hint" id="libHint"></div>
           </section>
           <section class="set-sub">
             <div class="set-sub-h">🤖 <span>${t('用 LLM 整理元数据')}</span> <span class="set-tag">${t('实验性')}</span><button type="button" class="qmark" data-q="${esc(t('API Key 明文存于本机浏览器；会把卷首文本发往第三方、可能产生费用，自担风险。'))}">?</button></div>
             <label class="grp toggle" style="margin:8px 0 0"><span class="lbl">${t('启用 LLM 整理')}</span><input type="checkbox" id="s-llm" ${settings.llmEnable ? 'checked' : ''}></label>
             <div class="seg" id="s-llmprov" style="margin:8px 0 0">${Object.entries(LLM_PRESETS).map(([k, p]) => `<button data-p="${k}" class="${(settings.llmProvider || 'openai') === k ? 'active' : ''}">${esc(t(p.label))}</button>`).join('')}</div>
             <input type="text" id="s-llmbase" class="lib-in" value="${esc(settings.llmBase || '')}" placeholder="${esc(lp.base)}">
             <input type="text" id="s-llmkey" class="lib-in" value="${esc(settings.llmKey || '')}" placeholder="${esc(t('API Key（仅存于本机浏览器）'))}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other">
             <input type="text" id="s-llmmodel" class="lib-in" value="${esc(settings.llmModel || '')}" placeholder="${esc(lp.model)}">
             <button class="set-btn" id="s-llmtest">${t('用当前书测试 / 重新整理')}</button>
             <div class="set-hint">${t('若使用其它接口地址，需在脚本头部加一行 @connect 你的域名（或在 Tampermonkey 弹窗里允许）。')}</div>
             <div class="set-hint" id="llmHint"></div>
           </section>
         </div>
       </section>`;
    const sw = body.querySelector('#sw');
    const swatches = [['system', '跟随系统'], ['paper', '纸白'], ['sepia', '护眼'], ['dark', '夜间'], ['custom', '自定义']];
    sw.innerHTML = swatches.map(([k, label]) => {
      let style;
      if (k === 'system') style = 'background:linear-gradient(135deg,#f5f5f7 0 50%,#15171a 50% 100%);color:#9aa';
      else { const t = k === 'custom' ? deriveTheme(settings.customColor) : THEMES[k]; style = `background:${t.surface};color:${t.text}`; }
      return `<button class="sw ${settings.theme === k ? 'active' : ''}" data-k="${k}" style="${style}">${t(label)}</button>`;
    }).join('');
    sw.querySelectorAll('.sw').forEach((b) => (b.onclick = () => { settings.theme = b.dataset.k; saveSettings(); applyTheme(); renderSettings(); }));
    const ci = body.querySelector('#s-custom');
    if (ci) ci.oninput = (e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) { settings.customColor = v; const swp = body.querySelector('#customSw'); if (swp) swp.style.background = v; saveSettings(); if (settings.theme === 'custom') applyTheme(); } };
    const bind = (id, key, vid, fmt) => { body.querySelector(id).oninput = (e) => { settings[key] = key === 'lineHeight' ? parseFloat(e.target.value) : Number(e.target.value); body.querySelector(vid).textContent = fmt ? fmt(settings[key]) : settings[key]; saveSettings(); applyTheme(); }; };
    bind('#s-fs', 'fontSize', '#v-fs'); bind('#s-lh', 'lineHeight', '#v-lh', (v) => v.toFixed(1)); bind('#s-w', 'width', '#v-w');
    body.querySelectorAll('#s-font button').forEach((b) => (b.onclick = () => { settings.font = b.dataset.f; saveSettings(); applyTheme(); renderSettings(); }));
    body.querySelector('#s-auto').onchange = (e) => { settings.autoOpen = e.target.checked; saveSettings(); };
    body.querySelector('#s-resume').onchange = (e) => { settings.resume = e.target.checked; saveSettings(); };
    const epubSeg = body.querySelector('#s-epubver'); if (epubSeg) epubSeg.querySelectorAll('button').forEach((b) => (b.onclick = () => { settings.epubVer = Number(b.dataset.v); saveSettings(); renderSettings(); }));
    body.querySelector('#s-progexp').onclick = exportProg;
    body.querySelector('#s-progimp').onclick = () => body.querySelector('#s-progfile').click();
    body.querySelector('#s-progfile').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => importProg(String(rd.result || '')); rd.readAsText(f); e.target.value = ''; };
    body.querySelector('#s-outline').onchange = (e) => { settings.showOutline = e.target.checked; saveSettings(); openOutline(e.target.checked && !isMobile()); };
    body.querySelector('#s-minimap').onchange = (e) => { settings.minimap = e.target.checked; saveSettings(); buildMinimap(); };
    body.querySelector('#s-seamless').onchange = (e) => { settings.seamlessScroll = e.target.checked; saveSettings(); if (S.mode === 'series') { const i = S.idx; if (e.target.checked) renderFlow(i); else { flowTeardown(); renderChapter(i); } } };
    body.querySelector('#s-guide').onclick = () => { togglePanel(false); openGuide(0); };
    // Advanced/experimental disclosure (accessible button + region; remembers its open state so a
    // re-render — e.g. picking an LLM provider — doesn't fold it back up).
    const advT = body.querySelector('#s-adv-toggle');
    advT.onclick = () => { const open = advT.getAttribute('aria-expanded') !== 'true'; advT.setAttribute('aria-expanded', open ? 'true' : 'false'); body.querySelector('#s-adv-body').hidden = !open; settings.foldAdv = open; saveSettings(); };
    bindQmarks(body);   // ? buttons → click to toggle an inline help note (no slow hover tooltips)
    body.querySelector('#s-lang').querySelectorAll('button').forEach((b) => (b.onclick = () => { settings.lang = b.dataset.l; saveSettings(); applyLang(); renderSettings(); }));
    body.querySelector('#s-lib').onchange = (e) => { settings.libEnable = e.target.checked; saveSettings(); };
    body.querySelector('#s-liburl').oninput = (e) => { settings.libUrl = e.target.value.trim(); saveSettings(); };
    body.querySelector('#s-libtoken').oninput = (e) => { settings.libToken = e.target.value.trim(); saveSettings(); };
    body.querySelector('#s-libtest').onclick = () => {
      const hint = body.querySelector('#libHint'); hint.textContent = t('连接中…');
      const c = libCfg(); if (!c.url) { hint.textContent = t('请先填写书库地址'); return; }
      gmReq({ method: 'GET', url: c.url + '/api/health', headers: libHeaders(), timeout: 6000 })
        .then((r) => { if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status); const j = JSON.parse(r.responseText); hint.textContent = t('已连接 ✓ 模式 ') + j.mode + t(' · 已收录 ') + j.books + t(' 本'); })
        .catch((e) => { hint.textContent = t('连接失败：') + (e && e.message || e) + t(' · 请确认 calibre-bridge 已启动且地址正确'); });
    };
    const provSeg = body.querySelector('#s-llmprov'); if (provSeg) provSeg.querySelectorAll('button').forEach((b) => (b.onclick = () => { settings.llmProvider = b.dataset.p; saveSettings(); renderSettings(); }));
    body.querySelector('#s-llm').onchange = (e) => { settings.llmEnable = e.target.checked; saveSettings(); };
    body.querySelector('#s-llmbase').oninput = (e) => { settings.llmBase = e.target.value.trim(); saveSettings(); };
    body.querySelector('#s-llmkey').oninput = (e) => { settings.llmKey = e.target.value.trim(); saveSettings(); };
    body.querySelector('#s-llmmodel').oninput = (e) => { settings.llmModel = e.target.value.trim(); saveSettings(); };
    body.querySelector('#s-llmtest').onclick = async () => {
      const h = body.querySelector('#llmHint'); const c = llmCfg();
      if (!c.on) { h.textContent = t('请先勾选「启用 LLM 整理」'); return; }
      if (!c.key) { h.textContent = t('请先填写 API Key'); return; }
      if (!S.aid || !S.detail) { h.textContent = t('请先打开一本书再测试'); return; }
      h.textContent = t('整理中…（仅发送卷首文本）');
      const m = await ensureLLMMeta(S.aid, true);
      h.textContent = m ? (t('已整理 ✓ ') + [m.title && ('《' + m.title + '》'), (m.volume != null && m.volume !== '') && (t('卷') + ' ' + m.volume), m.author && (t('作者') + ' ' + m.author), m.illustrator && (t('插画') + ' ' + m.illustrator), m.translator && (t('译者') + ' ' + m.translator)].filter(Boolean).join(' · ')) : t('整理失败或无结果（看上方提示）');
    };
  }

  /* ===================== Calibre book-library bridge ======================= */
  const libCfg = () => ({ on: !!settings.libEnable, url: String(settings.libUrl || '').replace(/\/+$/, ''), token: settings.libToken || '' });
  const libHeaders = () => (settings.libToken ? { Authorization: 'Bearer ' + settings.libToken } : {});
  function gmReq(opts) { return new Promise((res, rej) => { try { GM_xmlhttpRequest(Object.assign({ onload: (r) => res(r), onerror: () => rej(new Error('network')), ontimeout: () => rej(new Error('timeout')) }, opts)); } catch (e) { rej(e); } }); }
  // Parse the credit block most LK novel uploads carry near the top (作者：/插画：/翻译：/图源：/录入：…).
  // Tolerant of simplified+traditional, full/half-width colons, and compound labels (录入/翻译, 监修·插图).
  // Returns {author, translator, illustrator, source, editor, original}; the real 作者 beats the uploader nickname.
  function extractCredits(raw) {
    const lines = htmlToText(raw).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
    const clean = (v) => String(v).replace(/\[\/?[a-z][^\]]*\]/gi, '').replace(/^[：:\s]+/, '').split(/[，。；;！？\n\r|｜]/)[0].trim().slice(0, 40);
    const LBL = [
      ['author', /作\s*者|著\s*者/],
      ['translator', /翻\s*[译譯校]|[译譯]\s*者|[汉漢]\s*化/],
      ['illustrator', /插\s*[畫画图圖]|[绘繪]\s*[师師]|ill?ustration|イラスト|作\s*[画畫]/i],
      ['source', /[图圖]\s*源|[扫掃]\s*[图圖]/],
      ['editor', /[录錄]\s*入|校\s*[对對]/],
      ['original', /原\s*作|原\s*著/],
    ];
    const out = {};
    for (const line of lines) {
      const m = line.match(/^(.{1,14}?)\s*[：:]\s*(.+)$/); if (!m) continue;
      const label = m[1], val = clean(m[2]); if (!val || /^https?:/i.test(val)) continue;
      for (const [key, re] of LBL) if (!out[key] && re.test(label)) out[key] = val;
    }
    return out;
  }
  function detailDate(d) { if (!d) return ''; const v = d.last_update_time || d.update_time || d.updated_at || d.ctime || d.create_time || d.published_at || d.add_time; if (!v) return ''; let n = Number(v); if (n) { if (n < 1e12) n *= 1000; try { return new Date(n).toISOString().slice(0, 10); } catch { return ''; } } return String(v).slice(0, 10); }
  function detailTags(d) { if (!d) return []; const out = []; const push = (x) => { if (x && typeof x === 'string') out.push(x); else if (x && x.name) out.push(x.name); }; (d.tags || d.tag_list || []).forEach(push); if (d.category) push(d.category); if (d.cate_name) out.push(d.cate_name); return [...new Set(out)].slice(0, 8); }
  /* ---- optional LLM metadata tidy-up. Rule-based parsing is brittle, so (opt-in) we send ONLY the
     short credit/卷首 block — never the book, and images carry no info — to an OpenAI-compatible API
     (OpenAI / DeepSeek / …) or to Kimi Code (which speaks the Anthropic /messages protocol at
     api.kimi.com/coding). The result is cached per book, so 10 downloads cost at most 1 call. Keys live
     only in this browser's localStorage; enabling it sends that header text to a third party at the
     user's own cost/risk. ---- */
  // DeepSeek is OpenAI-compatible, so it's folded into the one "OpenAI 兼容" preset (just change the base/model).
  const LLM_PRESETS = {
    openai: { label: 'OpenAI 兼容', base: 'https://api.deepseek.com', model: 'deepseek-chat', style: 'openai' },
    kimicode: { label: 'Kimi Code', base: 'https://api.kimi.com/coding', model: 'kimi-for-coding', style: 'anthropic' },
  };
  const llmPreset = () => LLM_PRESETS[settings.llmProvider] || LLM_PRESETS.openai;
  const llmCfg = () => { const p = llmPreset(); return { on: !!settings.llmEnable, base: String(settings.llmBase || p.base).replace(/\/+$/, ''), key: settings.llmKey || '', model: settings.llmModel || p.model, style: p.style }; };
  const LS_META = 'lir_meta_cache';                                   // { <aid>: {fields…, _t, _model} } — book-level, shared across accounts
  const metaCacheAll = () => { try { return JSON.parse(localStorage.getItem(LS_META) || '{}'); } catch { return {}; } };
  const getCachedMeta = (aid) => metaCacheAll()[String(aid)] || null;
  function setCachedMeta(aid, m) { try { const c = metaCacheAll(); c[String(aid)] = Object.assign({}, m, { _t: Date.now(), _model: llmCfg().model }); localStorage.setItem(LS_META, JSON.stringify(c)); } catch { /* */ } }
  function metaHeaderText() {
    const head = htmlToText(S.raw).slice(0, 1500);
    return `网站标题：${(S.detail && S.detail.title) || ''}\n网站作者：${S.author || ''}\n\n卷首文本：\n${head}`;
  }
  function parseJsonLoose(s) { if (!s) return null; let t = String(s).trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1); try { return JSON.parse(t); } catch { return null; } }
  const LLM_SYS = '你从轻小说的卷首/版权信息里提取元数据。只返回一个压缩 JSON，不要解释、不要 markdown。键：title(书名，去掉卷号/系列后缀)、series(系列名)、volume(整数卷号，没有则 null)、author(作者/原作)、illustrator(插畫/插图/绘师)、translator(译者/翻譯)、source(圖源/扫图)、editor(录入/校对)、language("zh-Hant" 或 "zh-Hans")。名字保留原文语言。未知填 null。';
  async function extractMetaLLM(text) {
    const c = llmCfg(); if (!c.on || !c.key) return null;
    const user = '提取下面信息的元数据，只回 JSON：\n\n' + text;
    let url, headers, body;
    if (c.style === 'anthropic') {                                   // Kimi Code: Anthropic /v1/messages protocol
      url = c.base + '/v1/messages';
      headers = { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'User-Agent': 'claude-code/0.1.0' };
      body = { model: c.model, max_tokens: 500, system: LLM_SYS, messages: [{ role: 'user', content: user }] };
    } else {                                                         // OpenAI-compatible (OpenAI, DeepSeek, …)
      url = c.base + '/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key };
      body = { model: c.model, temperature: 0, max_tokens: 500, messages: [{ role: 'system', content: LLM_SYS }, { role: 'user', content: user }] };
    }
    const r = await gmReq({ method: 'POST', url, headers, data: JSON.stringify(body), timeout: 30000 });
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 160));
    const j = JSON.parse(r.responseText);
    const content = c.style === 'anthropic' ? (j.content || []).map((b) => b.text || '').join('') : (((j.choices || [])[0] || {}).message || {}).content || '';
    return parseJsonLoose(content);
  }
  // cache-first: only hit the LLM when there's no cached result (or force=true). Returns cached meta if the LLM is off.
  async function ensureLLMMeta(aid, force) {
    const c = llmCfg(); if (!c.on || !c.key) return getCachedMeta(aid);
    if (!force) { const cached = getCachedMeta(aid); if (cached) return cached; }
    try { const m = await extractMetaLLM(metaHeaderText()); if (m) { setCachedMeta(aid, m); return m; } } catch (e) { flashToast(t('LLM 整理失败：') + ((e && e.message) || e)); }
    return getCachedMeta(aid);
  }
  const metaPick = (llm, k) => { if (!llm) return null; const v = llm[k]; const s = (v == null ? '' : String(v)).trim(); return (s && s.toLowerCase() !== 'null') ? s : null; };
  function buildLibMeta(llm) {
    const m = { aid: S.aid, lkUrl: 'https://www.lightnovel.fun/detail/' + S.aid, title: S.bookTitle, author: S.author || '', language: 'zh' };
    const cr = extractCredits(S.raw);                               // the in-text 作者/插画/翻译/… block
    if (cr.author) m.author = cr.author;                            // the real novel author beats the LK uploader nickname
    if (cr.translator) m.translator = cr.translator;
    if (cr.illustrator) m.illustrator = cr.illustrator;
    if (cr.source) m.sourceGroup = cr.source;
    if (cr.editor) m.editor = cr.editor;                            // 录入/校对 → dc:contributor edt
    if (cr.original) m.original = cr.original;                      // 原作 → 2nd dc:creator aut (if distinct)
    const up = detailDate(S.detail); if (up) m.updated = up;
    if (S.volumes && S.volumes.length > 1) { m.series = cleanTitle(commonPrefix(S.volumes.map((v) => v.title))) || S.bookTitle; const vi = S.volumes.findIndex((v) => v.aid === S.aid); if (vi >= 0) m.volume = vi + 1; }
    const tags = detailTags(S.detail); if (tags.length) m.tags = tags;
    if (llm) {                                                       // LLM fields take precedence over the regex/site guesses
      const t = metaPick(llm, 'title'); if (t) m.title = t;
      const au = metaPick(llm, 'author'); if (au) m.author = au;
      const trn = metaPick(llm, 'translator'); if (trn) m.translator = trn;
      const il = metaPick(llm, 'illustrator'); if (il) m.illustrator = il;
      const se = metaPick(llm, 'series'); if (se) m.series = se;
      const so = metaPick(llm, 'source'); if (so) m.sourceGroup = so;
      const ed = metaPick(llm, 'editor'); if (ed) m.editor = ed;
      if (llm.volume != null && !isNaN(Number(llm.volume))) m.volume = Number(llm.volume);
      const lang = metaPick(llm, 'language'); if (lang && /hant|hans|繁|简/i.test(lang)) m.language = /hant|繁/i.test(lang) ? 'zh-Hant' : 'zh-Hans';
    }
    return m;
  }
  function libImport(meta, bytes, name, onP) {
    const c = libCfg(); if (!c.on || !c.url) return Promise.reject(new Error('书库未启用'));
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'application/epub+zip' }), name || ('lknovel-' + S.aid + '.epub'));
    fd.append('meta', JSON.stringify(meta));
    return gmReq({ method: 'POST', url: c.url + '/api/import', headers: libHeaders(), data: fd, timeout: 120000 })
      .then((r) => { if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + (r.responseText ? ' ' + r.responseText.slice(0, 120) : '')); return JSON.parse(r.responseText); });
  }

  /* ---- resume reading. LK keeps NO within-article position anywhere (verified: article/get-detail
     has none, and series chapters carry no read flag); its one progress signal is history/get-history.
     So web novels resume at the last-read CHAPTER from LK's own history, and the exact scroll inside a
     single-article book is remembered locally per aid. No server, no 2-way sync. ---- */
  // progress is partitioned by ACCOUNT (uid parsed from the site's security_key) so two people
  // sharing a browser — or an imported file from another account — never bleed into each other:
  // { <uid>: { <aid>: {p:pct, t:ms} } }. Reads/writes only ever touch the active account's slice.
  const LS_PROG = 'lir_progress';
  const acctId = () => { const sk = findSecurityKey(); const m = sk && sk.match(/^[a-f0-9]+:(\d+):/); return (m && m[1]) || 'anon'; };
  const progRoot = () => { try { const r = JSON.parse(localStorage.getItem(LS_PROG) || '{}'); return (r && typeof r === 'object') ? r : {}; } catch { return {}; } };
  const progAll = () => progRoot()[acctId()] || {};
  const getProg = (aid) => { const e = progAll()[aid]; return e == null ? 0 : (typeof e === 'number' ? e : (e.p || 0)); };
  function saveProg(aid, pct) {
    if (!aid) return;
    try { const root = progRoot(), u = acctId(), m = root[u] || (root[u] = {});
      if (pct > 0.03 && pct < 0.985) m[aid] = { p: Math.round(pct * 1000) / 1000, t: Date.now() }; else delete m[aid];
      localStorage.setItem(LS_PROG, JSON.stringify(root)); } catch { /* */ }
  }
  // export only the CURRENT account's progress; import merges each account into ITS OWN namespace
  // (newer timestamp wins) so moving the file to a device on another login can't pollute that login.
  function exportProg() {
    const u = acctId(); const payload = { app: 'lknovel-immersive-reader', kind: 'reading-progress', v: 1, account: u, progress: { [u]: progRoot()[u] || {} } };
    download(JSON.stringify(payload, null, 2), 'lknovel-续读进度-' + u + '.json', 'application/json');
  }
  function importProg(text) {
    let data; try { data = JSON.parse(text); } catch { flashToast('文件读取失败：不是有效的 JSON'); return; }
    const accounts = data && (data.progress || data.accounts);
    if (!accounts || typeof accounts !== 'object') { flashToast('不是续读进度文件'); return; }
    const root = progRoot(); let merged = 0;
    for (const [uid, books] of Object.entries(accounts)) {
      if (!books || typeof books !== 'object') continue;
      const dst = root[uid] || (root[uid] = {});
      for (const [aid, ent] of Object.entries(books)) {
        const ne = (typeof ent === 'number') ? { p: ent, t: 0 } : ent; if (!ne || typeof ne.p !== 'number') continue;
        const cur = dst[aid]; const ct = (cur && typeof cur === 'object') ? (cur.t || 0) : (cur != null ? 0 : -1);
        if (cur == null || (ne.t || 0) >= ct) { dst[aid] = { p: ne.p, t: ne.t || 0 }; merged++; }
      }
    }
    try { localStorage.setItem(LS_PROG, JSON.stringify(root)); } catch { /* */ }
    const cur = acctId(), forCur = (accounts[cur] && Object.keys(accounts[cur]).length) || 0;
    flashToast(t('已导入 ') + merged + ' 条续读' + (accounts[cur] ? `· 当前账号 ${forCur} 本` : '· 不含当前账号（已分账号归档）'));
  }
  function restoreProg(aid, announce) {
    if (!settings.resume || !aid) return;
    const pct = getProg(aid); if (pct <= 0.03) return;
    requestAnimationFrame(() => {
      if (curBmAid() !== aid) return;                                 // content changed under us (e.g. resolved into a series)
      const sc = $('scroll'), max = sc.scrollHeight - sc.clientHeight;
      if (max <= 40 || sc.scrollTop >= 40) return;                    // only resume when still sitting at the top
      pinScroll(() => getProg(aid) * (sc.scrollHeight - sc.clientHeight));  // re-pin as images settle
      if (announce && pct > 0.06) flashToast(t('已为你续读至 ') + Math.round(pct * 100) + '%');
    });
  }
  let progTimer = 0;
  function scheduleSaveProg() {
    clearTimeout(progTimer);
    progTimer = setTimeout(() => {
      if (S.flow) {
        const c = S.toc[S.idx];
        if (c && c.aid && chapEl(S.idx)) saveProg(c.aid, chapFrac());
        return;   // seamless: a coarse within-chapter offset, keyed on the ACTIVE chapter's aid
      }
      const sc = $('scroll'), max = sc.scrollHeight - sc.clientHeight; if (max > 0) saveProg(curBmAid(), sc.scrollTop / max);
    }, 700);
  }
  // seamless resume: restore the saved within-chapter offset for the chapter we opened at, re-pinning as
  // lazy chunks/images settle (pinScroll re-targets; the chunk ResizeObserver pins everything above)
  function restoreFlowProg(i) {
    if (!settings.resume || !S.flow) return;
    const c = S.toc[i]; if (!c || !c.aid) return;
    const pct = getProg(c.aid); if (pct <= 0.03) return;
    requestAnimationFrame(() => {
      if (!S.flow || S.idx !== i || !chapEl(i)) return;
      pinScroll(() => { const sec = chapEl(i); return sec ? chapTop(i) + pct * (sec.offsetHeight || 0) : 0; });
    });
  }
  // scan a few pages of LK history (recency-sorted) and return the most-recently-read aid in this series
  async function lastReadAid(aidSet) {
    try { for (let p = 1; p <= 4; p++) { const data = await apiCall('/api/history/get-history', { page: p }); const list = (data && data.list) || []; if (!list.length) break; for (const it of list) if (aidSet.has(it.aid)) return it.aid; } } catch { /* */ }
    return null;
  }

  /* ===================== download flow ======================= */
  function openDlg() {
    $('dlg').classList.add('show'); $('dlgMsg').textContent = t('选择导出格式'); $('dlgActs').style.display = '';
    $('dl-lib').style.display = settings.libEnable ? '' : 'none';
    const isSeries = S.mode === 'series' && S.toc.length > 1;
    $('dlRange').style.display = isSeries ? '' : 'none';
    $('dlg').querySelector('.dlg-card').classList.toggle('has-range', isSeries);
    $('dlgT').textContent = isSeries ? t('选择章节范围') : t('下载 / 发送整本');
    if (isSeries) buildDlRange();
  }
  // A list-based chapter range picker (hotel/flight calendar style): click a start chapter, then an
  // end chapter; the span between them fills in. Default = the whole book. Re-using the outline's labels.
  function buildDlRange() {
    const N = S.toc.length, list = $('dlList');
    dlFrom = 0; dlTo = N - 1; dlPhase = 'start';
    $('dlRngLbl').textContent = t('章节范围');
    $('dlRngAll').textContent = t('整本');
    list.setAttribute('aria-label', t('章节范围'));
    $('dlFromLbl').textContent = t('从'); $('dlToLbl').textContent = t('到');
    const inA = $('dlFrom'), inB = $('dlTo'); inA.min = inB.min = '1'; inA.max = inB.max = String(N);
    const nm = (i) => (S.labels && S.labels[i]) || (S.toc[i] && S.toc[i].title) || ('#' + (i + 1));
    list.innerHTML = S.toc.map((c, i) => `<button class="dl-ch" type="button" aria-pressed="false" data-i="${i}" title="${esc(nm(i))}"><span class="n">${i + 1}</span><span class="ttl">${esc(nm(i))}</span></button>`).join('');
    const btns = [...list.querySelectorAll('.dl-ch')];
    // Two ways to pick, kept in sync: click a start chapter then an end chapter in the list (hotel/flight
    // calendar style), OR just type the numbers. While picking the end (phase 'end'), hovering chapter
    // `preview` shows the tentative span; otherwise the committed [dlFrom..dlTo] shows. Endpoints get
    // .end1 + the chapters between get .in; the span is mirrored to aria-pressed and the number inputs.
    const paint = (preview) => {
      const usePrev = (preview != null && dlPhase === 'end');
      const lo = Math.min(dlFrom, usePrev ? preview : dlTo), hi = Math.max(dlFrom, usePrev ? preview : dlTo);
      btns.forEach((el, i) => { const on = i >= lo && i <= hi; el.classList.toggle('end1', i === lo || i === hi); el.classList.toggle('in', i > lo && i < hi); el.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      $('dlRngCount').textContent = (hi - lo + 1) + ' / ' + N;
      $('dlRngTip').textContent = dlPhase === 'end' ? t('再点一章设为结束') : t('点一章设为开始，再点一章设为结束');
      const clo = Math.min(dlFrom, dlTo) + 1, chi = Math.max(dlFrom, dlTo) + 1;   // mirror the committed span to the inputs (don't clobber the one being typed in)
      if (root.activeElement !== inA && root.activeElement !== inB) { inA.value = String(clo); inB.value = String(chi); }
    };
    btns.forEach((el) => {
      el.onclick = () => {
        const i = Number(el.dataset.i);
        if (dlPhase === 'start') { dlFrom = i; dlTo = i; dlPhase = 'end'; }
        else { dlTo = i; dlPhase = 'start'; }   // dlFrom is the anchor; paint() orders lo/hi so a backward pick still works
        paint();
      };
      el.onmouseenter = () => { if (dlPhase === 'end') paint(Number(el.dataset.i)); };
      el.onfocus = () => { if (dlPhase === 'end') paint(Number(el.dataset.i)); };   // keyboard users see the tentative span as they tab toward the end
    });
    list.onmouseleave = () => { if (dlPhase === 'end') paint(); };
    list.onfocusout = (e) => { if (dlPhase === 'end' && !list.contains(e.relatedTarget)) paint(); };   // keyboard analogue of mouseleave
    // number inputs (1-based UI <-> 0-based state). Typing previews live; blur/Enter clamps + orders.
    const rd = (el, dflt) => { const n = parseInt(el.value, 10); return Number.isFinite(n) ? Math.min(N, Math.max(1, n)) : dflt; };
    inA.oninput = () => { const v = rd(inA, null); if (v != null) { dlFrom = v - 1; dlPhase = 'start'; paint(); } };
    inB.oninput = () => { const v = rd(inB, null); if (v != null) { dlTo = v - 1; dlPhase = 'start'; paint(); } };
    const commitNums = () => { let lo = rd(inA, 1), hi = rd(inB, N); if (lo > hi) { const m = lo; lo = hi; hi = m; } dlFrom = lo - 1; dlTo = hi - 1; dlPhase = 'start'; inA.value = String(lo); inB.value = String(hi); const c = btns[dlFrom]; if (c) c.scrollIntoView({ block: 'nearest' }); paint(); };
    inA.onchange = commitNums; inB.onchange = commitNums;
    $('dlRngAll').onclick = () => { dlFrom = 0; dlTo = N - 1; dlPhase = 'start'; paint(); btns[0] && btns[0].scrollIntoView({ block: 'nearest' }); };
    paint();
    const cur = btns[Math.min(N - 1, Math.max(0, S.idx | 0))]; cur && cur.scrollIntoView({ block: 'center' });   // anchor the list on the chapter being read (e.g. opening ch.700 of a 1000-ch series) instead of leaving it at ch.1
  }
  const getDlRange = () => {
    if (!(S.mode === 'series' && $('dlRange').style.display !== 'none')) return null;
    const N = S.toc.length, cl = (v) => Math.min(N - 1, Math.max(0, v | 0));
    let from = cl(dlFrom), to = cl(dlTo);
    if (from > to) { const m = from; from = to; to = m; }
    return { from, to };   // 0-based inclusive index
  };
  function closeDlg() { if (!S.busy) $('dlg').classList.remove('show'); }
  async function doSendToLib() {
    if (S.busy || !S.detail) return; S.busy = true; $('dlgActs').style.display = 'none';
    const onP = (m) => ($('dlgMsg').textContent = (curLang() === 'en' && EN[m]) ? EN[m] : m);
    try {
      if (settings.llmEnable) onP('正在用 LLM 整理元数据…');
      const llm = settings.llmEnable ? await ensureLLMMeta(S.aid) : getCachedMeta(S.aid);
      onP('正在打包章节…');
      const chapters = await gatherBook(onP, getDlRange());
      const src = 'https://www.lightnovel.fun/detail/' + S.aid;
      const cover = (S.detail && (S.detail.cover || S.detail.banner)) || '';
      onP('正在生成 EPUB…');
      const libMeta = buildLibMeta(llm);
      const { bytes, name } = await buildEpub(rangedTitle(chapters, metaPick(llm, 'title')), metaPick(llm, 'author') || S.author || '未知', src, chapters, cover, onP, libMeta);
      onP('正在发送到书库…');
      const resp = await libImport(libMeta, bytes, name, onP);
      onP(t('已发送到书库 ✓') + (resp && resp.import && resp.import.method === 'ingest' ? t('（CWA 正在导入）') : ''));
      setTimeout(() => { S.busy = false; $('dlg').classList.remove('show'); }, 1100);
    } catch (e) { onP(t('发送失败：') + (e && e.message || e) + t(' · 请确认本机 calibre-bridge 已启动')); S.busy = false; setTimeout(() => ($('dlgActs').style.display = ''), 100); }
  }
  async function gatherBook(onP, range) {
    if (S.mode === 'series') {
      const last = S.toc.length - 1;
      let from = range ? Math.max(0, Math.min(last, range.from | 0)) : 0;
      let to = range ? Math.max(0, Math.min(last, range.to | 0)) : last;
      if (from > to) { const t = from; from = to; to = t; }
      const out = []; for (let i = from; i <= to; i++) { onP && onP(`正在下载章节 ${i - from + 1}/${to - from + 1}…`); out.push({ title: S.toc[i].title, html: await ensureHtml(i) }); }
      out._range = { from, to, partial: !(from === 0 && to === last) };
      return out;
    }
    buildSections();
    return S.sections.map((s) => { const start = s.head ? s.start + 1 : s.start; return { title: s.title, html: S.blocks.slice(start, s.end).map((b) => b.html).join('<br/>') }; });
  }
  const rangedTitle = (chapters, base) => { const b = base || S.bookTitle; return (chapters._range && chapters._range.partial) ? `${b}（第${chapters._range.from + 1}-${chapters._range.to + 1}章）` : b; };
  async function doExport(kind) {
    if (S.busy || !S.detail) return; S.busy = true; $('dlgActs').style.display = 'none';
    const onP = (m) => ($('dlgMsg').textContent = (curLang() === 'en' && EN[m]) ? EN[m] : m);
    try {
      onP('正在准备…');
      if (settings.llmEnable) onP('正在用 LLM 整理元数据…');
      const llm = settings.llmEnable ? await ensureLLMMeta(S.aid) : getCachedMeta(S.aid);   // trigger the LLM (cached per book) when enabled, like send-to-library
      const chapters = await gatherBook(onP, getDlRange());
      const src = 'https://www.lightnovel.fun/detail/' + S.aid;
      const cover = (S.detail && (S.detail.cover || S.detail.banner)) || '';
      const title = rangedTitle(chapters, metaPick(llm, 'title'));
      const author = metaPick(llm, 'author') || extractCredits(S.raw).author || S.author || '未知';
      if (kind === 'txt') { const { text, name } = buildTxt(title, author, src, chapters); download(text, name, 'text/plain;charset=utf-8'); }
      else { const { bytes, name } = await buildEpub(title, author, src, chapters, cover, onP, buildLibMeta(llm)); download(bytes, name, 'application/epub+zip'); }
      onP('完成 ✓'); setTimeout(() => { S.busy = false; $('dlg').classList.remove('show'); }, 900);
    } catch (e) { onP(t('导出失败：') + (e && e.message || e)); S.busy = false; setTimeout(() => ($('dlgActs').style.display = ''), 100); }
  }

  /* ===================== open/close + events ================= */
  function openReader(aid) { pageAid = currentAid(); applyTheme(); $('overlay').classList.add('open'); document.documentElement.style.overflow = 'hidden'; openOutline(settings.showOutline && !isMobile()); openArticle(aid); maybeAutoGuide(); }
  function closeReader() {
    // land the site on the chapter actually being READ (in a web novel that's the active chapter,
    // which the live URL sync already shows — not the aid the book was first opened at)
    const landing = (S.mode === 'series' && S.toc[S.idx]) ? S.toc[S.idx].aid : S.aid;
    try { if (S.flow) { const c = S.toc[S.idx]; if (c && c.aid) saveProg(c.aid, chapFrac()); } else { const sc = $('scroll'), max = sc.scrollHeight - sc.clientHeight; if (max > 0 && S.aid) saveProg(curBmAid(), sc.scrollTop / max); } } catch { /* */ }
    $('overlay').classList.remove('open', 'splitting', 'marking', 'mm-on'); $('minimap').style.display = 'none'; document.documentElement.style.overflow = ''; exitMode(); togglePanel(false); openOutline(false); if ($('guide').classList.contains('show')) closeGuide();
    // if we were launched from a detail page and the reader walked to a different book/volume,
    // navigate the underlying site to it now (on exit) so the page behind matches what was read.
    if (pageAid != null && landing && landing !== pageAid) {
      suppressOpen = true;
      try { history.replaceState(history.state, '', '/detail/' + landing); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); } catch { /* */ }
      pageAid = landing;
      setTimeout(() => { suppressOpen = false; }, 1800);
    }
    if (S.flow) flowTeardown();   // stop observers/timers while the overlay is closed (reopen re-renders anyway)
  }
  function togglePanel(show) { hideQPop(); $('setPanel').classList.toggle('show', show); $('overlay').classList.toggle('panel-open', show); $('t-set').textContent = show ? '✕' : '⚙'; $('t-set').title = show ? t('关闭设置') : t('阅读设置'); updateScrim(); }
  // In seamless flow, "顶部" means the top of the CURRENT chapter — scrolling to absolute 0 would land
  // in the unloaded-spacer void above the window (and walk a prepend chain all the way to chapter 1).
  function flowTopTarget() { return Math.max(0, (chapEl(S.idx) ? chapTop(S.idx) : 0) - 4); }
  function updateTopBtn() { const el = $('scroll'); const atTop = el.scrollTop <= (S.flow ? flowTopTarget() + 60 : 60); const ic = $('r-top').querySelector('.ic'); const lb = $('r-top').querySelector('.lb'); if (atTop && savedScroll != null) { ic.textContent = '↓'; lb.textContent = t('返回'); } else { ic.textContent = '↑'; lb.textContent = t('顶部'); } }
  function toggleTop() { const el = $('scroll'); const behavior = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth'; const top = S.flow ? flowTopTarget() : 0; if (el.scrollTop > top + 60) { savedScroll = el.scrollTop; el.scrollTo({ top, behavior }); } else if (savedScroll != null) { el.scrollTo({ top: savedScroll, behavior }); savedScroll = null; } setTimeout(updateTopBtn, 50); }

  /* ===================== minimap (Sublime-style: offscreen full map drawn once, visible slice blitted on scroll) ======================= */
  // Enriched: real image thumbnails + faint per-chapter bands + chapter divider lines + amber bookmark ticks.
  // For tall books the map SCROLLS (offset) and the viewport box stays grabbable; drag follows the cursor (grab offset).
  let mmDrag = false, mmGrab = 0, mmRAF = 0, mmTimer = 0, mmMode = '', mmOff = 0, mmScaleSnap = 1, mmBaseSnap = 0;
  const minimapOn = () => settings.minimap && (S.mode === 'stream' || S.mode === 'series') && !isMobile() && $('overlay').classList.contains('open');
  const cssVar = (n, fb) => { try { return getComputedStyle($('overlay')).getPropertyValue(n).trim() || fb; } catch { return fb; } };
  const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(120,120,120,' + a + ')'; const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  // Minimap chapter tab text: prefer the chapter's OWN name over its running index ("第二章" can be the 3rd
  // section). Pull out the essential leading token (第N章/序章/终章/番外/幕間/楔子/Chapter N/卷首…); if no such
  // token, hard-cut the label so it can't overflow the narrow minimap.
  const CH_TOKEN = /^[\s　【\[［（(「『]*((?:第\s*[0-9０-９一二三四五六七八九十百千零〇两兩]+\s*[章话話回卷部节節])|序\s*[章幕话話]?|[终終]\s*[章话話]?|最\s*[终終]\s*[章话話]?|尾\s*[声聲]|番\s*外|幕\s*[间間]|[间間]\s*章|楔\s*子|引\s*子|卷\s*首|プロローグ|エピローグ|あとがき|Chapter\s*\d+|Prologue|Epilogue|Part\s*\d+)/i;
  function chapTab(label) {
    const s = String(label || '').trim(); if (!s) return '';
    const m = s.match(CH_TOKEN);
    let tab = m ? m[1].replace(/\s+/g, '') : s;
    return tab.length > 5 ? tab.slice(0, 5) : tab;   // fall back to a hard cut so it never overflows
  }
  function buildMinimap() {
    const mm = $('minimap'), ov = $('overlay'), content = $('content');
    if (S.flow) {   // seamless web-novel → the windowed painter (loaded chapters + ↑/↓ caps)
      if (!minimapOn() || !content || !content.querySelector('#flow') || !chapEl(S.win.first)) { mm.style.display = 'none'; ov.classList.remove('mm-on'); mm._full = null; return; }
      mm.style.display = ''; ov.classList.add('mm-on');
      buildMinimapFlow(); return;
    }
    const body = content && content.querySelector('.body');
    if (!minimapOn() || !body) { mm.style.display = 'none'; ov.classList.remove('mm-on'); mm._full = null; return; }
    mm.style.display = ''; ov.classList.add('mm-on');
    const sc = $('scroll');
    const sbw = Math.max(0, sc.offsetWidth - sc.clientWidth); mm.style.right = sbw + 'px'; // sit just LEFT of the native scrollbar (kept, Sublime-style)
    const W = Math.round(mm.clientWidth), H = Math.round(mm.clientHeight), docH = sc.scrollHeight || 1, cw = content.offsetWidth || settings.width;
    if (!W || !H) return;
    let scale = W / cw, mapH = docH * scale;
    const MAXH = 24000; if (mapH > MAXH) { scale *= MAXH / mapH; mapH = MAXH; }
    mapH = Math.max(1, Math.round(mapH)); // integer so the blit source rect never overruns full.height
    mm._scale = scale; mm._mapH = mapH;
    const full = document.createElement('canvas'); full.width = W; full.height = mapH;
    const fx = full.getContext('2d');
    const scTop = sc.getBoundingClientRect().top, scScroll = sc.scrollTop;
    const yOf = (el) => (el.getBoundingClientRect().top - scTop + scScroll) * scale;
    const txtCol = cssVar('--ir-text', '#333');
    const lhPx = (settings.fontSize || 19) * (settings.lineHeight || 1.9), lhMap = Math.max(1.2, lhPx * scale);
    const cpl = Math.max(8, (cw * 0.84) / (settings.fontSize || 19)); // ~chars per line, for last-line length
    // faint alternating per-chapter bands
    [...body.querySelectorAll('section.ch')].forEach((sec, i) => { if (i % 2) { fx.fillStyle = rgba(txtCol, 0.04); fx.fillRect(0, yOf(sec), W, Math.max(1, sec.offsetHeight * scale)); } });
    // text → mini striped "lines" with a shorter last line (Sublime-ish), not a solid block
    fx.fillStyle = rgba(txtCol, 0.34);
    const xPad = W * 0.12, lineW = W * 0.76, lineH = Math.max(0.7, lhMap * 0.52);
    body.querySelectorAll('.blk').forEach((el) => {
      if (el.querySelector('img')) return; const r = el.getBoundingClientRect(); if (!r.height) return;
      const top = (r.top - scTop + scScroll) * scale, h = r.height * scale, tlen = (el.textContent || '').trim().length; if (!tlen) return;
      const nLines = Math.max(1, Math.round(h / lhMap) || 1);
      for (let i = 0; i < nLines; i++) { let frac = 1; if (i === nLines - 1) frac = Math.max(0.16, Math.min(1, (tlen - i * cpl) / cpl)); fx.fillRect(xPad, top + i * lhMap, lineW * frac, lineH); }
    });
    // images → real thumbnails (the visual landmarks of an illustrated novel)
    body.querySelectorAll('img').forEach((img) => {
      if (!img.offsetHeight) return; const y = yOf(img), h = Math.max(2, img.offsetHeight * scale);
      const iw = Math.min(W * 0.92, (img.offsetWidth || cw) * scale), x = (W - iw) / 2;
      try { if (img.complete && img.naturalWidth) fx.drawImage(img, x, y, iw, h); else { fx.fillStyle = rgba(cssVar('--ir-muted', '#888'), 0.45); fx.fillRect(x, y, iw, h); } }
      catch { fx.fillStyle = rgba(cssVar('--ir-muted', '#888'), 0.45); fx.fillRect(x, y, iw, h); }
    });
    // chapter divider lines + a NAME tab on the left (the chapter's own name, not its running index)
    fx.textBaseline = 'middle'; fx.textAlign = 'center'; fx.font = '700 9px system-ui,-apple-system,sans-serif';
    let lastLbl = -999;
    [...body.querySelectorAll('section.ch')].forEach((sec, i) => {
      const top = yOf(sec);
      if (i > 0) { fx.fillStyle = '#6366f1'; fx.fillRect(0, Math.round(top) - 1, W, 2.6); }   // thicker full-width divider
      if (top - lastLbl >= 16) {
        lastLbl = top;
        const txt = chapTab(S.secLabels[i] || (S.sections[i] && S.sections[i].title) || ('#' + (i + 1)));
        if (txt) { const tw = Math.min(W * 0.66, Math.ceil(fx.measureText(txt).width) + 8); fx.fillStyle = '#4f46e5'; fx.fillRect(0, top, tw, 14); fx.fillStyle = '#fff'; fx.fillText(txt, tw / 2, top + 7.5); }
      }
    });
    // bookmarks → very noticeable: strong amber band + a bold amber tab on BOTH edges
    body.querySelectorAll('.blk.bm').forEach((el) => {
      const y = yOf(el), h = Math.max(7, el.getBoundingClientRect().height * scale);
      fx.fillStyle = 'rgba(232,163,61,0.42)'; fx.fillRect(0, y, W, Math.max(3, h));
      fx.fillStyle = '#e8a33d'; fx.fillRect(W - 12, y - 1, 12, Math.max(11, h + 2)); fx.fillRect(0, y - 1, 4, Math.max(11, h + 2));
    });
    mm._full = full; mm._flow = false;
    // late-loading images → rebuild so their thumbnails appear
    body.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', () => scheduleMinimap(180), { once: true }); });
    syncMinimap();
  }
  // Flow minimap: a detailed map of the LOADED WINDOW (not the whole book — the spacers would crush 12
  // real chapters into invisible slivers). Pinned ↑ / ↓ caps (drawn in syncMinimap) say how many chapters
  // lie beyond the window; clicking a cap jumps to the adjacent unloaded chapter. The painter works from
  // chunk-wrapper geometry + text-length metadata only, so it NEVER forces layout of a skipped chunk.
  function buildMinimapFlow() {
    const mm = $('minimap'), sc = $('scroll'), content = $('content');
    const sbw = Math.max(0, sc.offsetWidth - sc.clientWidth); mm.style.right = sbw + 'px';
    const W = Math.round(mm.clientWidth), H = Math.round(mm.clientHeight);
    const firstSec = chapEl(S.win.first), lastSec = chapEl(S.win.last);
    if (!W || !H || !firstSec || !lastSec) return;
    const cw = content.offsetWidth || settings.width;
    const winTop = secTop(firstSec), winBot = secTop(lastSec) + lastSec.offsetHeight, winH = Math.max(1, winBot - winTop);
    let scale = W / cw, mapH = winH * scale;
    const MAXH = 24000; if (mapH > MAXH) { scale *= MAXH / mapH; mapH = MAXH; }
    mapH = Math.max(1, Math.round(mapH));
    mm._scale = scale; mm._mapH = mapH; mm._flow = true; mm._base = winTop; mm._winH = winH;
    const full = document.createElement('canvas'); full.width = W; full.height = mapH;
    const fx = full.getContext('2d');
    const scTop = sc.getBoundingClientRect().top, scScroll = sc.scrollTop;
    const yOf = (el) => (el.getBoundingClientRect().top - scTop + scScroll - winTop) * scale;
    const txtCol = cssVar('--ir-text', '#333'), mutedCol = cssVar('--ir-muted', '#888');
    const cpl = flowCpl(), xPad = W * 0.12, lineW = W * 0.76;
    fx.textBaseline = 'middle'; fx.textAlign = 'center'; fx.font = '700 9px system-ui,-apple-system,sans-serif';
    let lastLbl = -999;
    for (let i = S.win.first; i <= S.win.last; i++) {
      const sec = chapEl(i); if (!sec) continue;
      const top = yOf(sec), secH = sec.offsetHeight * scale;
      if (i % 2) { fx.fillStyle = rgba(txtCol, 0.04); fx.fillRect(0, top, W, Math.max(1, secH)); }
      const blocks = chapBlocks(i);
      // text → striped mini lines per chunk (uniform rows from estimated line counts; image blocks → muted box)
      fx.fillStyle = rgba(txtCol, 0.34);
      sec.querySelectorAll('.chunk').forEach((ck) => {
        const ckTop = yOf(ck), ckH = ck.offsetHeight * scale;
        const s = Number(ck.dataset.ck) || 0, e = Math.min(blocks.length, s + CHUNK_BLOCKS);
        let total = 0; const ln = [];
        for (let bi = s; bi < e; bi++) { const l = blkLines(blocks[bi], cpl); ln.push(l); total += l; }
        if (!total || ckH <= 0) return;
        const rowH = ckH / total, lineH = Math.max(0.7, rowH * 0.55);
        let cum = 0;
        for (let k = 0; k < ln.length; k++) {
          const blk = blocks[s + k], n = ln[k];
          if (!blk.text) {
            if (/<img\b/i.test(blk.html)) { fx.fillStyle = rgba(mutedCol, 0.45); const iw = W * 0.7; fx.fillRect((W - iw) / 2, ckTop + cum * rowH, iw, Math.max(2, n * rowH * 0.9)); fx.fillStyle = rgba(txtCol, 0.34); }
            cum += n; continue;
          }
          for (let li = 0; li < n; li++) { let frac = 1; if (li === n - 1) frac = Math.max(0.16, Math.min(1, (blk.text.length - li * cpl) / cpl)); fx.fillRect(xPad, ckTop + (cum + li) * rowH, lineW * frac, lineH); }
          cum += n;
        }
      });
      // chapter divider + NAME tab
      if (i > S.win.first) { fx.fillStyle = '#6366f1'; fx.fillRect(0, Math.round(top) - 1, W, 2.6); }
      if (top - lastLbl >= 16) {
        lastLbl = top;
        const txt = chapTab(sec.dataset.label || ('#' + (i + 1)));
        if (txt) { const tw = Math.min(W * 0.66, Math.ceil(fx.measureText(txt).width) + 8); fx.fillStyle = '#4f46e5'; fx.fillRect(0, top, tw, 14); fx.fillStyle = '#fff'; fx.fillText(txt, tw / 2, top + 7.5); }
      }
      // bookmarks → amber band + bold edge tabs (positions estimated from the same line metadata)
      chapBm(i).forEach((b) => {
        const cs = Math.floor(b.bi / CHUNK_BLOCKS) * CHUNK_BLOCKS;
        const ck = sec.querySelector('.chunk[data-ck="' + cs + '"]'); if (!ck) return;
        const ckTop = yOf(ck), ckH = ck.offsetHeight * scale, e = Math.min(blocks.length, cs + CHUNK_BLOCKS);
        let total = 0, before = 0, cur = 1;
        for (let bi = cs; bi < e; bi++) { const l = blkLines(blocks[bi], cpl); if (bi < b.bi) before += l; if (bi === b.bi) cur = l; total += l; }
        if (!total) return;
        const y = ckTop + (before / total) * ckH, h = Math.max(7, (cur / total) * ckH);
        fx.fillStyle = 'rgba(232,163,61,0.42)'; fx.fillRect(0, y, W, Math.max(3, h));
        fx.fillStyle = '#e8a33d'; fx.fillRect(W - 12, y - 1, 12, Math.max(11, h + 2)); fx.fillRect(0, y - 1, 4, Math.max(11, h + 2));
      });
    }
    mm._full = full;
    syncMinimap();
  }
  function syncMinimap() {
    const mm = $('minimap'); if (!minimapOn() || !mm._full) return;
    const canvas = $('mmCanvas'), view = $('mmView'), sc = $('scroll');
    const W = Math.round(mm.clientWidth), H = Math.round(mm.clientHeight), scale = mm._scale, mapH = mm._mapH;
    const docH = sc.scrollHeight, vh = sc.clientHeight, st = sc.scrollTop;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const viewHmap = Math.max(14, vh * scale);
    const maxIndTop = Math.max(0, (mapH > H ? H : mapH) - viewHmap);
    // flow maps the loaded WINDOW (base.._winH), not the whole doc — the spacers are not on the canvas
    const prog = mm._flow
      ? Math.max(0, Math.min(1, (st - mm._base) / Math.max(1, mm._winH - vh)))
      : ((docH - vh) > 0 ? st / (docH - vh) : 0);
    const indTop = prog * maxIndTop;
    const yMap = mm._flow ? (st - mm._base) * scale : st * scale;
    const offset = mapH > H ? Math.max(0, Math.min(mapH - H, yMap - indTop)) : 0;
    ctx.drawImage(mm._full, 0, offset, W, Math.min(H, mapH - offset), 0, 0, W, Math.min(H, mapH - offset));
    // pinned ↑ / ↓ caps: how many chapters lie beyond the loaded window (click = jump to the next one)
    if (mm._flow) {
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = '700 9px system-ui,-apple-system,sans-serif';
      const en = curLang() === 'en', above = S.win.first, below = S.toc.length - 1 - S.win.last;
      if (above > 0) { ctx.fillStyle = 'rgba(79,70,229,0.92)'; ctx.fillRect(0, 0, W, 16); ctx.fillStyle = '#fff'; ctx.fillText('↑ ' + above + (en ? '' : ' 章'), W / 2, 8); }
      if (below > 0) { ctx.fillStyle = 'rgba(79,70,229,0.92)'; ctx.fillRect(0, H - 16, W, 16); ctx.fillStyle = '#fff'; ctx.fillText('↓ ' + below + (en ? '' : ' 章'), W / 2, H - 8); }
    }
    view.style.top = indTop + 'px'; view.style.height = viewHmap + 'px';
    mm._indTop = indTop; mm._maxIndTop = maxIndTop; mm._viewHmap = viewHmap; mm._offset = offset;
  }
  function minimapDragTo(clientY) {
    const mm = $('minimap'), sc = $('scroll'), rect = mm.getBoundingClientRect();
    const maxIndTop = mm._maxIndTop || 0;
    const indTop = Math.max(0, Math.min(maxIndTop, (clientY - rect.top) - mmGrab));
    const prog = maxIndTop > 0 ? indTop / maxIndTop : 0;
    if (mm._flow) { sc.scrollTop = mm._base + prog * Math.max(0, mm._winH - sc.clientHeight); return; }   // scrub within the loaded window; crossing an edge slides it
    sc.scrollTop = prog * Math.max(0, sc.scrollHeight - sc.clientHeight); // instant (no smooth) so it tracks the cursor
  }
  // jump so the content drawn at the clicked minimap pixel lands centered in the viewport. The map is
  // a scaled slice of the WHOLE doc, so map-Y = current slice offset + cursorY, and contentY = map-Y/scale.
  // (The old code mapped cursorY straight to book-%, so clicking a thumbnail in a long book missed it.)
  // Uses the slice offset/scale SNAPSHOTTED at pointer-down (mmOff/mmScaleSnap), not the live ones —
  // the jump scrolls the page, which re-renders the minimap slice; reading the live offset on the
  // follow-up pointermove would make a plain click double-jump to the wrong spot.
  function minimapGoTo(clientY) {
    const sc = $('scroll'), rect = $('minimap').getBoundingClientRect(), vh = sc.clientHeight;
    const contentY = mmBaseSnap + (mmOff + (clientY - rect.top)) / (mmScaleSnap || 1);   // flow: canvas Y is window-relative, so add the window base
    sc.scrollTop = Math.max(0, Math.min(Math.max(0, sc.scrollHeight - vh), contentY - vh / 2));
  }
  const scheduleMinimap = (d) => { clearTimeout(mmTimer); mmTimer = setTimeout(buildMinimap, d == null ? 250 : d); };

  /* ===================== feature guide (re-openable from 设置) ======================= */
  // hl = selector to spotlight. open=needs the outline open · reveal=hover-cluster button (show it) · panel=lives inside the settings panel.
  const GUIDE = [
    { t: { zh: '左侧大纲（☰）', en: 'The outline (☰)' }, b: { zh: '点左上角的 ☰ 打开或收起左边的大纲，用它在章节之间跳转。', en: 'Click the ☰ in the top-left to open or close the outline, and jump between chapters from there.' }, hl: '#t-outline' },
    { t: { zh: '下载整本（⤓）', en: 'Download (⤓)' }, b: { zh: '把鼠标移到左上角菜单，会滑出 ⤓ 和 ⚙。点 ⤓ 可以把整本存成 EPUB 或 TXT，也能只下载选定的章节。', en: 'Hover the top-left menu and ⤓ and ⚙ slide out. Click ⤓ to save the book as EPUB or TXT — or just the chapters you pick.' }, hl: '#t-dlCorner', reveal: true },
    { t: { zh: '目录 · 手动分章', en: 'Contents · split by hand' }, b: { zh: '在「目录」标签上再点一下进入分章模式：点正文任意一段就在那里另起一章，点段落上的标记可以合并回去。', en: 'Click the “Contents” tab again to adjust splits: click any paragraph to start a new chapter there, or click the mark on a paragraph to merge back.' }, hl: '.tab-toc', open: true },
    { t: { zh: '书签', en: 'Bookmarks' }, b: { zh: '切到「书签」标签，点正文任意一段就能加书签或取消，书签按章节归类。', en: 'On the “Bookmarks” tab, click any paragraph to add or remove a bookmark; they’re grouped by chapter.' }, hl: '[data-t="bm"]', open: true },
    { t: { zh: '分卷', en: 'Volumes' }, b: { zh: '多卷作品可以在「分卷」标签里切换卷。', en: 'For multi-volume works, switch volumes from the “Volumes” tab.' }, hl: '[data-t="vol"]', open: true },
    { t: { zh: '翻页 · 缩略图', en: 'Navigating · the minimap' }, b: { zh: '右侧浮窗有上一章 / 下一章 / 回顶部，键盘 ← → 也能翻章。在设置里打开缩略图后，点它任意位置就能跳过去。', en: 'The right-side rail has Prev / Next / Top, and ← → flip chapters too. Turn on the minimap in settings, then click anywhere on it to jump there.' }, hl: '#rail' },
    { t: { zh: '设置入口（⚙）', en: 'Settings (⚙)' }, b: { zh: '⚙ 就在 ☰ 旁边，点它打开设置。下面几步带你过一遍里面的选项。', en: '⚙ sits next to ☰ — click it to open settings. The next few steps walk through what’s inside.' }, hl: '#t-set', reveal: true },
    { t: { zh: '主题 / 外观', en: 'Theme & look' }, b: { zh: '选主题或底色，调字号、行距、页宽和字体；界面语言也在这里切换。', en: 'Pick a theme or background, adjust font, size, spacing and width; switch the UI language here too.' }, hl: '#sw', panel: true },
    { t: { zh: '阅读进度', en: 'Reading progress' }, b: { zh: '默认开启，会帮你回到上次读到的地方（按账号分开记）。换设备时用「导出 / 导入」搬过去。', en: 'On by default — it brings you back to where you left off (kept per account). Use Export / Import to move it between devices.' }, hl: '#s-resume', panel: true },
    { t: { zh: '高级 / 实验性功能', en: 'Advanced (experimental)' }, b: { zh: '点这条「高级 / 实验性功能」展开，里面有发送到 Calibre 和用 LLM 整理元数据。它们会连接外部服务、可能产生费用，请自行斟酌。', en: 'Expand “Advanced (experimental)” for Send-to-Calibre and LLM metadata. These reach external services and may cost money — use at your own discretion.' }, hl: '#s-adv-toggle', panel: true },
    { t: { zh: '退出', en: 'Done reading' }, b: { zh: '看完点右下角的「✕ 退出」离开；如果中途翻了章，网站会停在你最后读的那一章。', en: 'Click “✕ Exit” at the bottom-right when you’re done; if you changed chapters along the way, the site lands on your last one.' }, hl: '#close' },
  ];
  let guideIdx = 0;
  const clearGuideHl = () => root.querySelectorAll('.guide-hl').forEach((el) => el.classList.remove('guide-hl'));
  function openGuide(i) { guideIdx = i || 0; $('guide').classList.add('show'); showGuideStep(); }
  function closeGuide() {
    $('guide').classList.remove('show'); $('overlay').classList.remove('guide-reveal'); $('guideSpot').style.display = 'none'; clearGuideHl();
    togglePanel(false); openOutline(settings.showOutline && !isMobile());   // restore the panels the guide opened
    try { localStorage.setItem('lkir_guided', '1'); } catch { /* */ }
  }
  function placeSpot(sel) {
    clearGuideHl(); const el = sel && root.querySelector(sel); const spot = $('guideSpot');
    if (!el || !el.getClientRects().length) { spot.style.display = 'none'; return; }   // no layout box → don't draw a stray spotlight
    el.classList.add('guide-hl'); const r = el.getBoundingClientRect(); const pad = 6;
    spot.style.display = 'block'; spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
  }
  function showGuideStep() {
    const s = GUIDE[guideIdx]; if (!s) return; const L = curLang();
    $('guideStep').textContent = (guideIdx + 1) + ' / ' + GUIDE.length;
    $('guideTitle').textContent = s.t[L] || s.t.zh; $('guideBody').textContent = s.b[L] || s.b.zh;
    $('guidePrev').style.visibility = guideIdx === 0 ? 'hidden' : '';
    $('guideNext').textContent = guideIdx === GUIDE.length - 1 ? t('完成 ✓') : t('下一步 ›');
    $('guideDots').innerHTML = GUIDE.map((_, i) => `<span class="${i === guideIdx ? 'on' : ''}"></span>`).join('');
    $('overlay').classList.toggle('guide-reveal', !!s.reveal);
    // NOTE: do NOT hide the spotlight here. The dim mask lives on #guideSpot's box-shadow; hiding it each
    // step made the whole screen flash bright→dark ("blink"). Keep it visible and let CSS transition glide
    // it to the next target (placeSpot only hides when a step genuinely has no on-screen target).
    // open exactly the panel this step needs (settings for panel steps, outline for tab steps), then place the
    // spotlight AFTER the slide-in/scroll settles so the focus box matches the element's real on-screen position.
    if (s.panel) { if (!$('setPanel').classList.contains('show')) { renderSettings(); togglePanel(true); } }
    else if ($('setPanel').classList.contains('show')) togglePanel(false);
    if ((s.open || s.panel) && !isMobile()) { if (s.open) openOutline(true); }
    const at = guideIdx;
    const place = () => {
      if (guideIdx !== at || !$('guide').classList.contains('show')) return;   // step moved on, or guide closed → don't draw a stray spotlight
      const el = root.querySelector(s.hl); if (el && s.panel) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      placeSpot(s.hl);
    };
    // reveal steps (⤓ / ⚙) animate transform over .16s — wait for it (and panel/outline slide-ins) to settle before measuring
    if (s.panel || s.open || s.reveal) setTimeout(place, 280); else requestAnimationFrame(place);
  }
  function maybeAutoGuide() { try { if (!localStorage.getItem('lkir_guided')) setTimeout(() => { if ($('overlay').classList.contains('open') && !$('guide').classList.contains('show')) openGuide(0); }, 1500); } catch { /* */ } }

  $('launch').onclick = () => { const a = currentAid(); if (a) openReader(a); };
  $('close').onclick = closeReader;
  $('scrim').onclick = () => { togglePanel(false); if (isMobile()) openOutline(false); };
  $('t-set').onclick = () => { if ($('setPanel').classList.contains('show')) { togglePanel(false); } else { renderSettings(); togglePanel(true); } };
  $('setClose').onclick = () => togglePanel(false);
  $('t-outline').onclick = toggleOutline;
  $('curChip').onclick = () => { selectOutlineTab('toc'); openOutline(true); };
  $('r-prev').onclick = goPrev; $('r-next').onclick = goNext; $('r-top').onclick = toggleTop;
  $('t-dlCorner').onclick = openDlg;
  $('dlgClose').onclick = closeDlg; $('dl-epub').onclick = () => doExport('epub'); $('dl-txt').onclick = () => doExport('txt'); $('dl-lib').onclick = doSendToLib;
  $('editFloat').onclick = exitMode;
  $('guidePrev').onclick = () => { if (guideIdx > 0) { guideIdx--; showGuideStep(); } };
  $('guideNext').onclick = () => { if (guideIdx < GUIDE.length - 1) { guideIdx++; showGuideStep(); } else closeGuide(); };
  $('guideSkip').onclick = closeGuide;
  // pointer capture → the drag follows the cursor reliably even over the host site's own handlers
  $('minimap').addEventListener('pointerdown', (e) => {
    const mm = $('minimap'), y = e.clientY - mm.getBoundingClientRect().top;
    // flow: the pinned ↑ / ↓ caps jump to the chapter just beyond the loaded window
    if (S.flow && mm._flow) {
      if (S.win.first > 0 && y <= 16) { flowGoto(S.win.first - 1); e.preventDefault(); return; }
      if (S.win.last < S.toc.length - 1 && y >= mm.clientHeight - 16) { flowGoto(S.win.last + 1); e.preventDefault(); return; }
    }
    const indTop = mm._indTop || 0, viewH = mm._viewHmap || 0;
    if (y >= indTop && y <= indTop + viewH) {          // grabbed the viewport box → scrub (cursor stays on the box)
      mmMode = 'scrub'; mmGrab = y - indTop; minimapDragTo(e.clientY);
    } else {                                            // clicked elsewhere (e.g. a thumbnail) → jump to THAT content
      mmMode = 'goto'; mmOff = mm._offset || 0; mmScaleSnap = mm._scale || 1; mmBaseSnap = mm._flow ? (mm._base || 0) : 0; minimapGoTo(e.clientY);
    }
    mmDrag = true; try { mm.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault();
  });
  $('minimap').addEventListener('pointermove', (e) => { if (!mmDrag) return; if (mmMode === 'goto') minimapGoTo(e.clientY); else minimapDragTo(e.clientY); });
  $('minimap').addEventListener('pointerup', (e) => { mmDrag = false; try { $('minimap').releasePointerCapture(e.pointerId); } catch { /* */ } });
  $('minimap').addEventListener('pointercancel', () => { mmDrag = false; });
  window.addEventListener('resize', () => { if (minimapOn()) scheduleMinimap(120); if ($('guide').classList.contains('show')) placeSpot(GUIDE[guideIdx] && GUIDE[guideIdx].hl); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system' && $('overlay').classList.contains('open')) applyTheme(); }); } catch { /* */ }

  let lastScroll = 0, curTick = 0;
  $('scroll').addEventListener('scroll', () => {
    const el = $('scroll'); const top = el.scrollTop; const max = el.scrollHeight - el.clientHeight;
    $('progress').style.width = (max > 0 ? Math.min(100, (top / max) * 100) : 0) + '%';
    lastScroll = top; updateTopBtn();
    if (minimapOn() && !mmRAF) mmRAF = requestAnimationFrame(() => { mmRAF = 0; syncMinimap(); });
    if (S.flow) flowOnScroll();
    if ((S.mode === 'stream' || S.flow) && Date.now() - curTick > 120) { curTick = Date.now(); updateCurrent(S.flow ? true : undefined); }
    scheduleSaveProg();
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (!$('overlay').classList.contains('open')) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'Escape') { if ($('qpop').classList.contains('show')) hideQPop(); else if ($('guide').classList.contains('show')) closeGuide(); else if ($('dlg').classList.contains('show')) closeDlg(); else if (S.mode2 === 'split') exitMode(); else if (S.mode2 === 'bookmark') selectOutlineTab('toc'); else if ($('setPanel').classList.contains('show')) togglePanel(false); else if (isMobile() && $('overlay').classList.contains('ol-on')) openOutline(false); else closeReader(); }
    else if (!$('guide').classList.contains('show') && !$('dlg').classList.contains('show')) {   // don't page the reader behind an open guide/dialog (they capture pointer events but keyboard bubbles to window)
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); } else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    }
  });
  // close the ? help popover on an outside click, when the settings list scrolls, or on resize
  root.addEventListener('pointerdown', (e) => { const p = $('qpop'); if (!p.classList.contains('show')) return; const path = e.composedPath ? e.composedPath() : []; if (path.includes(p)) return; if (e.target && e.target.closest && e.target.closest('.qmark')) return; hideQPop(); }, true);
  $('setBody').addEventListener('scroll', hideQPop, { passive: true });
  window.addEventListener('resize', hideQPop);

  /* ============== per-card 📖 buttons on list pages =============== */
  const currentAid = () => { const m = location.pathname.match(/\/detail\/(\d+)/); return m ? Number(m[1]) : null; };
  function injectCardButtons() {
    const groups = {};
    document.querySelectorAll('a[href^="/detail/"]').forEach((a) => { const m = (a.getAttribute('href') || '').match(/\/detail\/(\d+)/); if (m) (groups[m[1]] = groups[m[1]] || []).push(a); });
    Object.keys(groups).forEach((aid) => {
      const list = groups[aid]; if (list.some((a) => a.__lkir)) return;
      let target = list.find((a) => a.querySelector('img')); if (!target) target = list.slice().sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!target) return; const w = target.clientWidth, h = target.clientHeight; if (w < 40 || h < 16) return;
      target.__lkir = true; if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      const cover = !!target.querySelector('img') || h > 70;
      const btn = document.createElement('div'); btn.textContent = '📖'; btn.title = '沉浸阅读';
      btn.style.cssText = 'position:absolute;right:6px;z-index:50;width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,.95);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;opacity:0;transition:opacity .15s;box-shadow:0 2px 8px rgba(0,0,0,.35);' + (cover ? 'top:6px;' : 'top:50%;transform:translateY(-50%);');
      target.addEventListener('mouseenter', () => (btn.style.opacity = '1')); target.addEventListener('mouseleave', () => (btn.style.opacity = '0'));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openReader(Number(aid)); });
      target.appendChild(btn);
    });
  }
  let injTimer = null; const scheduleInject = () => { clearTimeout(injTimer); injTimer = setTimeout(injectCardButtons, 300); };
  new MutationObserver(scheduleInject).observe(document.documentElement, { childList: true, subtree: true });

  /* ===================== SPA route awareness ====================== */
  let lastPath = '';
  function onRoute() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname; const aid = currentAid();
      $('launch').style.display = aid ? '' : 'none';
      if (aid && settings.autoOpen && !suppressOpen && !$('overlay').classList.contains('open')) openReader(aid);
      if (!aid && $('overlay').classList.contains('open')) closeReader();
    }
    scheduleInject();
  }
  ['pushState', 'replaceState'].forEach((m) => { const orig = history[m]; history[m] = function () { const r = orig.apply(this, arguments); setTimeout(onRoute, 30); return r; }; });
  window.addEventListener('popstate', () => setTimeout(onRoute, 30));
  setInterval(onRoute, 800); onRoute(); injectCardButtons();
})();
