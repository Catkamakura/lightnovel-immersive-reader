import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const SCRIPT = readFileSync('./lightnovel-immersive-reader.user.js', 'utf-8');
const GM = `window.GM_xmlhttpRequest=function(o){fetch(o.url).then(r=>r.arrayBuffer()).then(b=>o.onload&&o.onload({status:200,response:b,responseHeaders:''})).catch(e=>o.onerror&&o.onerror(e));};`;
const results = [];
const check = (n, c, e = '') => { results.push({ n, ok: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  — ' + e : ''}`); };
const ev = (p, f, ...a) => p.evaluate(f, ...a);
const sleep = (p, ms) => p.waitForTimeout(ms);

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1380, height: 900 }, locale: 'zh-CN' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const AID = '1144698';

await p.goto('https://www.lightnovel.fun/detail/' + AID, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(p, 2200);
await ev(p, () => { try { localStorage.setItem('lkir_guided', '1'); localStorage.removeItem('lkir_settings'); localStorage.removeItem('lir_progress'); Object.keys(localStorage).filter((k) => k.startsWith('lkir_bm_')).forEach((k) => localStorage.removeItem(k)); } catch {} });
await p.addScriptTag({ content: GM });
await p.addScriptTag({ content: SCRIPT });
await p.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 8000 });
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click());
await p.waitForFunction(() => { const r = document.getElementById('lkir-host').shadowRoot; const e = r.getElementById('content'); return e && !/加载中/.test(e.textContent) && (e.querySelector('.body') || e.querySelector('.foot')); }, { timeout: 30000 }).catch(() => {});
await sleep(p, 2500);

const ciSet = () => ev(p, () => [...document.getElementById('lkir-host').shadowRoot.querySelectorAll('#flow .chap[data-ci]')].map((e) => +e.dataset.ci));
const toCh0 = async () => { await ev(p, () => { const it = document.getElementById('lkir-host').shadowRoot.querySelector('#outlineList .cat-item[data-i="0"]'); if (it) it.click(); }); await sleep(p, 1600); };
// scroll so the viewport bottom sits just above the LOADED window's bottom edge (inside the append pad;
// the absolute document bottom would be deep inside the unloaded-spacer void and trigger a far-jump rebuild)
const scrollBottom = async (n) => { for (let k = 0; k < n; k++) { await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const sc = r.getElementById('scroll'); const secs = [...r.querySelectorAll('#flow .chap[data-ci]')]; const last = secs[secs.length - 1]; if (!last) return; const bot = last.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + last.offsetHeight; sc.scrollTop = Math.max(0, bot - sc.clientHeight - 100); sc.dispatchEvent(new Event('scroll')); }); await sleep(p, 550); } };

const base = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot;
  return { flow: !!r.querySelector('#content #flow'), chaps: r.querySelectorAll('#flow .chap[data-ci]').length, chunks: r.querySelectorAll('#flow .chunk').length, blk: r.querySelectorAll('#content .body .blk[data-bi]').length, tabs: [...r.getElementById('outlineTabs').querySelectorAll('button')].map((b) => b.textContent.trim()), chapters: r.getElementById('outlineList').querySelectorAll('.cat-item').length };
});
console.log('  base:', JSON.stringify(base));
check('web novel = seamless flow (stacked .chap sections of lazy .chunk wrappers)', base.flow && base.chaps >= 1 && base.chunks >= 1 && base.blk > 0, 'chaps=' + base.chaps + ' chunks=' + base.chunks + ' blk=' + base.blk + ' chapters=' + base.chapters);
check('书签 tab present in series', base.tabs.some((t) => t.includes('书签')));

// jump to chapter 0, then verify FORWARD auto-load on scroll (prefetch keeps pace; window stays bounded)
await toCh0();
const beforeFwd = await ciSet();
await scrollBottom(8);
const afterFwd = await ciSet();
console.log('  fwd:', JSON.stringify(beforeFwd), '->', JSON.stringify(afterFwd));
check('scrolling down auto-loads later chapters (prefetch keeps pace); window stays bounded', Math.max(...afterFwd) >= Math.max(...beforeFwd) + 2 && afterFwd.length <= 13, 'beforeMax=' + Math.max(...beforeFwd) + ' afterMax=' + Math.max(...afterFwd) + ' win=' + afterFwd.length);

// far-jump to the LAST chapter via the outline (window rebuilds there), then scroll UP to the window's
// top edge → the previous chapter prepends (v1 only prepended near absolute scrollTop 0 — broken after any jump)
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const items = [...r.getElementById('outlineList').querySelectorAll('.cat-item')]; items[items.length - 1].click(); });
await sleep(p, 2200);
const beforeUp = await ciSet();
// scroll DOWN a little first (edge loading is direction-gated), then UP to the window's top edge
await ev(p, () => { const sc = document.getElementById('lkir-host').shadowRoot.getElementById('scroll'); sc.scrollTop = sc.scrollTop + 400; sc.dispatchEvent(new Event('scroll')); });
await sleep(p, 300);
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const sc = r.getElementById('scroll'); const first = r.querySelector('#flow .chap[data-ci]'); const top = first.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop; sc.scrollTop = top + 60; sc.dispatchEvent(new Event('scroll')); });
await sleep(p, 1400);
const afterUp = await ciSet();
console.log('  up:', JSON.stringify(beforeUp), '->', JSON.stringify(afterUp));
check('scrolling up at the window edge prepends the previous chapter', Math.min(...beforeUp) > 0 && Math.min(...afterUp) < Math.min(...beforeUp), 'beforeMin=' + Math.min(...beforeUp) + ' afterMin=' + Math.min(...afterUp));

