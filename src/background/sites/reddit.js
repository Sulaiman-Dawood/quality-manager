// Reddit image rules for declarativeNetRequest.
// Registers into self.QM_SITE_RULES.reddit; see background.js.
//
// Reddit shows resized, re-encoded previews from preview.redd.it, e.g.
//   https://preview.redd.it/abc123xyz.jpg?width=640&crop=smart&auto=webp&s=<sig>
//   https://preview.redd.it/some-post-title-v0-abc123xyz.png?width=1080&...
// The uploaded original lives at https://i.redd.it/abc123xyz.jpg. The `s=`
// signature means we can't ask preview.redd.it for a bigger size, but the
// original needs no signature, so we redirect to it.
(function (root) {
  'use strict';

  // GIFs are left alone: their previews are static stills or MP4s, and the
  // original would turn every still into a (large) animation.
  const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
  const PREVIEW = '^https://preview\\.redd\\.it/';

  function redirectRule(regexFilter, regexSubstitution) {
    return {
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution } },
      condition: { regexFilter, isUrlFilterCaseSensitive: true, resourceTypes: ['image'] },
    };
  }

  // Two small regexes per extension (no alternation, literal prefix outside
  // groups -- see the RE2 2KB note in x.js). The trailing `\?.*` consumes
  // the query, since regexSubstitution only replaces the matched part.
  function buildRules(s) {
    if (s.reddit_images !== 'orig') return [];
    const rules = [];
    for (const ext of EXTS) {
      // Plain id: abc123xyz.jpg
      rules.push(redirectRule(`${PREVIEW}([a-z0-9]+)\\.${ext}\\?.*`, `https://i.redd.it/\\1.${ext}`));
      // Slugged: some-post-title-v0-abc123xyz.jpg. Anchored on `-v0-` in a
      // top-level name, so paths like snoovatar/avatars/<uuid>-headshot.png
      // (avatars, which have no i.redd.it original) are left alone.
      rules.push(redirectRule(`${PREVIEW}[^/]*-v0-([a-z0-9]+)\\.${ext}\\?.*`, `https://i.redd.it/\\1.${ext}`));
    }
    return rules;
  }

  function originalImageUrl(src) {
    const u = new URL(src);
    let file = null;
    if (u.hostname === 'i.redd.it') file = u.pathname.slice(1);
    else if (u.hostname === 'preview.redd.it') file = u.pathname.slice(1).replace(/^.*-v0-/, '');
    if (!file || !/^[a-z0-9]+\.[a-z0-9]+$/i.test(file)) return null;
    return { url: 'https://i.redd.it/' + file, filename: file };
  }

  root.QM_SITE_RULES = root.QM_SITE_RULES || {};
  root.QM_SITE_RULES.reddit = {
    buildRules,
    originalImageUrl,
    imagePatterns: ['https://preview.redd.it/*', 'https://i.redd.it/*'],
  };
})(typeof self !== 'undefined' ? self : globalThis);
