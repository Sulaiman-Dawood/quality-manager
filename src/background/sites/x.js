// X (Twitter) image rules for declarativeNetRequest.
// Registers into self.QM_SITE_RULES.x; see background.js.
(function (root) {
  'use strict';

  // Quality ranking of the `name=` sizes pbs.twimg.com understands. Normal
  // choices only upgrade (rewrite sizes ranked below the target); Data saver
  // ('small') is the one downgrade (rewrites sizes ranked above it).
  const RANK = {
    thumb: 0, '120x120': 0, '240x240': 1, '360x360': 2, small: 2,
    medium: 3, '900x900': 3, large: 4, '4096x4096': 5, orig: 6,
  };
  // Sizes X requests (the timeline now asks for `large` itself); a rule only
  // ever upgrades those ranked below the chosen size.
  const FEED_SIZES = ['thumb', '120x120', '240x240', '360x360', 'small', 'medium', '900x900', 'large', '4096x4096'];
  const BIG_SIZES = ['medium', '900x900', 'large', '4096x4096', 'orig'];
  const FORMATS = ['jpg', 'png', 'webp'];
  // urlFilter prefixes (no regex). Timeline images include video thumbnails.
  const FEED_PATHS = ['||pbs.twimg.com/media/', '||pbs.twimg.com/*_video_thumb/'];

  function upgradeFrom(sources, target) {
    return sources.filter((s) => RANK[s] < RANK[target]);
  }
  function downgradeFrom(sources, target) {
    return sources.filter((s) => RANK[s] > RANK[target]);
  }

  function redirectRule(action, condition) {
    return {
      priority: 1,
      action: { type: 'redirect', redirect: action },
      condition: Object.assign({ isUrlFilterCaseSensitive: true, resourceTypes: ['image'] }, condition),
    };
  }

  // X always writes image URLs as `?format=jpg&name=small`. Redirects emit
  // `?name=large&format=jpg` instead (pbs.twimg.com accepts either order but
  // rejects unknown params). Filters only match the format-first order, so a
  // redirected URL can never be caught again and redirected in a loop.
  //
  // Plain urlFilters with a static replacement query, one per
  // (path, size, format), so there is no regex for RE2 to compile.
  function nameRules(paths, sizes, target, withExtForm) {
    const rules = [];
    for (const size of sizes) {
      for (const path of paths) {
        for (const fmt of FORMATS) {
          // X requests images as WebP, but an original only exists in its
          // upload format: `format=webp&name=orig` fails. Ask for JPG (most
          // uploads); the page retries any that still fail (see bridge.js).
          const outFmt = target === 'orig' && fmt === 'webp' ? 'jpg' : fmt;
          rules.push(redirectRule(
            { transform: { query: `?name=${target}&format=${outFmt}` } },
            { urlFilter: `${path}*?format=${fmt}&name=${size}|` },
          ));
        }
        // Older form with the extension in the path: /img/abc.jpg?name=small.
        if (withExtForm) {
          rules.push(redirectRule(
            { transform: { query: `?name=${target}` } },
            { urlFilter: `${path}*.*?name=${size}|` },
          ));
        }
      }
    }
    return rules;
  }

  function buildRules(s) {
    const rules = [];
    if (s.x_feedImages === 'small') {
      // Data saver. X's full-screen viewer uses the same /media/ URLs, so
      // it gets the small size too; that's the trade-off.
      rules.push(...nameRules(FEED_PATHS, downgradeFrom(BIG_SIZES, 'small'), 'small', true));
    } else if (s.x_feedImages !== 'default') {
      rules.push(...nameRules(FEED_PATHS, upgradeFrom(FEED_SIZES, s.x_feedImages), s.x_feedImages, true));
    }
    return rules;
  }

  root.QM_SITE_RULES = root.QM_SITE_RULES || {};
  root.QM_SITE_RULES.x = {
    buildRules,
  };
})(typeof self !== 'undefined' ? self : globalThis);
