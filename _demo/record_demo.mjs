// Record the full feature-tour demo (1280x720 webm) on the live site with
// injected visual guides: animated cursor, click ripples, focus rings, top
// callouts and a bilingual subtitle bar. Writes offsets.json (segment start
// times in video time) for the narration mix — segments may overrun their
// planned length (live network); the mix follows the RECORDED offsets, so
// audio/subtitle alignment is preserved either way.
// Run from the repo root: node _demo/record_demo.mjs
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const SCRIPT = readFileSync('./lightnovel-immersive-reader.user.js', 'utf-8')
const GM = `window.GM_xmlhttpRequest=function(o){fetch(o.url).then(r=>r.arrayBuffer()).then(b=>o.onload&&o.onload({status:200,response:b,responseHeaders:''})).catch(e=>o.onerror&&o.onerror(e));};`
const narration = JSON.parse(readFileSync('./_demo/narration.json', 'utf-8')).segments
const plan = JSON.parse(readFileSync('./_demo/plan.json', 'utf-8'))
const WEBNOVEL = '1144698' // 68-chapter web novel (seamless flow)
const STREAM = '1144697' // whole-book-in-one-post article (auto chapterization)

const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: '_demo', size: { width: 1280, height: 720 } },
  locale: 'zh-CN',
})
const p = await ctx.newPage()
const t0 = Date.now()
const now = () => Date.now() - t0

async function injectScript() {
  await p.addScriptTag({ content: GM })
  await p.addScriptTag({ content: SCRIPT })
  await p.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 10000 })
}

// ---- overlay kit (cursor / ripple / focus ring / callout / subtitles) ----
async function injectKit() {
  await p.evaluate(() => {
    if (document.getElementById('dm-cur')) return
    const Z = 2147483647
    const css = document.createElement('style')
    css.textContent = `
#dm-cur{position:fixed;width:26px;height:26px;border-radius:50%;border:2.5px solid #fff;background:rgba(99,102,241,.55);box-shadow:0 0 0 2px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.4);z-index:${Z};pointer-events:none;transition:left .65s cubic-bezier(.22,1,.36,1),top .65s cubic-bezier(.22,1,.36,1);left:640px;top:600px;margin:-13px 0 0 -13px}
.dm-rip{position:fixed;border-radius:50%;border:3px solid #6366f1;z-index:${Z};pointer-events:none;animation:dmrip .7s ease-out forwards;margin:-4px 0 0 -4px}
@keyframes dmrip{from{width:8px;height:8px;opacity:.95}to{width:84px;height:84px;opacity:0;margin:-42px 0 0 -42px}}
.dm-ring{position:fixed;border:3px solid #f59e0b;border-radius:12px;z-index:${Z};pointer-events:none;box-shadow:0 0 0 4px rgba(245,158,11,.25);animation:dmring 1.6s ease-in-out 2;opacity:.95}
@keyframes dmring{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
#dm-callout{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:${Z};pointer-events:none;background:rgba(15,17,23,.86);color:#fff;border:1px solid rgba(99,102,241,.7);border-radius:999px;padding:9px 22px;font:700 16px/1.45 system-ui,'Microsoft YaHei',sans-serif;text-align:center;opacity:0;transition:opacity .4s;max-width:84vw;backdrop-filter:blur(6px)}
#dm-callout .en{display:block;font-weight:500;font-size:11.5px;opacity:.75}
#dm-sub{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:${Z};pointer-events:none;background:rgba(10,12,16,.82);color:#fff;border-radius:12px;padding:10px 20px;max-width:88vw;text-align:center;opacity:0;transition:opacity .35s;backdrop-filter:blur(6px)}
#dm-sub .zh{font:600 16.5px/1.5 system-ui,'Microsoft YaHei',sans-serif}
#dm-sub .en{font:400 12.5px/1.45 system-ui,sans-serif;color:#cfd3dc;margin-top:2px}`
    document.documentElement.appendChild(css)
    const cur = document.createElement('div'); cur.id = 'dm-cur'
    const call = document.createElement('div'); call.id = 'dm-callout'
    const sub = document.createElement('div'); sub.id = 'dm-sub'
    document.documentElement.append(cur, call, sub)
    const W = window
    W.__dm = {
      move(x, y) { cur.style.left = x + 'px'; cur.style.top = y + 'px' },
      ripple(x, y) { const r = document.createElement('div'); r.className = 'dm-rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 800) },
      ring(x, y, w, h) { const r = document.createElement('div'); r.className = 'dm-ring'; r.style.left = (x - 6) + 'px'; r.style.top = (y - 6) + 'px'; r.style.width = (w + 12) + 'px'; r.style.height = (h + 12) + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 3300) },
      callout(zh, en) { call.innerHTML = zh + '<span class="en">' + en + '</span>'; call.style.opacity = '1' },
      sub(zh, en) { if (!zh) { sub.style.opacity = '0'; return } sub.innerHTML = '<div class="zh">' + zh + '</div><div class="en">' + en + '</div>'; sub.style.opacity = '1' },
      tween(durMs, dist) {
        const sc = document.getElementById('lkir-host').shadowRoot.getElementById('scroll')
        const from = sc.scrollTop, start = performance.now()
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
        const step = (ts) => { const t = Math.min(1, (ts - start) / durMs); sc.scrollTop = from + dist * ease(t); if (t < 1 && W.__dmTweenOn) requestAnimationFrame(step) }
        W.__dmTweenOn = true
        requestAnimationFrame(step)
      },
      stopTween() { W.__dmTweenOn = false },
    }
  })
}

