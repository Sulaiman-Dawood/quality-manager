// Runs in YouTube's page world (MAIN). YouTube's video format can't be
// rewritten like HLS, but its player exposes a quality API, so we ask it for
// the chosen quality once per video. If you then pick a quality by hand
// from the gear menu, we leave it alone until the next video.
(function () {
  'use strict';
  if (window.__QM_YT_HOOKED__) return;
  window.__QM_YT_HOOKED__ = true;

  // Settings come from the isolated-world bridge (see stream-hook.js).
  // Until they arrive, do nothing.
  const STORAGE_KEY = '__qm_settings';
  let settings = { enabled: false };
  let loaded = false;
  let generation = 0; // bumps when settings change, so videos get re-applied

  function loadSettings(raw) {
    try {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        settings = Object.assign({}, settings, s);
        loaded = true;
        generation++;
      }
    } catch (_) { /* keep previous */ }
  }
  try { loadSettings(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
  window.addEventListener('qm-settings', (e) => { loadSettings(e.detail); tick(); });

  // YouTube's quality names and the height each one means.
  const HEIGHT = {
    tiny: 144, small: 240, medium: 360, large: 480, hd720: 720,
    hd1080: 1080, hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320,
  };

  // Qualities this viewer can actually play. "1080p Premium" shares the
  // hd1080 name but is pay-gated, so it's filtered out unless playable.
  function playableQualities(player) {
    let list = [];
    try {
      if (typeof player.getAvailableQualityData === 'function') {
        list = player.getAvailableQualityData()
          .filter((d) => d && d.isPlayable !== false && !d.paygatedQualityDetails)
          .map((d) => d.quality);
      }
      if (!list.length && typeof player.getAvailableQualityLevels === 'function') {
        list = player.getAvailableQualityLevels();
      }
    } catch (_) { return []; }
    return [...new Set(list)].filter((q) => q in HEIGHT).sort((a, b) => HEIGHT[a] - HEIGHT[b]);
  }

  function pickQuality(qualities, wanted) {
    if (!qualities.length) return null;
    if (wanted === 'max') return qualities[qualities.length - 1];
    if (wanted === 'min') return qualities[0];
    const cap = parseInt(wanted, 10);
    if (!cap) return null;
    let best = null;
    for (const q of qualities) if (HEIGHT[q] <= cap) best = q;
    return best || qualities[0];
  }

  const applied = new WeakMap(); // player -> "videoId|generation"

  function applyTo(player) {
    if (typeof player.setPlaybackQualityRange !== 'function') return;
    if (player.classList.contains('ad-showing')) return; // wait for the real video
    let videoId = null;
    try { videoId = player.getVideoData && player.getVideoData().video_id; } catch (_) {}
    if (!videoId) return;

    const key = videoId + '|' + generation;
    if (applied.get(player) === key) return;

    const target = pickQuality(playableQualities(player), settings.videoQuality);
    if (!target) return; // qualities not loaded yet; try again next tick
    try {
      player.setPlaybackQualityRange(target, target);
      if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(target);
      applied.set(player, key);
    } catch (err) {
      console.warn('[Quality Manager] could not set YouTube quality', err);
    }
  }

  function tick() {
    if (!loaded) { try { loadSettings(localStorage.getItem(STORAGE_KEY)); } catch (_) {} }
    if (!settings.enabled || settings.videoQuality === 'auto') return;
    // Watch page / embeds use #movie_player; Shorts use #shorts-player.
    // Hover previews on the home page are skipped on purpose.
    for (const id of ['movie_player', 'shorts-player']) {
      const player = document.getElementById(id);
      if (player) applyTo(player);
    }
  }

  // YouTube is a single-page app: catch navigations, plus a light poll for
  // the moment the player finishes loading a video's quality list.
  document.addEventListener('yt-navigate-finish', tick);
  document.addEventListener('yt-player-updated', tick);
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
})();
