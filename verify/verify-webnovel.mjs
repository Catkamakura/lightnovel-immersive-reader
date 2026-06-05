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

// download range selector
await ev(p, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-dlCorner').click());
await sleep(p, 300);
const rng = await ev(p, () => {
  const r = document.getElementById('lkir-host').shadowRoot;
  const from = r.getElementById('dlFrom'), to = r.getElementById('dlTo');
  const N = Number(to.max);
  // exercise validation: push 'from' way past the max, commit -> must clamp to N
  from.value = '99999'; from.dispatchEvent(new Event('input', { bubbles: true })); from.dispatchEvent(new Event('change', { bubbles: true }));
  const clampedFrom = from.value;
  from.value = '1'; from.dispatchEvent(new Event('change', { bubbles: true }));   // restore default-all
  return { shown: getComputedStyle(r.getElementById('dlRange')).display !== 'none', type: from.type, N, fromVal: from.value, toVal: to.value, clampedFrom, fromName: r.getElementById('dlFromName').textContent, toName: r.getElementById('dlToName').textContent };
});
console.log('  rng:', JSON.stringify(rng));
check('download shows a numeric chapter range (default = ALL, named ends, clamps invalid input)', rng.shown && rng.type === 'number' && rng.N > 1 && rng.fromVal === '1' && rng.toVal === String(rng.N) && rng.clampedFrom === String(rng.N) && rng.fromName.length > 1 && rng.toName.length > 1);

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