const R = (sel) => p.evaluate((s) => {
  const el = document.getElementById('lkir-host').shadowRoot.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
}, sel)
const move = (x, y) => p.evaluate(([a, b2]) => window.__dm.move(a, b2), [x, y])
const ring = (r) => r && p.evaluate((q) => window.__dm.ring(q.x, q.y, q.w, q.h), r)
const clickSel = async (sel, settle = 600) => {
  const r = await R(sel)
  if (!r) return false
  await move(r.cx, r.cy)
  await p.waitForTimeout(750)
  await p.evaluate(([a, b2]) => window.__dm.ripple(a, b2), [r.cx, r.cy])
  await p.waitForTimeout(160)
  await p.evaluate((s) => { const el = document.getElementById('lkir-host').shadowRoot.querySelector(s); if (el) el.click() }, sel)
  await p.waitForTimeout(settle)
  return true
}

const offsets = []
let segEndsAt = 0
let curSub = null
async function seg(id) {
  const i = narration.findIndex((n) => n.id === id)
  const n = narration[i]
  offsets.push({ id: n.id, at: now() })
  segEndsAt = now() + plan[i].ms
  curSub = [n.zh, n.en, n.calloutZh, n.calloutEn]
  await p.evaluate(([zh, en, czh, cen]) => { window.__dm.callout(czh, cen); window.__dm.sub(zh, en) }, curSub)
}
const reapplySub = () => curSub && p.evaluate(([zh, en, czh, cen]) => { window.__dm.callout(czh, cen); window.__dm.sub(zh, en) }, curSub)
async function segTail() {
  const left = segEndsAt - now()
  if (left > 0) await p.waitForTimeout(left)
}
const readyWait = () => p.waitForFunction(() => { const e = document.getElementById('lkir-host').shadowRoot.getElementById('content'); return e && !/加载中/.test(e.textContent) && e.querySelector('.body') }, { timeout: 25000 }).then(() => true).catch(() => false)

// ============================ setup ============================
await p.goto('https://www.lightnovel.fun/detail/' + WEBNOVEL, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(2400)
await p.evaluate(() => {
  localStorage.setItem('lkir_guided', '1')
  localStorage.setItem('lkir_settings', JSON.stringify({ theme: 'paper', minimap: true, showOutline: true, seamlessScroll: true, resume: true }))
  localStorage.removeItem('lir_progress')
  Object.keys(localStorage).filter((k) => k.startsWith('lkir_bm_') || k.startsWith('lkir_split_')).forEach((k) => localStorage.removeItem(k))
})
await injectScript()
await injectKit()

// ============================ timeline ============================
// S1 open the reader
await seg('open')
await clickSel('#launch', 800)
if (!(await readyWait())) {
  await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('close').click())
  await p.waitForTimeout(1200)
  await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click())
  if (!(await readyWait())) { await p.screenshot({ path: '_demo/fail.png' }); throw new Error('reader never loaded (see _demo/fail.png)') }
}
await p.waitForTimeout(1500)
await p.evaluate(() => { const it = document.getElementById('lkir-host').shadowRoot.querySelector('#outlineList .cat-item[data-i="1"]'); if (it) it.click() })
await segTail()

