// Stage and capture the README feature screenshots against the live site.
// Usage: node verify/readme-shots.mjs   (writes docs/assets/readme-*.png)
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const SCRIPT = readFileSync('./lightnovel-immersive-reader.user.js', 'utf-8')
const GM = `window.GM_xmlhttpRequest=function(o){fetch(o.url).then(r=>r.arrayBuffer()).then(b=>o.onload&&o.onload({status:200,response:b,responseHeaders:''})).catch(e=>o.onerror&&o.onerror(e));};`
const AID = '1144698' // 68-chapter web novel
mkdirSync('docs/assets', { recursive: true })

const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, locale: 'zh-CN', deviceScaleFactor: 1.5 })
const p = await ctx.newPage()
await p.goto('https://www.lightnovel.fun/detail/' + AID, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(2200)
await p.evaluate(() => {
  localStorage.setItem('lkir_guided', '1')
  localStorage.setItem('lkir_settings', JSON.stringify({ theme: 'paper', minimap: true, showOutline: true, seamlessScroll: true }))
  Object.keys(localStorage).filter((k) => k.startsWith('lkir_bm_')).forEach((k) => localStorage.removeItem(k))
})
await p.addScriptTag({ content: GM })
await p.addScriptTag({ content: SCRIPT })
await p.waitForFunction(() => !!document.getElementById('lkir-host'), { timeout: 8000 })
const r = () => document.getElementById('lkir-host').shadowRoot
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('launch').click())
await p.waitForFunction(() => { const e = document.getElementById('lkir-host').shadowRoot.getElementById('content'); return e && !/加载中/.test(e.textContent) && e.querySelector('.body') }, { timeout: 30000 })
await p.waitForTimeout(2500)

// 1) seamless flow at a chapter boundary (divider + outline + minimap + chip)
await p.evaluate(() => { const it = document.getElementById('lkir-host').shadowRoot.querySelector('#outlineList .cat-item[data-i="3"]'); if (it) it.click() })
await p.waitForTimeout(2200)
// walk forward so the window holds a few chapters (minimap ↑/↓ caps appear)
for (let k = 0; k < 3; k++) {
  await p.evaluate(() => { const rr = document.getElementById('lkir-host').shadowRoot; const sc = rr.getElementById('scroll'); const secs = [...rr.querySelectorAll('#flow .chap[data-ci]')]; const last = secs[secs.length - 1]; const bot = last.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + last.offsetHeight; sc.scrollTop = Math.max(0, bot - sc.clientHeight - 120); sc.dispatchEvent(new Event('scroll')) })
  await p.waitForTimeout(900)
}
// center the boundary between the 2nd and 3rd loaded chapters
await p.evaluate(() => {
  const rr = document.getElementById('lkir-host').shadowRoot
  const sc = rr.getElementById('scroll')
  const secs = [...rr.querySelectorAll('#flow .chap[data-ci]')]
  const sec = secs[2] || secs[1] || secs[0]
  const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
  sc.scrollTop = Math.max(0, top - sc.clientHeight / 2)
  sc.dispatchEvent(new Event('scroll'))
})
await p.waitForTimeout(1300)
await p.screenshot({ path: 'docs/assets/readme-flow.png' })

// 2) bookmarks: mark two paragraphs in the active chapter (书签 tab)
await p.evaluate(() => { const rr = document.getElementById('lkir-host').shadowRoot; const t = [...rr.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.textContent.includes('书签')); t.click() })
await p.waitForTimeout(600)
await p.evaluate(() => {
  const rr = document.getElementById('lkir-host').shadowRoot
  const sc = rr.getElementById('scroll')
  const probe = sc.scrollTop + 200
  const secs = [...rr.querySelectorAll('#flow .chap[data-ci]')]
  let sec = secs[0]
  for (const s of secs) { const t = s.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop; if (t <= probe) sec = s }
  const blks = [...sec.querySelectorAll('.blk[data-bi]')].filter((b) => (b.textContent || '').trim().length > 12)
  blks[1] && blks[1].click()
  blks[3] && blks[3].click()
})
await p.waitForTimeout(900)
await p.screenshot({ path: 'docs/assets/readme-bookmarks.png' })
await p.evaluate(() => { const rr = document.getElementById('lkir-host').shadowRoot; const t = [...rr.getElementById('outlineTabs').querySelectorAll('button')].find((x) => x.dataset.t === 'toc'); t && t.click() })
await p.waitForTimeout(400)

// 3) settings panel
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click())
await p.waitForTimeout(700)
await p.screenshot({ path: 'docs/assets/readme-settings.png' })
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('t-set').click())
await p.waitForTimeout(400)

// 4) download dialog with the chapter-range picker
await p.evaluate(() => document.getElementById('lkir-host').shadowRoot.getElementById('t-dlCorner').click())
await p.waitForTimeout(700)
await p.evaluate(() => { const rr = document.getElementById('lkir-host').shadowRoot; const items = rr.getElementById('dlList').querySelectorAll('.dl-ch'); items[2] && items[2].click(); items[9] && items[9].click() })
await p.waitForTimeout(500)
await p.screenshot({ path: 'docs/assets/readme-download.png' })

await b.close()
console.log('readme shots written to docs/assets/')
