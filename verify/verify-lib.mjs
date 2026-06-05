// End-to-end test of the reader ↔ calibre-bridge flow. Requires the bridge running on :8788.
// GM_xmlhttpRequest is privileged (no CORS/PNA/mixed-content); a page-context fetch can't reach
// http://127.0.0.1 from the https site, so we route the shim through Node (page.exposeFunction),
// which faithfully simulates GM_xmlhttpRequest's bypass.
import { chromium } from 'playwright';
import { readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';

const SCRIPT = readFileSync('./lightnovel-immersive-reader.user.js', 'utf-8');
const BRIDGE = 'http://127.0.0.1:8788';
const GM = `
function _b64(u8){ let s=''; const C=0x8000; for(let i=0;i<u8.length;i+=C){ s+=String.fromCharCode.apply(null,u8.subarray(i,i+C)); } return btoa(s); }
window.GM_xmlhttpRequest = async function(o){
  try {
    const req = { method:o.method||'GET', url:o.url, headers:o.headers||{}, arraybuffer:o.responseType==='arraybuffer' };
    if (o.data instanceof FormData){ const form=[]; for (const [k,v] of o.data.entries()){ if (v instanceof Blob){ const ab=await v.arrayBuffer(); form.push([k,{__blob:1,b64:_b64(new Uint8Array(ab)),name:v.name||'file',type:v.type||''}]); } else form.push([k,v]); } req.form=form; }
    else if (o.data!==undefined) req.body=o.data;
    const res = await window.__bridgeFetch(req);
    if (res.status===0){ o.onerror && o.onerror(new Error(res.error||'network')); return; }
    if (req.arraybuffer){ const bin=atob(res.b64||''); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); o.onload && o.onload({status:res.status,response:u8.buffer,responseHeaders:''}); }
    else o.onload && o.onload({status:res.status,responseText:res.text,response:res.text,responseHeaders:''});
  } catch(e){ o.onerror && o.onerror(e); }
};`;

const results = [];
const check = (n, c, e = '') => { results.push({ n, ok: !!c }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  — ' + e : ''}`); };
const bridge = async (p, opt) => (await fetch(BRIDGE + p, opt)).json();
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);

async function run() {
  const h = await bridge('/api/health');
  check('bridge health (mode=ingest)', h.ok && h.mode === 'ingest');
  try { rmSync('./calibre-bridge/_e2e/ingest', { recursive: true, force: true }); } catch {}
  mkdirSync('./calibre-bridge/_e2e/ingest', { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // node-side privileged fetch (simulates GM_xmlhttpRequest)
  await page.exposeFunction('__bridgeFetch', async (req) => {
    try {
      let body; const headers = req.headers || {};
      if (req.form) { const fd = new FormData(); for (const [k, v] of req.form) { if (v && v.__blob) fd.append(k, new Blob([Buffer.from(v.b64, 'base64')], { type: v.type }), v.name); else fd.append(k, v); } body = fd; }
      else if (req.body !== undefined) body = req.body;
      const r = await fetch(req.url, { method: req.method || 'GET', headers, body });
      if (req.arraybuffer) { const ab = await r.arrayBuffer(); return { status: r.status, b64: Buffer.from(ab).toString('base64') }; }
      return { status: r.status, text: await r.text() };
    } catch (e) { return { status: 0, error: String((e && e.message) || e) }; }
  });

  const AID = '1144697';
  await page.goto('https://www.lightnovel.fun/detail/' + AID, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2300);
  await ev(page, (bu) => { try { localStorage.setItem('lkir_guided', '1'); localStorage.removeItem('lkir_bm_1144697'); localStorage.setItem('lkir_settings', JSON.stringify({ libEnable: true, libUrl: bu, minimap: false })); } catch {} }, BRIDGE);
  await page.addScriptTag({ content: GM });
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 8000 });
  await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click());
  await page.waitForFunction(() => { const r = document.getElementById('lkir-host').shadowRoot; const c = r.getElementById('content'); return c && !/加载中/.test(c.textContent) && c.querySelector('.body'); }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('t-dlCorner').click());
  await page.waitForTimeout(300);
  check('发送到书库 button appears when 启用书库', await ev(page, () => getComputedStyle(document.getElementById('lkir-host').shadowRoot.getElementById('dl-lib')).display !== 'none'));

  await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('dl-lib').click());
  let imported = null;
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); imported = ((await bridge('/api/books')).books || []).find((x) => x.aid === AID); if (imported) break; }
  console.log('  imported:', JSON.stringify(imported));
  check('book imported to bridge w/ metadata', !!imported && !!imported.title, imported ? `title=${imported.title} translator=${imported.translator} series=${imported.series} vol=${imported.volume}` : '(none)');
  check('translator parsed from credit line', !!imported && !!imported.translator, imported && imported.translator);
  const msg = await ev(page, () => document.getElementById('lkir-host').shadowRoot.getElementById('dlgMsg').textContent);
  check('dialog reports success', /已发送到书库|✓/.test(msg), msg);
  const files = readdirSync('./calibre-bridge/_e2e/ingest').filter((f) => f.endsWith('.epub'));
  check('EPUB landed in CWA ingest folder', files.length >= 1, files.join(', '));

  // import-only: the book is catalogued and queryable (no reading-state sync anymore)
  const lk = await bridge('/api/lookup?aid=' + AID);
  check('book queryable via /api/lookup', !!lk.exists && !!lk.book);

  console.log('\nerrors:', errors.length); errors.slice(0, 6).forEach((e) => console.log('  ' + e));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ${passed}/${results.length} checks passed ====`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
