// Loads the extension into real (headless) browsers and checks it on public
// sites that need no login: YouTube, Bluesky and TikTok. Sites change their
// code without warning, so run this before each release.
//
//   node tools/check.mjs            Edge and Firefox
//   node tools/check.mjs chrome     Edge only (any Chromium browser works)
//   node tools/check.mjs firefox    Firefox only (128 or newer)
//
// Browser paths: set QM_CHROME and QM_FIREFOX to override the defaults below.
// Two test copies are built with different defaults ("Highest" everywhere,
// and "Data saver" everywhere), since a test can't click the popup. Exits
// with 1 if any check fails. Needs a network connection; X, Reddit,
// Instagram, Threads and LinkedIn need a login, so test those by hand.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.QM_CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FIREFOX = process.env.QM_FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const BLUESKY_POST = 'https://bsky.app/profile/bsky.app/post/3myi3k45jh22z'; // has a 360p/720p video
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const temps = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), p)); temps.push(d); return d; };

// ---- Results ------------------------------------------------------------------
let failed = 0;
function report(ok, name, detail) {
  if (ok === false) failed++;
  console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO'}  ${name}: ${detail}`);
}
const shortSide = (s) => { const m = /(\d+)x(\d+)/.exec(s || ''); return m ? Math.min(+m[1], +m[2]) : 0; };

// ---- Test copies of the extension ------------------------------------------------
// Copies the project and changes the defaults in config.js, then builds it.
function variant(videoQuality, extra) {
  const dir = tmp('qm-check-');
  for (const f of ['manifest.json', 'icons', 'popup', 'src', 'tools']) cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
  const cfg = path.join(dir, 'src/shared/config.js');
  let c = readFileSync(cfg, 'utf8').replace(/(_videoQuality: )'max'/g, `$1'${videoQuality}'`);
  for (const [k, v] of Object.entries(extra)) c = c.replace(new RegExp(`(${k}: )'[a-z]+'`), `$1'${v}'`);
  writeFileSync(cfg, c);
  execFileSync(process.execPath, [path.join(dir, 'tools/build.mjs')]);
  const version = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version;
  return { dir, firefoxZip: path.join(dir, 'dist', `quality-manager-${version}-firefox.zip`) };
}

// ---- Page checks (same for both browsers) -------------------------------------
const PAGE = {
  badge: `[...(document.querySelector('[data-qm-badges]')?.children || [])].map((b) => b.textContent)`,
  videos: `[...document.querySelectorAll('video')].map((v) => v.videoWidth + 'x' + v.videoHeight + (v.error ? ' error ' + v.error.code : ''))`,
};
// Polls a page expression until it's truthy (or the time runs out).
async function waitFor(b, expression, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
    if (await b.eval(expression)) return true;
  }
  return false;
}

async function siteChecks(b, mode) {
  const highest = mode === 'Highest';
  // Fresh profiles are slow on their first page; warm up.
  await b.open('https://bsky.app/', 6000);

  if (highest) {
    await b.open('https://www.youtube.com/watch?v=aqz-KE-bpKQ', 9000);
    await b.eval(`(() => { const v = document.querySelector('#movie_player video'); if (v) { v.muted = true; v.play(); } })()`);
    await sleep(15000);
    const yt = await b.eval(`JSON.stringify({ video: (() => { const v = document.querySelector('#movie_player video'); return v ? v.videoWidth + 'x' + v.videoHeight : 'none'; })(), badge: ${PAGE.badge}, consent: !!document.querySelector('form[action*=consent], ytd-consent-bump-v2-lightbox') })`);
    const r = JSON.parse(yt || '{}');
    if (r.consent) report(null, 'YouTube', 'cookie consent page shown; skipped');
    else report(r.badge && r.badge.length > 0, 'YouTube', `playing ${r.video}, badge ${JSON.stringify(r.badge)} (often climbs to 4K a few seconds later)`);

    await b.open('https://bsky.app/profile/bsky.app', 3000);
    await waitFor(b, `[...document.images].some((i) => i.currentSrc.includes('cdn.bsky.app/img/feed') && i.naturalWidth > 0)`, 25000);
    await sleep(3000);
    const imgs = JSON.parse(await b.eval(`JSON.stringify([...document.images].filter((i) => i.currentSrc.includes('cdn.bsky.app/img/feed') && i.getBoundingClientRect().width > 100).map((i) => i.naturalWidth))`) || '[]');
    report(imgs.some((w) => w > 1000), 'Bluesky photos (full size)', `widths ${JSON.stringify(imgs.slice(0, 5))}; previews are 1000px at most`);
  }

  await b.open(BLUESKY_POST, 3000);
  // Keep asking it to play until the first frame shows (players load late).
  await waitFor(b, `(() => { const v = document.querySelector('video'); if (!v) return false; v.muted = true; if (v.paused) v.play().catch(() => {}); return v.videoWidth > 0; })()`, 30000);
  await sleep(6000);
  const bs = JSON.parse(await b.eval(`JSON.stringify({ videos: ${PAGE.videos}, badge: ${PAGE.badge} })`) || '{}');
  const bsBadge = (bs.badge || [])[0] || '';
  report(highest ? bsBadge === '720p' : bsBadge === '360p', `Bluesky video (${mode})`, `badge ${JSON.stringify(bs.badge)}, videos ${JSON.stringify(bs.videos)}; expected ${highest ? '720p' : '360p'}`);

  await b.open('https://www.tiktok.com/foryou', 18000);
  const tt = JSON.parse(await b.eval(`JSON.stringify({ videos: ${PAGE.videos}, badge: ${PAGE.badge} })`) || '{}');
  const ttErr = (tt.videos || []).some((v) => v.includes('error'));
  report(ttErr ? false : null, `TikTok (${mode})`, `videos ${JSON.stringify(tt.videos)}, badge ${JSON.stringify(tt.badge)}`);
  return shortSide((tt.videos || [])[0]);
}