// leap deep into spacer territory with the native scrollbar (to ~10% of the book, far above the window)
// → the window rebuilds around the landing chapter
await ev(p, () => { const sc = document.getElementById('lkir-host').shadowRoot.getElementById('scroll'); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.1; sc.dispatchEvent(new Event('scroll')); });
await sleep(p, 2600);
const leap = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot, sc = r.getElementById('scroll');
  const secs = [...r.querySelectorAll('#flow .chap[data-ci]')];
  const mid = sc.scrollTop + sc.clientHeight / 2;
  const onScreen = secs.some((s) => { const t = s.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop; return t <= mid && t + s.offsetHeight >= mid; });
  return { cis: secs.map((s) => +s.dataset.ci), onScreen, total: r.getElementById('outlineList').querySelectorAll('.cat-item').length };
});
console.log('  leap:', JSON.stringify(leap));
check('a native-scrollbar leap into unloaded territory rebuilds the window there', leap.onScreen && Math.max(...leap.cis) < Math.min(...afterUp), 'cis=' + JSON.stringify(leap.cis) + ' totalCh=' + leap.total);

// back to chapter 0; bookmark a paragraph there (per-chapter via data-ci)
await toCh0();
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); t.click(); });
await sleep(p, 500);
const marking = await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.contains('marking'));
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const blk = r.querySelector('#flow .chap[data-ci="0"] .blk[data-bi]'); if (blk) blk.click(); });
await sleep(p, 600);
const bm1 = await ev(p, () => ({ items: document.getElementById('lkir-host').shadowRoot.querySelectorAll('.bm-item').length, marks: document.getElementById('lkir-host').shadowRoot.querySelectorAll('#flow .chap[data-ci="0"] .blk.bm').length }));
console.log('  bm1:', JSON.stringify(bm1), 'marking=' + marking);
check('seamless bookmark added to the active chapter (per-chapter, data-ci)', marking && bm1.items >= 1 && bm1.marks >= 1);

// switch to a far DIFFERENT chapter → it shows only its own (empty) bookmarks
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.dataset.t === 'toc'); t.click(); });
await sleep(p, 300);
const tIdx = await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const items = [...r.getElementById('outlineList').querySelectorAll('.cat-item')]; const last = items[items.length - 1]; last.click(); return last.dataset.i; });
await sleep(p, 2400);
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); t.click(); });
await sleep(p, 600);
const ch2 = await ev(p, (ti) => { const r = document.getElementById('lkir-host').shadowRoot; return { switched: !!r.querySelector('#flow .chap[data-ci="' + ti + '"]') && !r.querySelector('#flow .chap[data-ci="0"]'), items: r.querySelectorAll('.bm-item').length, marks: r.querySelectorAll('#flow .chap[data-ci="' + ti + '"] .blk.bm').length }; }, tIdx);
console.log('  ch2:', JSON.stringify(ch2), 'want=' + tIdx);
check('a different chapter shows only its own (empty) bookmarks (per-chapter)', ch2.switched && ch2.items === 0 && ch2.marks === 0);

// minimap in the seamless flow (windowed map + ↑ cap, since we're on the last chapter)
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 300);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('s-minimap').click());
await sleep(p, 700);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 300);
const mm = await ev(p, () => ({ on: document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.contains('mm-on'), cw: document.getElementById('lkir-host').shadowRoot.getElementById('mmCanvas').width }));
check('minimap works in the seamless flow', mm.on && mm.cw > 0, 'cw=' + mm.cw);

// the cur-chip carries the book-wide readout "· 第 i / N 章 · ~B%"
const chip = await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('curChip').textContent);
console.log('  chip:', JSON.stringify(chip));
check('current chip shows the Ch i / N · ~% readout', /·/.test(chip) && /%/.test(chip), chip);

// seamless toggle: OFF -> paged (.foot returns, #flow gone), ON -> flow again
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 300);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('s-seamless').click());
await sleep(p, 1500);
const paged = await ev(p, () => ({ foot: !!document.getElementById('lkir-host').shadowRoot.querySelector('#content .foot'), flow: !!document.getElementById('lkir-host').shadowRoot.querySelector('#flow') }));
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('s-seamless').click());
await sleep(p, 1500);
const flowBack = await ev(p, () => !!document.getElementById('lkir-host').shadowRoot.querySelector('#flow'));
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 250);
console.log('  toggle:', JSON.stringify(paged), 'flowBack=' + flowBack);
check('seamless toggle: off -> paged (.foot), on -> flow', paged.foot && !paged.flow && flowBack);

