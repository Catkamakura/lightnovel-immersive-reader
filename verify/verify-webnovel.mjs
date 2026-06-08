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
await ev(p, () => { try { localStorage.setItem('lkir_guided', '1'); localStorage.removeItem('lkir_settings'); Object.keys(localStorage).filter((k) => k.startsWith('lkir_bm_')).forEach((k) => localStorage.removeItem(k)); } catch {} });
await p.addScriptTag({ content: GM });
await p.addScriptTag({ content: SCRIPT });
await p.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 8000 });
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click());
await p.waitForFunction(() => { const r = document.getElementById('lkir-host').shadowRoot; const e = r.getElementById('content'); return e && !/加载中/.test(e.textContent) && (e.querySelector('.body') || e.querySelector('.foot')); }, { timeout: 30000 }).catch(() => {});
await sleep(p, 2500);

const base = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot;
  return { series: !!r.querySelector('#content .foot'), blk: r.querySelectorAll('#content .body .blk[data-bi]').length, tabs: [...r.getElementById('outlineTabs').querySelectorAll('button')].map((b) => b.textContent.trim()), chapters: r.getElementById('outlineList').querySelectorAll('.cat-item').length };
});
console.log('  base:', JSON.stringify(base));
check('web novel = series (paged) rendering .blk spans', base.series && base.blk > 0, 'blk=' + base.blk + ' chapters=' + base.chapters);
check('书签 tab present in series', base.tabs.some((t) => t.includes('书签')));

// enter bookmark mode, bookmark a paragraph in ch1
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); t.click(); });
await sleep(p, 450);
const marking = await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.contains('marking'));
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const blk = r.querySelector('#content .body .blk[data-bi]'); if (blk) blk.click(); });
await sleep(p, 600);
const bm1 = await ev(p, () => ({ items: document.getElementById('lkir-host').shadowRoot.querySelectorAll('.bm-item').length, marks: document.getElementById('lkir-host').shadowRoot.querySelectorAll('#content .body .blk.bm').length }));
console.log('  bm1:', JSON.stringify(bm1), 'marking=' + marking);
check('series bookmark added to current chapter', marking && bm1.items >= 1 && bm1.marks >= 1);

// switch to a DIFFERENT chapter via the 目录 list → its bookmarks must be its own (ch1 hidden)
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.dataset.t === 'toc'); t.click(); });
await sleep(p, 400);
const sw = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot;
  const items = [...r.getElementById('outlineList').querySelectorAll('.cat-item')];
  const cur = items.findIndex((x) => x.classList.contains('active'));
  const before = (r.querySelector('#content h1') || {}).textContent || '';
  const target = items.find((x, i) => i !== (cur < 0 ? 0 : cur));
  if (target) target.click();
  return new Promise((res) => setTimeout(() => res({ before, after: (r.querySelector('#content h1') || {}).textContent || '' }), 2600));
});
await ev(p, () => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); t.click(); });
await sleep(p, 600);
const ch2 = await ev(p, () => ({ items: document.getElementById('lkir-host').shadowRoot.querySelectorAll('.bm-item').length, marks: document.getElementById('lkir-host').shadowRoot.querySelectorAll('#content .body .blk.bm').length }));
console.log('  ch2:', JSON.stringify(ch2), 'changed=' + (sw.before !== sw.after));
check('a different chapter shows only its own bookmarks (per-chapter)', sw.before !== sw.after && ch2.items === 0 && ch2.marks === 0);

// minimap in series
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 300);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('s-minimap').click());
await sleep(p, 700);
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click());
await sleep(p, 300);
const mm = await ev(p, () => ({ on: document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.contains('mm-on'), cw: document.getElementById('lkir-host').shadowRoot.getElementById('mmCanvas').width }));
check('minimap works in series (current chapter only)', mm.on && mm.cw > 0, 'cw=' + mm.cw);

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
