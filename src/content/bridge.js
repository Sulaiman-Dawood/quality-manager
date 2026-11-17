// Isolated-world content script for every supported site. Mirrors this
// site's settings from chrome.storage into the page (for the MAIN-world
// hooks) and draws the optional resolution badge on videos.
(function () {
  'use strict';
  const CONFIG = self.QM_CONFIG;
  const siteId = CONFIG.siteForHost(location.hostname);
  if (!siteId) return;

  const STORAGE_KEY = '__qm_settings';
  let settings = Object.assign({}, CONFIG.DEFAULTS);
  // Badge state (declared up front: the settings callbacks below refresh badges).
  const badges = new Map(); // video -> badge element
  let layer = null;
  let scheduled = false;
  // Image size picker state (see the end of this file).
  const imgOriginal = new WeakMap(); // <img>/<source> -> the site's own srcset
  let imgObserver = null;
  // Sites whose images come with a list of sizes, and where those live.
  const IMAGE_SITES = {
    reddit: { key: 'reddit_images', hosts: ['preview.redd.it'] },
    instagram: { key: 'instagram_images', hosts: ['cdninstagram.com', 'fbcdn.net'] },
    threads: { key: 'threads_images', hosts: ['cdninstagram.com', 'fbcdn.net'] },
    // LinkedIn's lists are sparse (160, 480, 800, 1200...), so "no wider
    // than shown" could drop a 470px photo to 160px. Data saver takes the
    // smallest size that still fills the slot instead.
    linkedin: { key: 'linkedin_images', hosts: ['media.licdn.com'], fill: true },
  };

  try { localStorage.removeItem('__xq_settings'); } catch (_) {} // v1 leftover

  function pushToPage() {
    const json = JSON.stringify(CONFIG.pageSettings(settings, siteId));
    try { localStorage.setItem(STORAGE_KEY, json); } catch (_) {}
    window.dispatchEvent(new CustomEvent('qm-settings', { detail: json }));
  }

  // First visit to this site: nothing mirrored yet, so give the page hooks
  // the defaults right away rather than leaving them idle until storage
  // answers. Later visits already have the user's last settings.
  try { if (localStorage.getItem(STORAGE_KEY) === null) pushToPage(); } catch (_) {}

  chrome.storage.sync.get(CONFIG.DEFAULTS, (stored) => {
    settings = Object.assign({}, CONFIG.DEFAULTS, stored);
    pushToPage();
    refreshAllBadges();
    refreshImages();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    // A removed key (e.g. sync brought in settings from an older copy of the
    // extension on another device) falls back to its default, not "off".
    for (const [k, { newValue }] of Object.entries(changes)) {
      settings[k] = newValue === undefined ? CONFIG.DEFAULTS[k] : newValue;
    }
    pushToPage();
    refreshAllBadges();
    refreshImages();
  });

  // ---- Resolution badge ---------------------------------------------------
  // Badges are drawn on one fixed, click-through layer over the page and
  // placed over each video's top-left corner, rather than inside the site's
  // player. That works the same everywhere: YouTube's player chrome can't
  // cover them and Reddit's (closed) shadow DOM can't hide them.
  function label(w, h) {
    const s = Math.min(w, h);
    if (s >= 2160) return '4K';
    if (s >= 1440) return '1440p';
    return s + 'p';
  }

  function badgeOn() {
    return !!(settings.enabled && settings[siteId + '_enabled'] && settings.showBadge);
  }

  // In fullscreen only the fullscreen element's subtree is shown, so the
  // layer moves inside it (unless that element is the <video> itself).
  function ensureLayer() {
    if (!layer) {
      layer = document.createElement('div');
      layer.setAttribute('data-qm-badges', '');
      layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;';
    }
    const fs = document.fullscreenElement;
    const host = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (host && layer.parentNode !== host) host.appendChild(layer);
    return layer;
  }

  function makeBadge() {
    const b = document.createElement('div');
    b.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      'padding:2px 6px', 'border-radius:4px',
      'font:700 11px/16px system-ui,-apple-system,"Segoe UI",sans-serif',
      'color:#fff', 'background:rgba(0,0,0,0.6)',
      'pointer-events:none', 'letter-spacing:0.02em', 'white-space:nowrap',
    ].join(';');
    return b;
  }

  // Shadow roots, open or closed (chrome.dom reaches closed ones).
  function shadowOf(el) {
    try {
      if (chrome.dom && chrome.dom.openOrClosedShadowRoot) return chrome.dom.openOrClosedShadowRoot(el);
    } catch (_) {}
    return el.shadowRoot || null;
  }

  function videosIn(root, out, depth) {
    if (!root || depth > 4) return;
    for (const v of root.querySelectorAll('video')) out.push(v);
    for (const el of root.querySelectorAll('*')) {
      const sr = shadowOf(el);
      if (sr) videosIn(sr, out, depth + 1);
    }
  }

  // Videos in the page, plus those inside Reddit's player components.
  // Only known player hosts are searched for shadow roots, to keep this cheap.
  function allVideos() {
    const out = [...document.querySelectorAll('video')];
    for (const host of document.querySelectorAll('shreddit-player, shreddit-player-2')) {
      videosIn(shadowOf(host), out, 0);
    }
    return out;
  }

  function place(video) {
    let badge = badges.get(video);
    const r = video.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(r.top, 0) + 8;
    const visible = video.isConnected && video.videoWidth > 0 &&
      r.width >= 80 && r.height >= 60 &&
      r.right > 0 && r.left < vw && top + 16 < Math.min(r.bottom, vh);
    if (!visible) {
      if (badge) badge.style.display = 'none';
      return;
    }
    if (!badge) {
      badge = makeBadge();
      badges.set(video, badge);
    }
    const host = ensureLayer();
    if (badge.parentNode !== host) host.appendChild(badge);
    badge.style.display = '';
    badge.style.transform = `translate(${Math.round(Math.max(r.left, 0) + 8)}px, ${Math.round(top)}px)`;
    const text = label(video.videoWidth, video.videoHeight);
    if (badge.textContent !== text) badge.textContent = text;
    badge.title = `${video.videoWidth}×${video.videoHeight} (Quality Manager)`;
  }

  function update() {
    scheduled = false;
    const seen = new Set();
    if (badgeOn()) {
      for (const v of allVideos()) {
        if (seen.has(v)) continue;
        seen.add(v);
        place(v);
      }
    }
    for (const [v, b] of badges) {
      if (!seen.has(v)) { b.remove(); badges.delete(v); }
    }
  }

  function refreshAllBadges() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  // Follow scrolling (any scroller, hence capture), resizing, fullscreen and
  // video size changes; a light poll catches layout changes (theater mode,
  // players added as you scroll, videos inside shadow DOM).
  window.addEventListener('scroll', refreshAllBadges, { capture: true, passive: true });
  window.addEventListener('resize', refreshAllBadges, { passive: true });
  document.addEventListener('fullscreenchange', refreshAllBadges);
  for (const type of ['loadedmetadata', 'resize', 'playing']) {
    document.addEventListener(type, refreshAllBadges, true);
  }
  setInterval(() => { if (!document.hidden && (badgeOn() || badges.size)) refreshAllBadges(); }, 700);

  // ---- Image size picker (Reddit, Instagram, Threads, LinkedIn) ------------------------------
  // Each image comes with a srcset: the site's list of sizes, every one a
  // signed URL (so sizes can't be made up). The browser normally picks by
  // display size and screen density; here the extension picks instead:
  //   'small'  data saver: the largest size no wider than the image is
  //            shown (the smallest listed if all are wider); on sites
  //            marked `fill`, the smallest size at least that wide
  //   'large'  largest size listed
  // by narrowing the srcset to that one entry. 'default' leaves it alone;
  // Reddit's 'orig' is handled by redirect rules in the background instead.
  function imageMode() {
    const site = IMAGE_SITES[siteId];
    if (!site || !settings.enabled || !settings[siteId + '_enabled']) return 'default';
    const mode = settings[site.key];
    return mode === 'small' || mode === 'large' ? mode : 'default';
  }

  // "url 640w, url 1080w" -> [{ url, w }], smallest first. Entries without
  // a width, or on other hosts, make the whole list ours-to-leave-alone.
  function parseSrcset(srcset) {
    const out = [];
    const re = /\s*(\S+)\s+(\d+)w\s*(?:,|$)/g;
    let m;
    while ((m = re.exec(srcset || ''))) out.push({ url: m[1], w: +m[2] });
    const hosts = IMAGE_SITES[siteId].hosts;
    const ok = out.length > 1 && out.every((c) => {
      try { const h = new URL(c.url, location.href).hostname; return hosts.some((d) => h === d || h.endsWith('.' + d)); } catch (_) { return false; }
    });
    return ok ? out.sort((a, b) => a.w - b.w) : null;
  }

  function displayWidth(el) {
    const img = el.tagName === 'SOURCE' ? el.parentElement && el.parentElement.querySelector('img') : el;
    if (!img) return 0;
    const r = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
    return Math.ceil((r && r.width) || +img.getAttribute('width') || 0);
  }

  function pick(cands, mode, el) {
    if (mode === 'large') return cands[cands.length - 1];
    const shown = displayWidth(el) || 480; // not laid out yet: a modest default
    if (IMAGE_SITES[siteId].fill) return cands.find((c) => c.w >= shown) || cands[cands.length - 1];
    let best = cands[0];
    for (const c of cands) if (c.w <= shown) best = c;
    return best;
  }

  function applyImage(el, mode) {
    const current = el.getAttribute('srcset');
    // Ours if it's what we last wrote; otherwise the site (re)set it.
    let original = imgOriginal.get(el);
    if (!original || (current !== original.mine && current !== original.site)) {
      original = { site: current, mine: null };
      imgOriginal.set(el, original);
    }
    if (mode === 'default') {
      if (original.mine && current === original.mine) el.setAttribute('srcset', original.site);
      original.mine = null;
      return;
    }
    const cands = parseSrcset(original.site);
    if (!cands) return;
    const chosen = pick(cands, mode, el);
    const value = `${chosen.url} ${chosen.w}w`;
    original.mine = value;
    if (current !== value) el.setAttribute('srcset', value);
  }

  function imagesIn(root) {
    if (!root.querySelectorAll) return [];
    const found = [...root.querySelectorAll('img[srcset], source[srcset]')];
    if (root.matches && root.matches('img[srcset], source[srcset]')) found.push(root);
    return found;
  }

  function refreshImages() {
    if (!IMAGE_SITES[siteId]) return;
    const mode = imageMode();
    for (const el of imagesIn(document)) applyImage(el, mode);
    if (mode !== 'default' && !imgObserver && typeof MutationObserver === 'function') {
      // New images (infinite scroll) and the site re-setting srcset.
      imgObserver = new MutationObserver((records) => {
        const m = imageMode();
        if (m === 'default') return;
        for (const r of records) {
          if (r.type === 'attributes') applyImage(r.target, m);
          else for (const n of r.addedNodes) if (n.nodeType === 1) for (const el of imagesIn(n)) applyImage(el, m);
        }
      });
      imgObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['srcset'] });
    }
  }
  refreshImages();

  // ---- X: never leave an "Original" photo broken -------------------------
  // With "Original", photos are redirected to name=orig, which only exists in
  // the upload's own format. If one still fails (e.g. a PNG upload asked for
  // as JPG), reload it once at 4096px: a resized copy, which X serves in any
  // format. The retry URL puts `name` first, which the redirect rules don't
  // match, so it isn't redirected again.
  if (siteId === 'x') {
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || img.dataset.qmRetried) return;
      if (!settings.enabled || !settings.x_enabled || settings.x_feedImages !== 'orig') return;
      let u;
      try { u = new URL(img.currentSrc || img.src); } catch (_) { return; }
      if (u.hostname !== 'pbs.twimg.com' || !/^\/(media\/|[a-z_]*_video_thumb\/)/.test(u.pathname)) return;
      img.dataset.qmRetried = '1';
      const fmt = u.searchParams.get('format');
      u.search = fmt ? `?name=4096x4096&format=${fmt}` : '?name=4096x4096';
      if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
      img.src = u.href;
    }, true);
  }
})();
