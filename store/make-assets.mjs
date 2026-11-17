// Builds the Microsoft Edge Add-ons listing images into store/edge/:
//   logo-300.png         300x300 store logo (from store/logo.svg)
//   screenshot-*.png     1280x800 screenshots of the real popup
//   promo-440x280.png    small promotional tile
// Usage: node store/make-assets.mjs   (needs Microsoft Edge installed)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'edge');
const PORT = 9471;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(OUT, { recursive: true });

const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'qm-assets-'))}`,
  `--load-extension=${ROOT}`, `--disable-extensions-except=${ROOT}`, '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--disable-sync', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  return new Promise((res) => ws.onopen = () => res({
    send: (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    close: () => ws.close(),
  }));
}
const ev = async (c, expression) => { const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.result?.value; };
const shot = async (c, clip) => Buffer.from((await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })).result.data, 'base64');

async function render(page, html, width, height, file, transparent) {
  const tmp = path.join(OUT, '.render.html');
  writeFileSync(tmp, html);
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  await page.send('Page.navigate', { url: pathToFileURL(tmp).href });
  await sleep(1200);
  writeFileSync(path.join(OUT, file), await shot(page, { x: 0, y: 0, width, height, scale: 1 }));
}

try {
  await sleep(4000);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const extId = list.find((t) => t.type === 'service_worker' && t.url.includes('src/background/background.js')).url.split('/')[2];
  const page = await connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  // ---- Popup captures (2x for sharpness) ----
  const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: false });
  const popupShot = async (site, after) => {
    await page.send('Page.navigate', { url: popupUrl });
    await sleep(800);
    await ev(page, `localStorage.setItem('qm-popup-site', '${site}')`);
    await page.send('Page.navigate', { url: popupUrl });
    await sleep(1200);
    if (after) { await ev(page, after); await sleep(500); }
    const h = await ev(page, `Math.ceil(Math.max(document.body.getBoundingClientRect().bottom, ...[...document.querySelectorAll('.dd-list')].filter((l) => l.offsetParent).map((l) => l.getBoundingClientRect().bottom)))`);
    return (await shot(page, { x: 0, y: 0, width: 360, height: h, scale: 1 })).toString('base64');
  };
  const shots = {
    // Menus open downward only when the popup has room below them, so the
    // popup is made taller for these captures (as it is with more settings).
    videoMenu: await popupShot('reddit', `(() => { document.getElementById('options').style.minHeight = '400px'; const s = document.getElementById('reddit_videoQuality'); s.parentElement.querySelector('.dd-button').click(); })()`),
    picker: await popupShot('x', `(() => { document.getElementById('options').style.minHeight = '470px'; const s = document.getElementById('site-picker'); s.parentElement.querySelector('.dd-button').click(); })()`),
    general: await popupShot('general'),
  };

  // ---- Store images ----
  const font = pathToFileURL(path.join(ROOT, 'popup', 'fonts', 'Inter-latin-wght.woff2')).href;
  const base = `<style>
    @font-face { font-family: Inter; src: url("${font}") format("woff2"); font-weight: 100 900; }
    html, body { margin: 0; height: 100%; }
    body { font-family: Inter, sans-serif; color: #e7e9ea; background: radial-gradient(1200px 700px at 78% 40%, #2a2d33 0%, #16181b 60%, #101214 100%); -webkit-font-smoothing: antialiased; }
  </style>`;
  const logo = readFileSync(path.join(ROOT, 'store', 'logo.svg'), 'utf8');
  const screen = (title, sub, img) => `<!doctype html><meta charset="utf-8">${base}
    <style>
      .wrap { display: flex; align-items: center; gap: 72px; height: 100%; padding: 0 96px; box-sizing: border-box; }
      .text { flex: 1; }
      .brand { display: flex; align-items: center; gap: 14px; font-size: 22px; font-weight: 700; color: #ffc107; margin-bottom: 28px; }
      .brand svg { width: 44px; height: 44px; }
      h1 { margin: 0 0 18px; font-size: 52px; line-height: 1.1; font-weight: 800; letter-spacing: -0.02em; }
      p { margin: 0; font-size: 22px; line-height: 1.5; color: #a9afb6; max-width: 520px; }
      .shot { width: 360px; border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 0 1px #2e3135; }
    </style>
    <div class="wrap"><div class="text"><div class="brand">${logo}Quality Manager</div><h1>${title}</h1><p>${sub}</p></div>
    <img class="shot" src="data:image/png;base64,${img}"></div>`;

  await render(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{width:300px;height:300px;display:block}</style>${logo}`, 300, 300, 'logo-300.png', true);
  await render(page, screen('Pick the video quality on every site', 'Force the best quality, cap it at 1080p, 720p or 480p, or save data. Each site gets its own settings.', shots.videoMenu), 1280, 800, 'screenshot-1-quality.png');
  await render(page, screen('Eight sites, one popup', 'X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok and Bluesky. Switch any site off with one toggle.', shots.picker), 1280, 800, 'screenshot-2-sites.png');
  await render(page, screen('Highest or Data saver, everywhere at once', 'One tap sets video and images on every site. A badge on each video shows the resolution it’s playing.', shots.general), 1280, 800, 'screenshot-3-all-sites.png');
  await render(page, `<!doctype html><meta charset="utf-8">${base}<style>
      .t { display: flex; align-items: center; gap: 22px; height: 100%; padding: 0 34px; box-sizing: border-box; }
      svg { width: 110px; height: 110px; flex: none; }
      h1 { margin: 0 0 8px; font-size: 32px; font-weight: 800; letter-spacing: -0.02em; }
      p { margin: 0; font-size: 17px; line-height: 1.4; color: #a9afb6; }
    </style><div class="t">${logo}<div><h1>Quality Manager</h1><p>Best video quality, or save data, on 8 sites.</p></div></div>`, 440, 280, 'promo-440x280.png');
  page.close();
  console.log('done:', OUT);
} finally {
  proc.kill();
}
