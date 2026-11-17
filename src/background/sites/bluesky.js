// Bluesky image rules for declarativeNetRequest.
// Registers into self.QM_SITE_RULES.bluesky; see background.js.
//
// Feed photos are served as 1000px-max previews:
//   https://cdn.bsky.app/img/feed_thumbnail/plain/<did>/<cid>@jpeg
// and the same photo at full size (as uploaded, often 2000-4000px) lives at
// feed_fullsize.
// "Highest" swaps one for the other. There is no smaller preset for post
// photos, so there is no data saver.
(function (root) {
  'use strict';

  function buildRules(s) {
    if (s.bluesky_images !== 'orig') return [];
    return [{
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: 'https://cdn.bsky.app/img/feed_fullsize/\\1' } },
      condition: {
        regexFilter: '^https://cdn\\.bsky\\.app/img/feed_thumbnail/(plain/.*)',
        isUrlFilterCaseSensitive: true,
        resourceTypes: ['image'],
      },
    }];
  }

  root.QM_SITE_RULES = root.QM_SITE_RULES || {};
  root.QM_SITE_RULES.bluesky = {
    buildRules,
  };
})(typeof self !== 'undefined' ? self : globalThis);
