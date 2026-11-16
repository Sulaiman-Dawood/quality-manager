// Pure HLS master-playlist rewriter. Runs in the page (MAIN world) and is
// also loadable from Node for tests.
//
// X and Reddit serve videos as HLS: a master playlist lists every rendition
// (e.g. 480x270, 640x360, 1280x720, 1920x1080) and the player's adaptive
// bitrate logic picks one -- usually a low one, and it is slow to climb.
// By removing the renditions we don't want before the player sees the
// playlist, we force the quality the user picked.
(function (root) {
  'use strict';
  // Node (tests) only. A page can define its own global `module`/`require`,
  // so never trust those alone: pages have `window` and the service worker
  // has `importScripts`.
  const IS_NODE = typeof window === 'undefined' && typeof importScripts !== 'function' && typeof module === 'object' && module && module.exports;

  const STREAM_INF = '#EXT-X-STREAM-INF:';

  function parseAttrs(str) {
    const out = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let m;
    while ((m = re.exec(str))) {
      let v = m[2];
      if (v.startsWith('"')) v = v.slice(1, -1);
      out[m[1]] = v;
    }
    return out;
  }

  function isMasterPlaylist(text) {
    return typeof text === 'string' &&
      text.trimStart().startsWith('#EXTM3U') &&
      text.includes(STREAM_INF);
  }

  function absolutize(uri, baseUrl) {
    if (!baseUrl) return uri;
    try { return new URL(uri, baseUrl).href; } catch (_) { return uri; }
  }

  function absolutizeUriAttr(line, baseUrl) {
    if (!baseUrl) return line;
    return line.replace(/URI="([^"]*)"/, (_, u) => `URI="${absolutize(u, baseUrl)}"`);
  }

  // "Short side" is what people mean by 1080p/720p, and it keeps portrait
  // videos (e.g. 720x1280) in the right bucket.
  function shortSide(v) {
    if (v.short > 0) return v.short; // e.g. from Meta's FBQualityLabel="720p"
    if (!v.width || !v.height) return 0;
    return Math.min(v.width, v.height);
  }

  function compareVariants(a, b) {
    return (shortSide(a) - shortSide(b)) || (a.bandwidth - b.bandwidth);
  }

  function pickVariant(variants, quality) {
    const sorted = variants.slice().sort(compareVariants);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    if (quality === 'max') return highest;
    if (quality === 'min') return lowest;
    const cap = parseInt(quality, 10);
    if (!cap) return null;
    let best = null;
    for (const v of sorted) if (shortSide(v) <= cap) best = v;
    return best || lowest;
  }

  /**
   * @param {string} text      master playlist body
   * @param {object} opts
   * @param {string} opts.quality   'auto' | 'max' | 'min' | '1080' | '720' ...
   * @param {boolean} opts.bestAudio  switch kept renditions to the best audio group
   * @param {string} [opts.baseUrl]  playlist URL, used to make URIs absolute
   * @returns {{text: string, changed: boolean, chosen: object|null}}
   */
  function rewriteMasterPlaylist(text, opts) {
    const quality = (opts && opts.quality) || 'auto';
    const bestAudio = !!(opts && opts.bestAudio);
    const baseUrl = opts && opts.baseUrl;

    if (!isMasterPlaylist(text)) return { text, changed: false, chosen: null };
    if (quality === 'auto' && !bestAudio) return { text, changed: false, chosen: null };

    const lines = text.split(/\r?\n/);
    const header = [];       // everything that is not a variant entry
    const variants = [];
    const audioGroups = [];  // { id, bitrate }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith(STREAM_INF)) {
        // The URI is the next non-blank, non-tag line.
        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) j++;
        if (j >= lines.length) { header.push(line); continue; }
        const attrs = parseAttrs(line.slice(STREAM_INF.length));
        const res = (attrs.RESOLUTION || '').split('x');
        variants.push({
          inf: line,
          uri: lines[j].trim(),
          bandwidth: parseInt(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH, 10) || 0,
          width: parseInt(res[0], 10) || 0,
          height: parseInt(res[1], 10) || 0,
          audio: attrs.AUDIO || null,
        });
        i = j;
        continue;
      }
      if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = parseAttrs(line.slice('#EXT-X-MEDIA:'.length));
        if (attrs.TYPE === 'AUDIO' && attrs['GROUP-ID']) {
          // X names groups like "audio-128000"; fall back to file order.
          const n = parseInt((attrs['GROUP-ID'].match(/(\d+)/) || [])[1], 10);
          audioGroups.push({ id: attrs['GROUP-ID'], bitrate: isNaN(n) ? audioGroups.length : n });
        }
        header.push(absolutizeUriAttr(line, baseUrl));
        continue;
      }
      if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
        header.push(absolutizeUriAttr(line, baseUrl));
        continue;
      }
      header.push(line);
    }

    if (!variants.length) return { text, changed: false, chosen: null };

    let kept = variants;
    let chosen = null;
    if (quality !== 'auto') {
      chosen = pickVariant(variants, quality);
      if (chosen) kept = [chosen];
    }

    let bestGroup = null;
    if (bestAudio && audioGroups.length) {
      bestGroup = audioGroups.reduce((a, b) => (b.bitrate > a.bitrate ? b : a)).id;
    }

    // Drop trailing blank lines from the header so output stays tidy.
    while (header.length && header[header.length - 1].trim() === '') header.pop();

    const out = header.slice();
    for (const v of kept) {
      let inf = v.inf;
      if (bestGroup && v.audio && v.audio !== bestGroup) {
        inf = inf.replace(/AUDIO="[^"]*"/, `AUDIO="${bestGroup}"`);
      }
      out.push(inf, absolutize(v.uri, baseUrl));
    }
    out.push('');

    return { text: out.join('\n'), changed: true, chosen };
  }

  const api = { rewriteMasterPlaylist, isMasterPlaylist, parseAttrs, pickVariant, shortSide };
  if (IS_NODE) module.exports = api;
  else root.__QM_HLS__ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