// download range selector — list-based picker (click a start chapter, then an end chapter; default = ALL)
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-dlCorner').click());
await sleep(p, 300);
const rng = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot;
  const shown = getComputedStyle(r.getElementById('dlRange')).display !== 'none';
  const items = [...r.getElementById('dlList').querySelectorAll('.dl-ch')];
  const N = items.length;
  const from = r.getElementById('dlFrom'), to = r.getElementById('dlTo');
  const endsAt = () => items.filter((b) => b.classList.contains('end1')).map((b) => Number(b.dataset.i));
  const insideAt = () => items.filter((b) => b.classList.contains('in')).map((b) => Number(b.dataset.i));
  const setRange = (f, t2) => { from.value = String(f); to.value = String(t2); to.dispatchEvent(new Event('change', { bubbles: true })); };   // commit via change (authoritative, focus-independent)
  const inputType = from.type, defFrom = from.value, defTo = to.value, endsDefault = endsAt();   // default = whole book
  const labelled = items[0].querySelector('.ttl').textContent.trim().length > 0;
  items[1] && items[1].click();                                  // list: pick start = chapter 2
  const tipMid = r.getElementById('dlRngTip').textContent.trim();
  items[3] && items[3].click();                                  // list: pick end = chapter 4
  const ends = endsAt(), inside = insideAt(), countSel = r.getElementById('dlRngCount').textContent.trim();
  const inFrom = from.value, inTo = to.value;                    // list click -> inputs synced (2 / 4)
  setRange(5, 9);                                                // inputs -> list (range 5..9 => idx 4..8)
  const endsTyped = endsAt(), countTyped = r.getElementById('dlRngCount').textContent.trim();
  r.getElementById('dlRngAll').click(); setRange(99999, 99999);  // overshoot clamps to N
  const clampFrom = from.value, endsClamp = endsAt();
  r.getElementById('dlRngAll').click();                          // 整本 resets to whole book
  return { shown, N, labelled, inputType, defFrom, defTo, endsDefault, tipMid, ends, inside, countSel, inFrom, inTo, endsTyped, countTyped, clampFrom, endsClamp, endsAll: endsAt(), allFrom: from.value, allTo: to.value };
});
console.log('  rng:', JSON.stringify(rng));
check('download range = list + synced number inputs (default ALL; list<->inputs; clamp; 整本 resets)',
  rng.shown && rng.N > 9 && rng.labelled
  && rng.inputType === 'number' && rng.defFrom === '1' && rng.defTo === String(rng.N)
  && JSON.stringify(rng.endsDefault) === JSON.stringify([0, rng.N - 1])
  && rng.tipMid.length > 0
  && JSON.stringify(rng.ends) === JSON.stringify([1, 3]) && JSON.stringify(rng.inside) === JSON.stringify([2]) && rng.countSel.indexOf('3 /') === 0
  && rng.inFrom === '2' && rng.inTo === '4'
  && JSON.stringify(rng.endsTyped) === JSON.stringify([4, 8]) && rng.countTyped.indexOf('5 /') === 0
  && rng.clampFrom === String(rng.N) && JSON.stringify(rng.endsClamp) === JSON.stringify([rng.N - 1])
  && JSON.stringify(rng.endsAll) === JSON.stringify([0, rng.N - 1]) && rng.allFrom === '1' && rng.allTo === String(rng.N), JSON.stringify(rng));

// guide: the Skip button must respond to a REAL mouse click (a programmatic .click()
// bypasses hit-testing and hid a bug where .guide-step's opacity stacking context ate the click).
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; r.getElementById('dlgClose').click(); r.getElementById('t-set').click(); });
await sleep(p, 250);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('s-guide').click());
await sleep(p, 450);
const gOpen = await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('guide').classList.contains('show'));
const sb = await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot.getElementById('guideSkip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const hitId = await ev(p, (b) => { const t = document.getElementById('lkir-host').shadowRoot.elementFromPoint(b.x, b.y); return t && (t.id || t.className); }, sb);
await p.mouse.click(sb.x, sb.y);
await sleep(p, 350);
const gClosed = await ev(p, () => !document.getElementById('lkir-host').shadowRoot.getElementById('guide').classList.contains('show'));
console.log('  guide skip: opened=' + gOpen + ' hitAtSkip=' + hitId + ' closedByRealClick=' + gClosed);
check('guide Skip closes the guide on a real mouse click (not eaten by .guide-step)', gOpen && hitId === 'guideSkip' && gClosed);

console.log('\nerrors:', errors.length); errors.slice(0, 5).forEach((e) => console.log('  ' + e));
const passed = results.filter((r) => r.ok).length;
console.log(`\n==== ${passed}/${results.length} checks passed ====`);
await b.close();
process.exit(passed === results.length && errors.length === 0 ? 0 : 1);
