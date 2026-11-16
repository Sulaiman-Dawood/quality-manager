// Shared configuration: default settings and the site registry.
// Loaded as a classic script by the service worker (importScripts), the popup
// and the isolated-world bridge. The page (MAIN world) hooks don't load it:
// Chrome injects each file only once per page, so a file listed for both
// worlds runs in just one of them. The bridge sends the hooks what they need
// (see pageSettings). It must not use any chrome.* API.
(function (root) {
  'use strict';
  // Node (tests) only. A page can define its own global `module`/`require`,
  // so never trust those alone: pages have `window` and the service worker
  // has `importScripts`.
  const IS_NODE = typeof window === 'undefined' && typeof importScripts !== 'function' && typeof module === 'object' && module && module.exports;

  const DEFAULTS = Object.freeze({
    // Global
    enabled: true,
    bestAudio: true,   // highest-bitrate audio track (HLS/DASH sites)
    showBadge: true,   // resolution badge on videos (X, Reddit, Instagram)

    // X
    x_enabled: true,
    x_videoQuality: 'max',
    x_feedImages: 'default',    // 'orig' (Highest) | 'small' (Data saver) | 'default'

    // Reddit
    reddit_enabled: true,
    reddit_videoQuality: 'max',
    reddit_images: 'orig',      // 'orig' (Highest) | 'small' (Data saver) | 'default'

    // YouTube
    youtube_enabled: true,
    youtube_videoQuality: 'max',

    // Instagram
    instagram_enabled: true,
    instagram_videoQuality: 'max',
    instagram_images: 'default', // 'small' | 'default'
  });

  // Video quality values shared by every site:
  // 'auto' (site default), 'max', a height cap like '1080', or 'min'.
  const SITES = Object.freeze({
    x: {
      label: 'X',
      hosts: ['x.com', 'twitter.com'],
      streamHosts: ['video.twimg.com'],
    },
    reddit: {
      label: 'Reddit',
      hosts: ['reddit.com'],
      streamHosts: ['v.redd.it'],
    },
    youtube: {
      label: 'YouTube',
      hosts: ['youtube.com', 'youtube-nocookie.com'],
      streamHosts: [],
    },
    instagram: {
      label: 'Instagram',
      hosts: ['instagram.com'],
      streamHosts: [],
      // Path prefixes of same-origin API responses that can carry each
      // video's MPD ("video_dash_manifest"): GraphQL for feeds and Reels,
      // /api/v1/... for profiles, Explore and others. The stream hook
      // rewrites any MPD it finds there and leaves other responses alone.
      manifestPaths: ['/api/', '/graphql'],
      // Photo sizes come as "candidates" lists in the app's data; the image
      // data saver trims them (see stream-hook.js).
      imageData: true,
    },
  });

  function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  function siteForHost(hostname) {
    for (const [id, site] of Object.entries(SITES)) {
      if (site.hosts.some((d) => hostMatches(hostname, d))) return id;
    }
    return null;
  }

  // The slice of settings a page hook needs for one site.
  function pageSettings(all, siteId) {
    return {
      enabled: !!(all.enabled && all[siteId + '_enabled']),
      videoQuality: all[siteId + '_videoQuality'] || 'auto',
      bestAudio: !!all.bestAudio,
      images: all[siteId + '_images'] || 'default',
      imageData: !!(SITES[siteId] && SITES[siteId].imageData),
      streamHosts: (SITES[siteId] && SITES[siteId].streamHosts) || [],
      manifestPaths: (SITES[siteId] && SITES[siteId].manifestPaths) || [],
    };
  }

  // Settings from version 1 (X only) used unprefixed keys.
  const LEGACY_X_KEYS = ['videoQuality', 'feedImages', 'viewerImages', 'avatars', 'banners'];
  // Settings that no longer exist (X full-screen images, profile pictures
  // and banners were removed); cleared from storage on update.
  const OBSOLETE_KEYS = ['x_viewerImages', 'x_avatars', 'x_banners'];
  const RETIRED = {
    videoQuality: { 2160: 'max', 1440: 'max', 360: '480' },
    x_feedImages: { medium: 'default', large: 'default', '4096x4096': 'orig' },
    reddit_images: { large: 'default' },
  };

  function migrateLegacy(stored) {
    const set = {};
    const remove = [];
    for (const key of LEGACY_X_KEYS) {
      if (key in stored) {
        const next = 'x_' + key;
        if (next in DEFAULTS && !(next in stored)) set[next] = stored[key];
        remove.push(key);
      }
    }
    for (const key of OBSOLETE_KEYS) if (key in stored) remove.push(key);
    // Options that were removed to simplify the popup move to the nearest one.
    for (const [key, value] of Object.entries(stored)) {
      const map = key.endsWith('_videoQuality') ? RETIRED.videoQuality : RETIRED[key];
      if (map && value in map && !(key in set)) set[key] = map[value];
    }
    return { set, remove };
  }

  const api = Object.freeze({ DEFAULTS, SITES, siteForHost, hostMatches, pageSettings, migrateLegacy });
  if (IS_NODE) module.exports = api;
  else root.QM_CONFIG = api;
})(typeof self !== 'undefined' ? self : globalThis);
