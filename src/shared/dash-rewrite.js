// Pure DASH (MPD) rewriter -- the DASH counterpart of hls-rewrite.js.
// Reddit offers DASHPlaylist.mpd alongside HLS; Instagram (Meta) embeds the
// MPD as a string inside its API JSON ("video_dash_manifest"). Each video
// AdaptationSet lists one Representation per resolution; we keep only the
// one the user picked (and the best audio Representation when bestAudio is
// on). String-based so it runs in the page and in Node tests alike.
(function (root) {
  'use strict';
  // Node (tests) only. A page can define its own global `module`/`require`,
  // so never trust those alone: pages have `window` and the service worker
  // has `importScripts`.
  const IS_NODE = typeof window === 'undefined' && typeof importScripts !== 'function' && typeof module === 'object' && module && module.exports;

  const HLS = IS_NODE
    ? require('./hls-rewrite.js')
    : root.__QM_HLS__;

  const ADAPTATION_RE = /<AdaptationSet\b[^>]*>[\s\S]*?<\/AdaptationSet>/g;
  const REPRESENTATION_RE = /[ \t]*<Representation\b[^>]*?(?:\/>|>[\s\S]*?<\/Representation>)[ \t]*\r?\n?/g;

  function attr(tag, name) {
    const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
    return m ? m[1] : null;
  }

  function isMpd(text) {
    return typeof text === 'string' && /<MPD[\s>]/.test(text) && text.includes('<Representation');
  }

  function openingTag(block) {
    return block.slice(0, block.indexOf('>') + 1);
  }

  function kindOf(setOpen, reps) {
    const ct = attr(setOpen, 'contentType') || '';
    const mime = attr(setOpen, 'mimeType') || attr(openingTag(reps[0] || ''), 'mimeType') || '';
    if (ct === 'video' || mime.startsWith('video/')) return 'video';
    if (ct === 'audio' || mime.startsWith('audio/')) return 'audio';
    if (reps.some((r) => attr(openingTag(r), 'height'))) return 'video';
    return 'other';
  }

  /**
   * @returns {{text: string, changed: boolean}}
   */
  function rewriteMpd(text, opts) {
    const quality = (opts && opts.quality) || 'auto';
    const bestAudio = !!(opts && opts.bestAudio);
    if (!isMpd(text)) return { text, changed: false };
    if (quality === 'auto' && !bestAudio) return { text, changed: false };

    let changed = false;
    const out = text.replace(ADAPTATION_RE, (set) => {
      const reps = set.match(REPRESENTATION_RE) || [];
      if (reps.length < 2) return set;
      const setOpen = openingTag(set);
      const kind = kindOf(setOpen, reps);

      let keep = null;
      if (kind === 'video' && quality !== 'auto') {
        const variants = reps.map((r) => {
          const tag = openingTag(r.trim());
          return {
            block: r,
            width: parseInt(attr(tag, 'width') || attr(setOpen, 'width'), 10) || 0,
            height: parseInt(attr(tag, 'height') || attr(setOpen, 'height'), 10) || 0,
            bandwidth: parseInt(attr(tag, 'bandwidth'), 10) || 0,
            // Meta labels each rendition ("720p" = short side) and its
            // width/height can be the display size, not the encoded one.
            short: parseInt((attr(tag, 'FBQualityLabel') || '').replace(/p$/, ''), 10) || 0,
          };
        });
        const chosen = HLS.pickVariant(variants, quality);
        if (chosen) keep = chosen.block;
      } else if (kind === 'audio' && bestAudio) {
        keep = reps.reduce((a, b) =>
          (parseInt(attr(openingTag(b.trim()), 'bandwidth'), 10) || 0) >
          (parseInt(attr(openingTag(a.trim()), 'bandwidth'), 10) || 0) ? b : a);
      }
      if (!keep) return set;

      changed = true;
      return set.replace(REPRESENTATION_RE, (r) => (r === keep ? r : ''));
    });

    return { text: out, changed };
  }

  // MPDs embedded as JSON string values, e.g. Instagram's
  //   {"video_dash_manifest":"<?xml ...?>\n<MPD ...>...</MPD>", ...}
  // Each one is decoded, rewritten and re-encoded in place; the rest of the
  // response is left byte-for-byte as it was.
  const EMBEDDED_RE = /"(video_dash_manifest|dash_manifest)":"((?:[^"\\]|\\.)*)"/g;

  function rewriteEmbedded(text, opts) {
    if (typeof text !== 'string' || !text.includes('dash_manifest"')) return { text, changed: false, count: 0 };
    let count = 0;
    const out = text.replace(EMBEDDED_RE, (whole, key, literal) => {
      let xml;
      try { xml = JSON.parse('"' + literal + '"'); } catch (_) { return whole; }
      const r = rewriteMpd(xml, opts);
      if (!r.changed) return whole;
      count++;
      return '"' + key + '":' + JSON.stringify(r.text);
    });
    return { text: out, changed: count > 0, count };
  }

  const api = { rewriteMpd, rewriteEmbedded, isMpd };
  if (IS_NODE) module.exports = api;
  else root.__QM_DASH__ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