// S2 seamless scroll across a chapter boundary
await seg('flow')
const dist = await p.evaluate(() => {
  const r = document.getElementById('lkir-host').shadowRoot
  const sc = r.getElementById('scroll')
  const secs = [...r.querySelectorAll('#flow .chap[data-ci]')]
  const last = secs[secs.length - 1]
  const bot = last.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + last.offsetHeight
  return Math.max(2400, bot - sc.scrollTop - sc.clientHeight + 900)
})
await p.evaluate(([ms, d]) => window.__dm.tween(ms, d), [plan[1].ms - 1200, Math.min(dist, 9000)])
await segTail()
await p.evaluate(() => window.__dm.stopTween())

// S3 chip + outline follow
await seg('chip')
await ring(await R('#curChip'))
await p.waitForTimeout(2300)
await ring(await R('#outlineList .cat-item.active'))
await p.waitForTimeout(2000)
await clickSel('#outlineList .cat-item.active + .cat-item', 900)
await segTail()

// S4 minimap + caps
await seg('minimap')
const mm = await R('#minimap')
if (mm) {
  await ring(mm)
  await p.waitForTimeout(2200)
  const tapMm = async (cx, cy) => {
    await move(cx, cy)
    await p.waitForTimeout(800)
    await p.evaluate(([a, b2]) => window.__dm.ripple(a, b2), [cx, cy])
    await p.evaluate(([x, y]) => {
      const el = document.getElementById('lkir-host').shadowRoot.getElementById('minimap')
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 9 }))
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 9 }))
    }, [cx, cy])
  }
  await tapMm(mm.x + mm.w / 2, mm.y + mm.h * 0.55)
  await p.waitForTimeout(1700)
  await tapMm(mm.x + mm.w / 2, mm.y + mm.h - 8)
}
await segTail()

// S5 bookmarks
await seg('bookmarks')
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); if (t) t.click() })
await p.waitForTimeout(900)
await p.evaluate(() => {
  const r = document.getElementById('lkir-host').shadowRoot
  const sc = r.getElementById('scroll')
  const probe = sc.scrollTop + 220
  const secs = [...r.querySelectorAll('#flow .chap[data-ci]')]
  let sec = secs[0]
  for (const s of secs) { const t = s.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop; if (t <= probe) sec = s }
  window.__dmBlks = [...sec.querySelectorAll('.blk[data-bi]')].filter((bk) => (bk.textContent || '').trim().length > 14).slice(1, 4)
})
for (const k of [0, 1]) {
  const r = await p.evaluate((idx) => { const el = (window.__dmBlks || [])[idx]; if (!el) return null; const q = el.getBoundingClientRect(); return { cx: q.left + Math.min(180, q.width / 2), cy: q.top + q.height / 2 } }, k)
  if (r) {
    await move(r.cx, r.cy)
    await p.waitForTimeout(850)
    await p.evaluate(([a, b2]) => window.__dm.ripple(a, b2), [r.cx, r.cy])
    await p.evaluate((idx) => { const el = (window.__dmBlks || [])[idx]; if (el) el.click() }, k)
    await p.waitForTimeout(700)
  }
}
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const t = [...r.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.dataset.t === 'toc'); if (t) t.click() })
await segTail()

// S6 settings: themes + typography
await seg('themes')
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.add('guide-reveal'))
await clickSel('#t-set', 900)
await clickSel('#sw .sw[data-k="dark"]', 1400)
await clickSel('#sw .sw[data-k="paper"]', 1000)
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const s = r.querySelector('#s-fs'); if (s) { s.value = '22'; s.dispatchEvent(new Event('input', { bubbles: true })) } })
await p.waitForTimeout(1400)
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const s = r.querySelector('#s-fs'); if (s) { s.value = '19'; s.dispatchEvent(new Event('input', { bubbles: true })) } })
await segTail()

// S7 language: 中文 ⇄ English
await seg('language')
await clickSel('#s-lang button[data-l="en"]', 1800)
await clickSel('#s-lang button[data-l="zh"]', 900)
await segTail()

