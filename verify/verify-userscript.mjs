// Verifies the v1.7 reader (lightnovel-immersive-reader.user.js) against the live site.
// Run: node _verify_userscript.mjs   (uses Playwright from web/node_modules)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const SCRIPT = readFileSync('./lightnovel-immersive-reader.user.js', 'utf-8');
const OUT = './_shots_userscript';
mkdirSync(OUT, { recursive: true });
const GM_SHIM = `window.GM_xmlhttpRequest = function(o){ fetch(o.url).then(r=>r.arrayBuffer()).then(b=>{ o.onload && o.onload({ status:200, response:b, responseHeaders:'' }); }).catch(e=>{ o.onerror && o.onerror(e); }); };`;

const results = [];
const check = (name, cond, extra = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const ev = (page, fn) => page.evaluate(fn);

async function freshInject(page, url, { suppressGuide = true } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2300);
  await page.evaluate((sg) => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('lkir_bm_') || k.startsWith('lkir_split_')).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem('lkir_settings');
      if (sg) localStorage.setItem('lkir_guided', '1'); else localStorage.removeItem('lkir_guided');
    } catch {}
  }, suppressGuide);
  await page.addScriptTag({ content: GM_SHIM });
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 8000 });
}
async function openReaderAndWait(page) {
  await page.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click());
  await page.waitForFunction(() => {
    const r = document.getElementById('lkir-host').shadowRoot; const c = r.getElementById('content');
    return c && !/加载中/.test(c.textContent) && c.querySelector('.body');
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1100);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  /* ===== A: layout + interactions on a stream multi-volume book ===== */
  await freshInject(page, 'https://www.lightnovel.fun/detail/1144661');
  await openReaderAndWait(page);
  const L = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; const q = (s) => r.querySelector(s); const cs = (el) => el ? getComputedStyle(el) : null;
    const outline = r.getElementById('outline'); const close = r.getElementById('close'); const cll = r.getElementById('clLeft');
    const exitR = close.getBoundingClientRect(); const dlc = r.getElementById('t-dlCorner');
    return {
      noBar: !q('.bar'), noEditBar: !q('.edit-bar'), noRightCluster: !r.getElementById('clRight'),
      leftBtns: [...cll.querySelectorAll('.cbtn')].map((b) => b.id),
      menuIsSvg: !!r.getElementById('t-outline').querySelector('svg'), vw: window.innerWidth,
      closeIsExit: close.classList.contains('exit-btn'), exitBottomRight: exitR.left > innerWidth * 0.6 && exitR.top > innerHeight * 0.6,
      outlinePos: cs(outline).position, outlineShadow: cs(outline).boxShadow,
      titleTxt: r.getElementById('outlineTitle').textContent.trim(), titlePadTop: parseFloat(cs(r.getElementById('outlineTitle')).paddingTop),
      noInPanelDl: !r.getElementById('t-dl'), dlCornerShown: dlc ? cs(dlc).display !== 'none' : false,
      setIcon: r.getElementById('t-set').textContent.trim(),
    };
  });
  console.log('  L:', JSON.stringify(L));
  check('A: no top bar / no floating edit-bar', L.noBar && L.noEditBar);
  check('A: left cluster = [▤menu, ⤓download, ⚙settings]', JSON.stringify(L.leftBtns) === JSON.stringify(['t-outline', 't-dlCorner', 't-set']), JSON.stringify(L.leftBtns));
  check('A: no top-right cluster (settings moved left)', L.noRightCluster);
  check('A: menu icon is an SVG (3-line)', L.menuIsSvg);
  check('A: exit = bottom-right pill', L.closeIsExit && L.exitBottomRight);
  check('A: outline absolute + base-canvas (no shadow)', L.outlinePos === 'absolute' && L.outlineShadow === 'none');
  check('A: book title shown', L.titleTxt.length > 0 && !/&amp;|&lt;/.test(L.titleTxt), L.titleTxt);
  check('A: title has breathing room (padding-top >= 10)', L.titlePadTop >= 10, 'pt=' + L.titlePadTop);
  check('A: in-panel ⤓ removed; corner ⤓ present & enabled', L.noInPanelDl && L.dlCornerShown);
  check('A: settings icon starts as gear', L.setIcon === '⚙');

  const clX = () => ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('content').getBoundingClientRect().left);
  await ev(page, () => { const r = document.getElementById('lkir-host').shadowRoot; if (!r.getElementById('overlay').classList.contains('ol-on')) r.getElementById('t-outline').click(); });
  await page.waitForTimeout(360); const openL = await clX();
  await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-outline').click());
  await page.waitForTimeout(360); const closedL = await clX();
  check('A: toggling outline does NOT move content', Math.abs(openL - closedL) < 1.5, `open=${openL} closed=${closedL}`);
  await ev(page, () => { const r = document.getElementById('lkir-host').shadowRoot; if (!r.getElementById('overlay').classList.contains('ol-on')) r.getElementById('t-outline').click(); });
  await page.waitForTimeout(250); await page.screenshot({ path: OUT + '/A1-open.png' });

  // split lives in the 目录 tab
  const split = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.querySelector('#outlineTabs [data-t="toc"]').click();
    return new Promise((res) => setTimeout(() => res({ tabs: [...r.getElementById('outlineTabs').querySelectorAll('button')].length, hasDone: !!r.querySelector('#outlineTabs [data-act="done"]'), hasReset: !!r.querySelector('#outlineTabs [data-act="reset"]'), splitting: r.getElementById('overlay').classList.contains('splitting') }), 450));
  });
  check('A: active 目录 → split (完成+重置, 2 tabs)', split.hasDone && split.hasReset && split.tabs === 2 && split.splitting);
  await page.screenshot({ path: OUT + '/A2-split-mode.png' });
  const afterDone = await ev(page, () => { const r = document.getElementById('lkir-host').shadowRoot; r.querySelector('#outlineTabs [data-act="done"]').click(); return new Promise((res) => setTimeout(() => res({ tocBack: !!r.querySelector('#outlineTabs [data-t="toc"]'), splitting: r.getElementById('overlay').classList.contains('splitting') }), 380)); });
  check('A: 完成 returns to normal tabs', afterDone.tocBack && !afterDone.splitting);

  // bookmarks grouped + delete confirm
  const bm = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.querySelector('#outlineTabs [data-t="bm"]').click();
    return new Promise((res) => setTimeout(() => { const blk = r.querySelector('.body .blk[data-bi]'); if (blk) blk.click(); setTimeout(() => res({ marking: r.getElementById('overlay').classList.contains('marking'), grp: r.querySelectorAll('.bm-grp-h').length, item: r.querySelectorAll('.bm-item').length, noPill: !r.querySelector('.edit-bar') }), 500); }, 450));
  });
  check('A: 书签 marking on (no pill) + grouped by chapter', bm.marking && bm.noPill && bm.grp >= 1 && bm.item >= 1, `grp=${bm.grp} item=${bm.item}`);
  await page.screenshot({ path: OUT + '/A3-bookmarks-grouped.png' });
  const del = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; const aid = location.pathname.match(/\/detail\/(\d+)/)[1];
    const before = JSON.parse(localStorage.getItem('lkir_bm_' + aid) || '[]').length; r.querySelector('.bm-item .bm-del').click();
    return new Promise((res) => setTimeout(() => { const cShown = !!r.querySelector('.bm-del.confirm'); const mid = JSON.parse(localStorage.getItem('lkir_bm_' + aid) || '[]').length; r.querySelector('.bm-del.confirm').click(); setTimeout(() => res({ before, cShown, mid, after: JSON.parse(localStorage.getItem('lkir_bm_' + aid) || '[]').length }), 350); }, 300));
  });
  check('A: delete = hover + 2-click confirm', del.before === 1 && del.cShown && del.mid === 1 && del.after === 0);

  // settings toggle
  const setTog = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; const t = r.getElementById('t-set'); t.click();
    return new Promise((res) => setTimeout(() => { const open = r.getElementById('setPanel').classList.contains('show'); const ico = t.textContent.trim(); t.click(); setTimeout(() => res({ open, ico, closed: !r.getElementById('setPanel').classList.contains('show'), ico2: t.textContent.trim() }), 280); }, 280));
  });
  check('A: ⚙ ↔ ✕ settings toggle', setTog.open && setTog.ico === '✕' && setTog.closed && setTog.ico2 === '⚙');

  // theme: system default + 自定义 colour input
  const theme = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.getElementById('t-set').click();
    return new Promise((res) => setTimeout(() => {
      const sws = [...r.querySelectorAll('#sw .sw')].map((b) => b.dataset.k);
      const a = r.querySelector('#sw .sw.active'); const activeBefore = a ? a.dataset.k : null;
      const customHiddenBefore = getComputedStyle(r.getElementById('customRow')).display === 'none';
      r.querySelector('#sw .sw[data-k="custom"]').click();
      setTimeout(() => {
        const customShown = getComputedStyle(r.getElementById('customRow')).display !== 'none';
        const ci = r.getElementById('s-custom'); ci.value = '#aa4a44'; ci.dispatchEvent(new Event('input', { bubbles: true }));
        const bg = getComputedStyle(r.getElementById('overlay')).getPropertyValue('--ir-bg').trim();
        r.getElementById('t-set').click();
        res({ sws, activeBefore, customHiddenBefore, customShown, bg });
      }, 250);
    }, 250));
  });
  console.log('  theme:', JSON.stringify(theme));
  check('A: swatches = 跟随系统/纸白/护眼/夜间/自定义, default=system', JSON.stringify(theme.sws) === JSON.stringify(['system', 'paper', 'sepia', 'dark', 'custom']) && theme.activeBefore === 'system');
  check('A: 自定义 reveals hex input + applies the colour', theme.customHiddenBefore && theme.customShown && /aa4a44/i.test(theme.bg.replace('#', '')), `bg=${theme.bg}`);

  /* ===== D: no-edit-hover, minimap, guide ===== */
  // (still on the same page) — no-edit-hover: switch bm→toc, toc tab armed, cleared on mouseleave
  const neh = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.querySelector('#outlineTabs [data-t="bm"]').click();
    return new Promise((res) => setTimeout(() => { r.querySelector('#outlineTabs [data-t="toc"]').click(); setTimeout(() => { const toc = r.querySelector('#outlineTabs [data-t="toc"]'); const had = toc.classList.contains('no-edit-hover'); toc.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); res({ had, after: toc.classList.contains('no-edit-hover') }); }, 300); }, 300));
  });
  check('D: 目录 not instantly editable after click (cleared on mouseleave)', neh.had && !neh.after, JSON.stringify(neh));

  // minimap: enable via settings → canvas builds; grabbable box; rail clears it
  const mm = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.getElementById('t-set').click();
    return new Promise((res) => setTimeout(() => {
      r.getElementById('s-minimap').click(); // enable
      setTimeout(() => {
        r.getElementById('t-set').click(); // close settings
        const mmEl = r.getElementById('minimap'); const sc = r.getElementById('scroll'); const rect = mmEl.getBoundingClientRect();
        res({
          shown: getComputedStyle(mmEl).display !== 'none', mmOn: r.getElementById('overlay').classList.contains('mm-on'),
          canvasW: r.getElementById('mmCanvas').width, viewH: parseFloat(getComputedStyle(r.getElementById('mmView')).height),
          railR: r.getElementById('rail').getBoundingClientRect().right, mmL: rect.left,
          sbHidden: getComputedStyle(sc).scrollbarWidth === 'none', mmRight: mmEl.style.right,
          cx: rect.left + rect.width / 2, top: rect.top, h: rect.height, maxScroll: sc.scrollHeight - sc.clientHeight,
        });
      }, 600);
    }, 350));
  });
  console.log('  mm:', JSON.stringify(mm));
  check('D: minimap builds (canvas + grabbable view box)', mm.shown && mm.mmOn && mm.canvasW > 0 && mm.viewH >= 14, `viewH=${mm.viewH}`);
  check('D: minimap clears the rail (no overlap)', mm.railR <= mm.mmL + 1, `railR=${mm.railR} mmLeft=${mm.mmL}`);
  check('D: native scrollbar KEPT (not hidden); minimap offset left of it', !mm.sbHidden && mm.mmRight !== '', `sbHidden=${mm.sbHidden} mmRight=${mm.mmRight}`);
  // drag: grab the box near the top, move the pointer to 80% down → scroll follows the cursor.
  // (PointerEvents dispatched on the element exercise the real pointerdown/move/up handlers.)
  const drag = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; const m = r.getElementById('minimap'); const sc = r.getElementById('scroll');
    const rect = m.getBoundingClientRect(); const x = rect.left + rect.width / 2;
    const pe = (t, y) => new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true });
    m.dispatchEvent(pe('pointerdown', rect.top + 10));
    const half = sc.scrollTop;                                   // mid-drag at top
    m.dispatchEvent(pe('pointermove', rect.top + rect.height * 0.8));
    const moved = sc.scrollTop;                                  // after moving to 80%
    m.dispatchEvent(pe('pointerup', rect.top + rect.height * 0.8));
    return { half, moved, max: sc.scrollHeight - sc.clientHeight };
  });
  console.log('  drag:', JSON.stringify(drag));
  const frac = drag.max > 0 ? drag.moved / drag.max : 0;
  check('D: dragging the minimap follows the mouse', frac > 0.5, `frac=${frac.toFixed(2)} scroll=${drag.moved}/${drag.max}`);
  await page.screenshot({ path: OUT + '/D1-minimap.png' });

  // guide: open from settings, step through, finish
  const guide = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; r.getElementById('t-set').click();
    return new Promise((res) => setTimeout(() => {
      r.getElementById('s-guide').click(); // open guide (closes settings)
      setTimeout(() => {
        const shown = r.getElementById('guide').classList.contains('show');
        const dots = r.getElementById('guideDots').children.length;
        const t1 = r.getElementById('guideTitle').textContent.trim();
        const sp = r.getElementById('guideSpot'); const spotShown = getComputedStyle(sp).display !== 'none'; const spotW = sp.getBoundingClientRect().width;
        const spotShadow = getComputedStyle(sp).boxShadow;
        r.getElementById('guideNext').click(); r.getElementById('guideNext').click();
        setTimeout(() => {
          const stepTxt = r.getElementById('guideStep').textContent.trim();
          const hl = !!r.querySelector('.guide-hl');
          // jump to last and finish
          for (let i = 0; i < dots; i++) r.getElementById('guideNext').click();
          setTimeout(() => res({ shown, dots, t1, spotShown, spotW, spotShadow, stepTxt, hl, closed: !r.getElementById('guide').classList.contains('show'), spotHidden: getComputedStyle(r.getElementById('guideSpot')).display === 'none', guided: localStorage.getItem('lkir_guided') }), 250);
        }, 450);
      }, 250);
    }, 300));
  });
  console.log('  guide:', JSON.stringify(guide));
  check('D: guide opens from settings (stepped, with dots)', guide.shown && guide.dots === 7 && guide.t1.length > 0);
  check('D: guide spotlight dims around the focus (hole + shadow)', guide.spotShown && guide.spotW > 0 && /9999px|rgba/.test(guide.spotShadow), `w=${guide.spotW}`);
  check('D: guide advances + highlights a control', /^3 \//.test(guide.stepTxt) && guide.hl);
  check('D: finishing closes guide + spotlight + marks seen', guide.closed && guide.spotHidden && guide.guided === '1');
  await page.screenshot({ path: OUT + '/D2-guide.png' });

  // auto-guide on first ever open
  const auto = await ev(page, () => {
    const r = document.getElementById('lkir-host').shadowRoot; localStorage.removeItem('lkir_guided');
    r.getElementById('close').click();
    return new Promise((res) => { setTimeout(() => { r.getElementById('launch').click(); setTimeout(() => res({ showing: r.getElementById('guide').classList.contains('show') }), 1900); }, 400); });
  });
  check('D: guide auto-opens on first use', auto.showing);

  /* ===== B: 分卷 switch + URL sync on exit (fresh) ===== */
  await freshInject(page, 'https://www.lightnovel.fun/detail/1144661');
  await openReaderAndWait(page);
  const sw = await ev(page, async () => {
    const r = document.getElementById('lkir-host').shadowRoot; const vol = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((b) => b.textContent.includes('分卷'));
    if (!vol) return { hasVol: false }; vol.click(); await new Promise((res) => setTimeout(res, 300));
    const items = [...r.getElementById('outlineList').querySelectorAll('.cat-item')]; const cur = items.findIndex((b) => b.classList.contains('active'));
    const target = items.find((b, i) => i !== cur); const targetAid = target && target.getAttribute('data-aid'); target && target.click(); return { hasVol: true, targetAid };
  });
  if (sw.hasVol && sw.targetAid) {
    await page.waitForFunction(() => { const r = document.getElementById('lkir-host').shadowRoot; const c = r.getElementById('content'); return c && !/加载中/.test(c.textContent) && c.querySelector('.body'); }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(900);
    await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('close').click());
    await page.waitForTimeout(2500);
    check('B: after exit, site URL = switched volume', page.url().includes('/detail/' + sw.targetAid), page.url());
  } else check('B: 分卷 present', sw.hasVol);

  /* ===== C: big single article ===== */
  await freshInject(page, 'https://www.lightnovel.fun/detail/1144697');
  await openReaderAndWait(page);
  const C = await ev(page, () => { const r = document.getElementById('lkir-host').shadowRoot; const dlc = r.getElementById('t-dlCorner'); return { dl: getComputedStyle(dlc).display !== 'none', cat: r.getElementById('outlineList').querySelectorAll('.cat-item').length, title: r.getElementById('outlineTitle').textContent.trim() }; });
  check('C: download available for big book', C.dl);
  check('C: chapterized 目录 (>1)', C.cat > 1, 'cat=' + C.cat);
  check('C: title present', C.title.length > 0);

  console.log('\nConsole/page errors:', errors.length); errors.slice(0, 12).forEach((e) => console.log('  ' + e));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ${passed}/${results.length} checks passed ====`);
  await browser.close();
  process.exit(passed === results.length && errors.length === 0 ? 0 : 1);
}
run().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
