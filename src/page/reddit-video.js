// Runs in Reddit's page world (MAIN) at document_start, after
// hls-rewrite.js. Reddit's player (<shreddit-player-2>) usually doesn't use
// its HLS playlist: it plays a ready-made MP4 from packaged-media.redd.it,
// picked from a list in its `packaged-media-json` attribute, e.g.
//   {"playbackMp4s":{"permutations":[
//     {"source":{"url":".../m2-res_480p.mp4?...","dimensions":{"width":480,"height":854}}}, ...]}}
// We trim that list to the one MP4 the user's setting picks, before the
// player reads it.
(function () {
  'use strict';
  if (window.__QM_REDDIT_VIDEO__) return;

  const HLS = window.__QM_HLS__;
  if (!HLS) return;

  const ATTR = 'packaged-media-json';
  const TAGS = new Set(['shreddit-player', 'shreddit-player-2']);

  // Settings mirrored by the isolated-world bridge (see stream-hook.js).
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
  window.addEventListener('qm-settings', (e) => { current(); loadSettings(e.detail); });

  function wantedQuality() {
    const s = current();
    return s && s.enabled && s.videoQuality && s.videoQuality !== 'auto' ? s.videoQuality : null;
  }

  function isPermutation(p) {
    const d = p && p.source && p.source.dimensions;
    return !!(d && typeof p.source.url === 'string' && d.width > 0 && d.height > 0);
  }

  // Returns the JSON with every list of MP4 permutations cut down to the
  // chosen one, or the input unchanged if there's nothing to pick.
  function filterJson(raw, quality) {
    if (!raw || !quality) return raw;
    let data;
    try { data = JSON.parse(raw); } catch (_) { return raw; }
    let changed = false;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value) && value.length > 1 && value.every(isPermutation)) {
          const variants = value.map((p, i) => ({
            width: +p.source.dimensions.width, height: +p.source.dimensions.height, bandwidth: 0, i,
          }));
          const chosen = HLS.pickVariant(variants, quality);
          if (chosen) { node[key] = [value[chosen.i]]; changed = true; }
        } else {
          walk(value);
        }
      }
    })(data);
    return changed ? JSON.stringify(data) : raw;
  }

  // Server-rendered players: fix the attribute as soon as the parser adds
  // it, before Reddit's scripts define and upgrade the element.
  function fixElement(el) {
    if (!el || !TAGS.has(el.localName) || !el.hasAttribute(ATTR)) return;
    const raw = el.getAttribute(ATTR);
    const out = filterJson(raw, wantedQuality());
    if (out !== raw) el.setAttribute(ATTR, out);
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') fixElement(r.target);
        else for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          fixElement(n);
          if (n.querySelectorAll) for (const p of n.querySelectorAll('shreddit-player, shreddit-player-2')) fixElement(p);
        }
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: [ATTR] });
  }

  // Players Reddit creates later (feeds, navigation): filter the value on its
  // way into the element, whatever DOM tree it lives in.
  if (window.customElements && typeof customElements.define === 'function') {
    const origDefine = customElements.define;
    customElements.define = function (name, ctor) {
      try {
        const proto = ctor && ctor.prototype;
        if (TAGS.has(name) && proto && typeof proto.attributeChangedCallback === 'function') {
          const orig = proto.attributeChangedCallback;
          proto.attributeChangedCallback = function (attr, oldValue, newValue) {
            if (attr === ATTR) {
              try { newValue = filterJson(newValue, wantedQuality()); } catch (_) {}
            }
            return orig.call(this, attr, oldValue, newValue);
          };
        }
      } catch (_) { /* never break the site's element */ }
      return origDefine.apply(this, arguments);
    };
  }

  window.__QM_REDDIT_VIDEO__ = { filterJson };
})();