// S8 resume + export/import (highlight the rows)
await seg('resume')
await ring(await R('#s-resume'))
await p.waitForTimeout(2400)
await ring(await R('#s-progexp'))
await p.waitForTimeout(1800)
await ring(await R('#s-progimp'))
await segTail()

// S9 advanced fold: Calibre + LLM (experimental)
await seg('advanced')
await clickSel('#s-adv-toggle', 900)
const subH = await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const el = r.querySelector('.set-sub-h'); if (el) el.scrollIntoView({ block: 'center' }); return true })
void subH
await p.waitForTimeout(600)
await ring(await R('.set-sub-h'))
await p.waitForTimeout(2200)
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const els = r.querySelectorAll('.set-sub-h'); const el = els[1]; if (el) el.scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(600)
await ring((await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const els = r.querySelectorAll('.set-sub-h'); const el = els[1]; if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, cx: 0, cy: 0 } })))
await segTail()

// S10 paged-mode toggle (off → classic pager → on)
await seg('paged')
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; r.getElementById('setBody').scrollTop = 0 })
await p.waitForTimeout(500)
await clickSel('#s-seamless', 1200)
await clickSel('#setClose', 800)
await p.evaluate(() => {
  const sc = document.getElementById('lkir-host').shadowRoot.getElementById('scroll')
  window.__dm.tween(2200, sc.scrollHeight - sc.clientHeight - sc.scrollTop)
})
await p.waitForTimeout(2600)
await ring(await R('.foot'))
await p.waitForTimeout(1800)
await clickSel('#t-set', 800)
await clickSel('#s-seamless', 1100)
await clickSel('#setClose', 500)
await segTail()

// S11 feature guide (spotlight tour)
await seg('guide')
await clickSel('#t-set', 700)
await clickSel('#s-guide', 1400)
await clickSel('#guideNext', 1500)
await clickSel('#guideNext', 1500)
await clickSel('#guideSkip', 700)
await segTail()

// S12 download with chapter range
await seg('download')
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('overlay').classList.add('guide-reveal'))
await clickSel('#t-dlCorner', 900)
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const items = r.getElementById('dlList').querySelectorAll('.dl-ch'); if (items[2]) items[2].click() })
await p.waitForTimeout(700)
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const items = r.getElementById('dlList').querySelectorAll('.dl-ch'); if (items[9]) items[9].click() })
await p.waitForTimeout(700)
const epubBtn = await R('#dl-epub')
if (epubBtn) { await move(epubBtn.cx, epubBtn.cy); await ring(epubBtn) }
await segTail()
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('dlgClose').click())
await p.waitForTimeout(400)

// S13 transition: leave the reader, open the single-post book (the narration covers
// the full page navigation + reload; the reader content must be READY before the
// chapterize narration starts, so a slow live site can't leave dead air mid-segment)
await seg('switch')
await clickSel('#close', 900)
await p.goto('https://www.lightnovel.fun/detail/' + STREAM, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(2200)
await injectScript()
await injectKit()
await reapplySub()
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click())
await readyWait()
await p.waitForTimeout(800)
await segTail()

// S14 auto chapterization + manual split
await seg('chapterize')
await p.waitForTimeout(800)
await ring(await R('#outlineList'))
await p.waitForTimeout(2200)
await clickSel('.tab-toc', 1300) // active 目录 clicked again → manual split mode
await p.evaluate(() => { const r = document.getElementById('lkir-host').shadowRoot; const sep = r.querySelector('.ch-sep.edit'); if (sep) sep.scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(700)
await ring(await R('.ch-sep.edit'))
await p.waitForTimeout(2400)
await clickSel('.tab-done', 800)
await segTail()

// S14 exit
await seg('exit')
await clickSel('#close', 1200)
await p.waitForTimeout(1800)
await p.evaluate(() => window.__dm.sub('', ''))
await segTail()
await p.waitForTimeout(600)

const video = p.video()
await ctx.close()
const path = await video.path()
writeFileSync('./_demo/offsets.json', JSON.stringify({ video: path, offsets }, null, 2))
await b.close()
console.log('recorded', path)
console.log(JSON.stringify(offsets))
