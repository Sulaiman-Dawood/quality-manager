// Runs in the page's own JS world (MAIN) at document_start, before the
// site's player code, on sites that stream HLS/DASH (X, Reddit, Instagram).
// Intercepts master playlists / MPDs the player fetches -- or, on Instagram,
// the API responses that carry MPDs inside their JSON -- and rewrites them
// to the quality the user chose.
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
    if (settings && settings.imageData) hookParse();
  });

  function active() {
    const s = current();
    return !!(s && s.enabled && (s.videoQuality !== 'auto' || s.bestAudio || trimImages()));
  }

  function trimImages() {
    const s = current();
    return !!(s && s.enabled && s.imageData && s.images === 'small');
  }

  // ---- Instagram image data saver ------------------------------------------
  // Photos have no srcset on Instagram: the app picks one URL from each
  // photo's "candidates" list in its API data (often 1080px or far larger,
  // for a ~470px slot). With Data saver, drop every candidate wider than
  // IMAGE_CAP so the app can only pick a small one. A list with nothing
  // small enough keeps just its smallest entry, so no photo goes missing.
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

  function trimImageCandidates(text) {
    if (typeof text !== 'string' || !text.includes('"candidates":')) return { text, changed: false };
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
          let keep = list.filter((c) => c.width <= IMAGE_CAP);
          if (!keep.length) keep = [list.reduce((a, b) => (b.width < a.width ? b : a))];
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

  // The first posts come bundled inside the page rather than from the API,
  // so they never pass through the hooks below. All of the app's data, from
  // either source, is unpacked with JSON.parse, so trim photo sizes there.
  // Strings without a "candidates" list pass straight through.
  // Installed only on sites whose settings say they carry photo data
  // (Instagram), so other sites' JSON.parse calls never run through here.
  function hookParse() {
    if (parseHooked) return;
    parseHooked = true;
    const origParse = JSON.parse;
    JSON.parse = function parse(text, reviver) {
      if (typeof text === 'string' && text.length > 200 && trimImages() && text.includes('"candidates":')) {
        try {
          const r = trimImageCandidates(text);
          if (r.changed) text = r.text;
        } catch (_) { /* parse the original */ }
      }
      return origParse.call(this, text, reviver);
    };
  }
  if (current() && settings.imageData) hookParse();

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
          const r = DASH.rewriteEmbedded(text, opts);
          if (r.changed) { text = r.text; changed = true; }
        }
        if (trimImages()) {
          const r = trimImageCandidates(text);
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
    this.__qmIn = this.__qmOut = undefined;
    return origOpen.apply(this, arguments);
  };

  function rewrittenBody(xhr, value) {
    if (xhr.readyState !== 4 || !active()) return value;
    const url = xhr.responseURL || xhr.__qmUrl;
    const kind = streamKind(url);
    if (!kind) return value;
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
