// Runs in the page's own JS world (MAIN) at document_start, before the
// site's player code, on X, Reddit, Instagram, Threads, LinkedIn, TikTok
// and Bluesky. Intercepts master playlists / MPDs the player fetches
// -- or, on Meta sites, the API responses and page data that carry MPDs
// inside their JSON; on LinkedIn and TikTok, the quality lists in the data
// the app unpacks -- and rewrites them to the quality the user chose.
(function () {
  'use strict';
  if (window.__QM_STREAM_HOOKED__) return;
  window.__QM_STREAM_HOOKED__ = true;

  const HLS = window.__QM_HLS__;
  const DASH = window.__QM_DASH__;
  if (!HLS || !DASH) return;

  // Settings come from the isolated-world bridge, which owns the config:
  // { enabled, videoQuality, bestAudio, streamHosts } for this site. It
  // mirrors them into localStorage (read synchronously) and announces
  // changes with a 'qm-settings' event. Until they arrive, do nothing.
  const STORAGE_KEY = '__qm_settings';
  let settings = null;

  function loadSettings(raw) {
    try {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') settings = Object.assign({}, settings, s);
    } catch (_) { /* keep previous */ }
  }
  function current() {
    if (!settings) { try { loadSettings(localStorage.getItem(STORAGE_KEY)); } catch (_) {} }
    return settings;
  }
  let parseHooked = false;
  window.addEventListener('qm-settings', (e) => {
    current();
    loadSettings(e.detail);
    if (wantsParse()) hookParse();
  });

  // Sites whose quality data is unpacked with JSON.parse (see hookParse).
  function wantsParse() {
    return !!(settings && (settings.imageData || settings.vhsJson || settings.bitrateJson ||
      (settings.manifestPaths && settings.manifestPaths.length)));
  }

  function active() {
    const s = current();
    return !!(s && s.enabled && (s.videoQuality !== 'auto' || s.bestAudio || trimImages()));
  }

  // 'small' (Data saver) or 'large' (Highest) when photo-size lists should
  // be trimmed on this site; null otherwise.
  function imageTrimMode() {
    const s = current();
    if (!s || !s.enabled || !s.imageData) return null;
    return s.images === 'small' || s.images === 'large' ? s.images : null;
  }
  function trimImages() {
    return imageTrimMode() !== null;
  }

  // ---- Instagram / Threads photo sizes ---------------------------------------
  // The app picks one URL from each photo's "candidates" list in its API
  // data (often 1080px or far larger, for a ~470px slot). With Data saver,
  // drop every candidate wider than IMAGE_CAP so the app can only pick a
  // small one; a list with nothing small enough keeps just its smallest
  // entry, so no photo goes missing. With Highest, keep only the largest.
  const IMAGE_CAP = 640;

  // End index (exclusive) of the JSON array starting at text[start] === '['.
  function arrayEnd(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++; // skip the escaped character
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) return i + 1;
    }
    return -1;
  }

  function isCandidate(c) {
    return c && typeof c === 'object' && typeof c.url === 'string' && c.width > 0;
  }

  function trimImageCandidates(text, mode) {
    if (typeof text !== 'string' || !text.includes('"candidates":')) return { text, changed: false };
    mode = mode || 'small';
    const KEY = '"candidates":';
    let out = '';
    let from = 0;
    let changed = false;
    for (let at = text.indexOf(KEY); at !== -1; at = text.indexOf(KEY, from)) {
      const open = at + KEY.length;
      if (text[open] !== '[') { out += text.slice(from, open); from = open; continue; }
      const end = arrayEnd(text, open);
      if (end === -1) break;
      let replacement = null;
      try {
        const list = JSON.parse(text.slice(open, end));
        if (Array.isArray(list) && list.length > 1 && list.every(isCandidate)) {
          let keep;
          if (mode === 'large') {
            keep = [list.reduce((a, b) => (b.width > a.width ? b : a))];
          } else {
            keep = list.filter((c) => c.width <= IMAGE_CAP);
            if (!keep.length) keep = [list.reduce((a, b) => (b.width < a.width ? b : a))];
          }
          if (keep.length < list.length) replacement = JSON.stringify(keep);
        }
      } catch (_) { /* not plain JSON here; leave it */ }
      out += text.slice(from, open) + (replacement !== null ? replacement : text.slice(open, end));
      if (replacement !== null) changed = true;
      from = end;
    }
    if (!changed) return { text, changed: false };
    return { text: out + text.slice(from), changed: true };
  }

  // ---- Meta (Instagram, Threads): MPDs inside the app's data ---------------
  // Rewrites every MPD in a chunk of the app's JSON; null when nothing changed.
  function rewriteMetaJson(text, opts) {
    if (!DASH.hasEmbedded(text)) return null;
    const r = DASH.rewriteEmbedded(text, opts);
    return r.changed ? r.text : null;
  }

  function metaOpts() {
    const s = current();
    if (!s || !s.enabled || !(s.manifestPaths && s.manifestPaths.length)) return null;
    if (s.videoQuality === 'auto' && !s.bestAudio) return null;
    return { quality: s.videoQuality, bestAudio: s.bestAudio };
  }

  // ---- LinkedIn: the player's quality list ----------------------------------
  // LinkedIn's Video.js player gets each video as a ready-made list
  // ("data:application/vnd.videojs.vhs+json,{...}") rather than downloading
  // a playlist, and unpacks it with JSON.parse. Keep only the renditions at
  // the chosen size; all codecs at that size stay (e.g. AV1 and H.264), so
  // the player can still fall back to one the browser plays.
  function isVhsList(v) {
    return v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.playlists) && v.playlists.length > 1 &&
      v.mediaGroups && v.playlists.every((p) => p && p.attributes && p.attributes.RESOLUTION && p.attributes.RESOLUTION.height > 0);
  }

  function filterVhsList(list, quality) {
    const short = (p) => HLS.shortSide({ width: p.attributes.RESOLUTION.width, height: p.attributes.RESOLUTION.height });
    const variants = list.playlists.map((p) => ({
      width: p.attributes.RESOLUTION.width, height: p.attributes.RESOLUTION.height, bandwidth: +p.attributes.BANDWIDTH || 0,
    }));
    const chosen = HLS.pickVariant(variants, quality);
    if (!chosen) return false;
    const keep = list.playlists.filter((p) => short(p) === HLS.shortSide(chosen));
    if (!keep.length || keep.length === list.playlists.length) return false;
    list.playlists = keep;
    return true;
  }

  function vhsQuality() {
    const s = current();
    return s && s.enabled && s.vhsJson && s.videoQuality !== 'auto' ? s.videoQuality : null;
  }

  // ---- TikTok: each video's "bitrateInfo" list ------------------------------
  // Every TikTok video comes with a list of ready-made MP4s (e.g. 1080p,
  // 720p and 540p, in H.265 and H.264), and the player picks one itself.
  // Keep only the entries at the chosen size, every codec at it, so the
  // player can still choose one the browser plays.
  function isBitrateEntry(b) {
    return b && typeof b === 'object' && b.PlayAddr && b.PlayAddr.Width > 0 && b.PlayAddr.Height > 0 &&
      Array.isArray(b.PlayAddr.UrlList) && b.PlayAddr.UrlList.length > 0;
  }

  function filterBitrateInfo(video, quality) {
    const list = video.bitrateInfo;
    if (!Array.isArray(list) || list.length < 2 || !list.every(isBitrateEntry)) return false;
    const variants = list.map((b) => ({ width: b.PlayAddr.Width, height: b.PlayAddr.Height, bandwidth: +b.Bitrate || 0 }));
    const chosen = HLS.pickVariant(variants, quality);
    if (!chosen) return false;
    const size = HLS.shortSide(chosen);
    const keep = list.filter((b) => HLS.shortSide({ width: b.PlayAddr.Width, height: b.PlayAddr.Height }) === size);
    if (!keep.length || keep.length === list.length) return false;
    video.bitrateInfo = keep;
    // The single fallback address, used when the list isn't: point it at a
    // kept H.264 file (plays everywhere) if it isn't one of them already.
    if (typeof video.playAddr === 'string' && !keep.some((b) => b.PlayAddr.UrlList.includes(video.playAddr))) {
      const h264 = keep.find((b) => /264/.test(String(b.CodecType)));
      if (h264) video.playAddr = h264.PlayAddr.UrlList[0];
    }
    return true;
  }

  // Walks the app's data for video objects (they sit a few levels deep, in
  // lists of posts). Returns true when something changed.
  function filterTikTok(data, quality, depth) {
    if (!data || typeof data !== 'object' || depth > 12) return false;
    if (Array.isArray(data.bitrateInfo)) return filterBitrateInfo(data, quality);
    let changed = false;
    for (const key in data) {
      const v = data[key];
      if (v && typeof v === 'object' && filterTikTok(v, quality, depth + 1)) changed = true;
    }
    return changed;
  }

  function bitrateQuality() {
    const s = current();
    return s && s.enabled && s.bitrateJson && s.videoQuality !== 'auto' ? s.videoQuality : null;
  }

  // The first posts come bundled inside the page rather than from the API,
  // so they never pass through the hooks below. All of the app's data, from
  // either source, is unpacked with JSON.parse, so trim photo sizes and
  // rewrite Meta's MPDs there too.
  // Strings without a "candidates" list pass straight through.
  // Installed only on sites whose settings say they need it (Instagram
  // photos, LinkedIn's player, TikTok), so other sites' JSON.parse calls
  // never run through here. On TikTok, API responses read with
  // response.json() are filtered too.
  function hookParse() {
    if (parseHooked) return;
    parseHooked = true;
    const origParse = JSON.parse;
    JSON.parse = function parse(text, reviver) {
      if (typeof text === 'string' && text.length > 200 && trimImages() && text.includes('"candidates":')) {
        try {
          const r = trimImageCandidates(text, imageTrimMode());
          if (r.changed) text = r.text;
        } catch (_) { /* parse the original */ }
      }
      if (typeof text === 'string' && text.length > 200 && DASH.hasEmbedded(text)) {
        const opts = metaOpts();
        if (opts) {
          try {
            const r = rewriteMetaJson(text, opts);
            if (r !== null) text = r;
          } catch (_) { /* parse the original */ }
        }
      }
      const result = origParse.call(this, text, reviver);
      if (typeof text === 'string' && text.startsWith('{"allowCache"')) {
        try {
          const q = vhsQuality();
          if (q && isVhsList(result)) filterVhsList(result, q);
        } catch (_) { /* leave the list as it is */ }
      }
      if (typeof text === 'string' && text.length > 200 && result && typeof result === 'object') {
        const q = bitrateQuality();
        if (q && text.includes('"bitrateInfo"')) {
          try { filterTikTok(result, q, 0); } catch (_) { /* leave it */ }
        }
      }
      return result;
    };
    if (settings.bitrateJson && typeof Response === 'function' && Response.prototype.json) {
      const RPJ = Response.prototype;
      const origJson = RPJ.json;
      RPJ.json = function () {
        const pending = origJson.apply(this, arguments);
        let mine = false;
        try {
          const u = new URL(this.url, location.href);
          mine = u.origin === location.origin && u.pathname.startsWith('/api/');
        } catch (_) { /* not a URL */ }
        if (!mine) return pending;
        return pending.then((data) => {
          const q = bitrateQuality();
          if (q) { try { filterTikTok(data, q, 0); } catch (_) { /* leave it */ } }
          return data;
        });
      };
    }
  }
  current();
  if (wantsParse()) hookParse();

  function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  // 'hls' | 'dash' | 'json' | null
  function streamKind(url) {
    if (!url) return null;
    try {
      const u = new URL(url, location.href);
      // The site's own API responses that may embed MPDs (same origin only;
      // manifestPaths are path prefixes).
      const paths = (settings && settings.manifestPaths) || [];
      if (paths.length && u.origin === location.origin && paths.some((p) => u.pathname.startsWith(p))) return 'json';
      const hosts = (settings && settings.streamHosts) || [];
      if (!hosts.some((d) => hostMatches(u.hostname, d))) return null;
      if (u.pathname.endsWith('.m3u8')) return 'hls';
      if (u.pathname.endsWith('.mpd')) return 'dash';
    } catch (_) { /* not a URL */ }
    return null;
  }

  // Returns rewritten text, or null when the body is not something we touch.
  function rewrite(kind, text, url) {
    try {
      const opts = {
        quality: settings.videoQuality,
        bestAudio: settings.bestAudio,
        baseUrl: new URL(url, location.href).href,
      };
      if (kind === 'hls' && HLS.isMasterPlaylist(text)) return HLS.rewriteMasterPlaylist(text, opts).text;
      if (kind === 'dash' && DASH.isMpd(text)) return DASH.rewriteMpd(text, opts).text;
      if (kind === 'json') {
        let changed = false;
        if (settings.videoQuality !== 'auto' || settings.bestAudio) {
          const r = rewriteMetaJson(text, opts);
          if (r !== null) { text = r; changed = true; }
        }
        if (trimImages()) {
          const r = trimImageCandidates(text, imageTrimMode());
          if (r.changed) { text = r.text; changed = true; }
        }
        return changed ? text : null;
      }
    } catch (err) {
      console.warn('[Quality Manager] stream rewrite failed', err);
    }
    return null;
  }

  // ---- XMLHttpRequest ---------------------------------------------------
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  XHR.open = function (method, url) {
    try { this.__qmUrl = url instanceof URL ? url.href : String(url); } catch (_) { this.__qmUrl = null; }
    this.__qmIn = this.__qmOut = this.__qmStream = undefined;
    return origOpen.apply(this, arguments);
  };

  // Meta's apps (Threads, Instagram) read their API responses
  // while they are still arriving (readyState 3): one JSON object per line,
  // and each read picks up after the text the previous read returned. So
  // rewrite each complete line once and hand back only complete lines (a
  // half-arrived line waits for the next read). Every read then returns the
  // previous text plus more, as the app expects.
  function streamedJson(xhr, value, url) {
    let state = xhr.__qmStream;
    if (!state || value.length < state.raw) state = xhr.__qmStream = { raw: 0, out: '' };
    const end = xhr.readyState === 4 ? value.length : value.lastIndexOf('\n') + 1;
    if (end > state.raw) {
      const chunk = value.slice(state.raw, end);
      const r = rewrite('json', chunk, url);
      state.out += r === null ? chunk : r;
      state.raw = end;
    }
    return state.out;
  }

  function rewrittenBody(xhr, value) {
    const done = xhr.readyState === 4;
    if (!(done || (xhr.readyState === 3 && typeof value === 'string')) || !active()) return value;
    const url = xhr.responseURL || xhr.__qmUrl;
    const kind = streamKind(url);
    if (!kind) return value;
    if (kind === 'json' && typeof value === 'string') return streamedJson(xhr, value, url);
    if (!done) return value;
    if (xhr.__qmIn === value) return xhr.__qmOut;

    let out = value;
    if (typeof value === 'string') {
      const r = rewrite(kind, value, url);
      if (r !== null) out = r;
    } else if (value instanceof ArrayBuffer) {
      const r = rewrite(kind, new TextDecoder().decode(value), url);
      if (r !== null) out = new TextEncoder().encode(r).buffer;
    }
    xhr.__qmIn = value;
    xhr.__qmOut = out;
    return out;
  }

  for (const prop of ['responseText', 'response']) {
    const desc = Object.getOwnPropertyDescriptor(XHR, prop);
    if (!desc || !desc.get) continue;
    Object.defineProperty(XHR, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const value = desc.get.call(this);
        try { return rewrittenBody(this, value); } catch (_) { return value; }
      },
    });
  }

  // ---- fetch ------------------------------------------------------------
  // Hook where the player reads the body (Response#text / #arrayBuffer)
  // rather than wrapping window.fetch. Wrapping fetch would put this script
  // on the stack of every request the site makes, so the browser would file
  // the site's own fetch warnings under this extension.
  const RP = typeof Response === 'function' && Response.prototype;
  if (RP) {
    const kindOf = (res) => {
      try { return active() && res.ok ? streamKind(res.url) : null; } catch (_) { return null; }
    };
    const origText = RP.text;
    RP.text = function () {
      const pending = origText.apply(this, arguments);
      const kind = kindOf(this);
      if (!kind) return pending;
      const url = this.url;
      return pending.then((text) => {
        const r = rewrite(kind, text, url);
        return r === null ? text : r;
      });
    };
    const origArrayBuffer = RP.arrayBuffer;
    RP.arrayBuffer = function () {
      const pending = origArrayBuffer.apply(this, arguments);
      const kind = kindOf(this);
      if (!kind) return pending;
      const url = this.url;
      return pending.then((buf) => {
        const r = rewrite(kind, new TextDecoder().decode(buf), url);
        return r === null ? buf : new TextEncoder().encode(r).buffer;
      });
    };
    // Players that stream the body (response.body.getReader()).
    let bodyDesc;
    for (let o = RP; o && !bodyDesc; o = Object.getPrototypeOf(o)) bodyDesc = Object.getOwnPropertyDescriptor(o, 'body');
    if (bodyDesc && bodyDesc.get) {
      const streams = new WeakMap();
      Object.defineProperty(RP, 'body', {
        configurable: true,
        enumerable: bodyDesc.enumerable,
        get() {
          const original = bodyDesc.get.call(this);
          if (!original) return original;
          if (streams.has(this)) return streams.get(this);
          const kind = kindOf(this);
          if (!kind) return original;
          const url = this.url;
          const stream = new ReadableStream({
            async start(controller) {
              try {
                const text = await new Response(original).text();
                const r = rewrite(kind, text, url);
                controller.enqueue(new TextEncoder().encode(r === null ? text : r));
                controller.close();
              } catch (err) {
                controller.error(err);
              }
            },
          });
          streams.set(this, stream);
          return stream;
        },
      });
    }
  }
})();
