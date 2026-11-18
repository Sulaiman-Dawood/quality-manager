// Turns the Chrome/Edge manifest into Firefox's. Used by tools/build.mjs and
// the tests. Firefox differences:
// - The background runs as a page script, not a service worker, so the
//   helper files it would import are listed first.
// - Firefox needs an add-on ID, and AMO asks what data the add-on collects
//   (none).
// - Content scripts that run in the page's own world need Firefox 128+.
// - The data collection declaration requires Firefox 140+ (Android 142+).
'use strict';

const GECKO_ID = '{fc115e24-c166-42f9-9a74-9da36011f3fe}';
const BACKGROUND_SCRIPTS = [
  'src/shared/config.js',
  'src/background/sites/x.js',
  'src/background/sites/reddit.js',
  'src/background/sites/bluesky.js',
  'src/background/background.js',
];

function firefoxManifest(chrome) {
  const m = JSON.parse(JSON.stringify(chrome));
  m.background = { scripts: BACKGROUND_SCRIPTS };
  m.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    },
    gecko_android: {
      strict_min_version: '142.0',
    },
  };
  return m;
}

module.exports = { firefoxManifest, GECKO_ID, BACKGROUND_SCRIPTS };