// ---- Chromium (DevTools protocol) -------------------------------------------------
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0; const pend = new Map(); const handlers = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else handlers.forEach((h) => h(m)); };
  return new Promise((res) => ws.onopen = () => res({
    send: (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (h) => handlers.push(h), close: () => ws.close(),
  }));
}
async function chromeRun(ext, mode, port) {
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${tmp('qm-chrome-')}`,
    `--load-extension=${ext.dir}`, `--disable-extensions-except=${ext.dir}`, '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-sync', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  try {
    await sleep(5000);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const swT = list.find((t) => t.type === 'service_worker' && t.url.includes('src/background/background.js'));
    if (!swT) { report(false, `Chrome (${mode})`, 'extension did not load'); return null; }
    const extId = swT.url.split('/')[2];
    const sw = await cdp(swT.webSocketDebuggerUrl);
    const swErrors = [];
    sw.on((m) => { if (m.method === 'Runtime.exceptionThrown') swErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]); });
    await sw.send('Runtime.enable');
    const page = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    const pageErrors = [];
    page.on((m) => {
      if (m.method !== 'Runtime.exceptionThrown') return;
      const d = m.params.exceptionDetails; const where = d.url || d.stackTrace?.callFrames?.[0]?.url || '';
      if (where.includes(extId)) pageErrors.push(where.split('/').slice(3).join('/') + ': ' + (d.exception?.description || d.text).split('\n')[0]);
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const b = {
      open: async (url, wait) => { await page.send('Page.navigate', { url }); await sleep(wait); },
      eval: async (expression) => { const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.result?.value; },
    };
    if (mode === 'Highest') {
      await b.open(`chrome-extension://${extId}/popup/popup.html`, 1500);
      const pages = await b.eval(`document.querySelectorAll('.page').length`);
      report(pages === 9, 'Chrome popup', `${pages} pages (8 sites + General)`);
      const rules = (await sw.send('Runtime.evaluate', { expression: `chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)`, awaitPromise: true, returnByValue: true })).result.result?.value;
      report(rules > 0, 'Chrome image rules', `${rules} installed`);
    }
    const tiktok = await siteChecks(b, mode);
    report(swErrors.length + pageErrors.length === 0, `Chrome extension errors (${mode})`, JSON.stringify([...swErrors, ...pageErrors].slice(0, 5)));
    sw.close(); page.close();
    return tiktok;
  } finally { proc.kill(); }
}

// ---- Firefox (WebDriver BiDi) -------------------------------------------------------
async function firefoxRun(ext, mode, port) {
  const proc = spawn(FIREFOX, ['--headless', '--remote-debugging-port', String(port), '--profile', tmp('qm-firefox-'), '--no-remote', '--width', '1280', '--height', '900'], { stdio: 'ignore' });
  let ws; let id = 0; const pend = new Map(); const logs = [];
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  try {
    for (let t = 0; t < 40 && !ws; t++) {
      try {
        const sock = new WebSocket(`ws://127.0.0.1:${port}/session`);
        await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
        ws = sock;
      } catch (_) { await sleep(500); }
    }
    if (!ws) { report(false, `Firefox (${mode})`, 'could not start Firefox'); return null; }
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.type === 'error' ? p.rej(new Error(m.error + ': ' + m.message)) : p.res(m.result); }
      else if (m.method === 'log.entryAdded') logs.push(m.params);
    };
    await send('session.new', { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'ignore' } } } });
    await send('session.subscribe', { events: ['log.entryAdded'] });
    await send('webExtension.install', { extensionData: { type: 'archivePath', path: ext.firefoxZip } });
    const ctx = (await send('browsingContext.getTree', {})).contexts[0].context;
    const b = {
      open: async (url, wait) => { await send('browsingContext.navigate', { context: ctx, url, wait: 'complete' }).catch(() => {}); await sleep(wait); },
      eval: async (expression) => {
        const r = await send('script.evaluate', { expression, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' }).catch((e) => ({ type: 'exception', exceptionDetails: { text: e.message } }));
        return r.type === 'exception' ? undefined : r.result.value;
      },
    };
    const tiktok = await siteChecks(b, mode);
    const ours = logs.filter((l) => l.level === 'error' && /moz-extension|Quality Manager/.test(JSON.stringify(l)));
    report(ours.length === 0, `Firefox extension errors (${mode})`, JSON.stringify(ours.map((l) => (l.text || '').slice(0, 160)).slice(0, 5)));
    return tiktok;
  } finally {
    try { await send('session.end', {}); } catch (_) {}
    proc.kill();
  }
}

// ---- Run ------------------------------------------------------------------------------
const which = process.argv[2] || 'all';
try {
  const highest = variant('max', { bluesky_images: 'orig' });
  const saver = variant('min', {});
  const browsers = [];
  if (which === 'all' || which === 'chrome') browsers.push(['Chrome', chromeRun, 9601]);
  if (which === 'all' || which === 'firefox') browsers.push(['Firefox', firefoxRun, 9611]);
  for (const [name, run, port] of browsers) {
    console.log(`\n=== ${name} ===`);
    const hi = await run(highest, 'Highest', port);
    const lo = await run(saver, 'Data saver', port + 1);
    if (hi && lo) report(hi >= lo, `${name} TikTok: Highest >= Data saver`, `${hi}p vs ${lo}p (equal when the browser can't decode TikTok's H.265 1080p)`);
  }
} finally {
  for (const d of temps) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
