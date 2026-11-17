// Run with: node test/run-tests.js
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
// Captured before any fake page loads, to prove the hooks don't leak out.
const NODE_RESPONSE_TEXT = Response.prototype.text;
const NODE_RESPONSE_ARRAYBUFFER = Response.prototype.arrayBuffer;

const SRC = path.join(__dirname, '../src');
const CONFIG = require('../src/shared/config.js');
const { rewriteMasterPlaylist } = require('../src/shared/hls-rewrite.js');
const { rewriteMpd, rewriteEmbedded } = require('../src/shared/dash-rewrite.js');

let passed = 0;
const queue = [];
// Tests are queued and awaited one by one so async tests are checked too.
function test(name, fn) { queue.push([name, fn]); }
function section(title) { queue.push([null, title]); }
async function runQueued() {
  for (const [name, fn] of queue) {
    if (name === null) { console.log(fn); continue; }
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; }
  }
}

function streams(text) {
  return text.split('\n').filter((l) => l && !l.startsWith('#'));
}

// =========================================================================
section('HLS rewrite');

const BASE = 'https://video.twimg.com/amplify_video/1/pl/abc.m3u8?variant_version=1&tag=14';
const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-32000",AUTOSELECT=YES,URI="/amplify_video/1/pl/mp4a/32000/a.m3u8"
#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",AUTOSELECT=YES,URI="/amplify_video/1/pl/mp4a/64000/b.m3u8"
#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",AUTOSELECT=YES,URI="/amplify_video/1/pl/mp4a/128000/c.m3u8"
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=287000,BANDWIDTH=345000,RESOLUTION=480x270,CODECS="mp4a.40.2,avc1.4d001e",AUDIO="audio-32000"
/amplify_video/1/pl/avc1/480x270/v1.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=800000,BANDWIDTH=950000,RESOLUTION=640x360,CODECS="mp4a.40.2,avc1.4d001f",AUDIO="audio-64000"
/amplify_video/1/pl/avc1/640x360/v2.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2100000,BANDWIDTH=2600000,RESOLUTION=1280x720,CODECS="mp4a.40.2,avc1.640020",AUDIO="audio-128000"
/amplify_video/1/pl/avc1/1280x720/v3.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=8000000,BANDWIDTH=10000000,RESOLUTION=1920x1080,CODECS="mp4a.40.2,avc1.640032",AUDIO="audio-128000"
/amplify_video/1/pl/avc1/1920x1080/v4.m3u8
`;

const PORTRAIT = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=320x568
p1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=720x1280
p2.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1080x1920
p3.m3u8
`;

// Reddit-style master: relative rendition names, audio as EXT-X-MEDIA.
const REDDIT_BASE = 'https://v.redd.it/abc123/HLSPlaylist.m3u8?a=1700000000%2Csig&v=1&f=sd';
const REDDIT_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="0",NAME="Audio 1",DEFAULT=YES,AUTOSELECT=YES,URI="HLS_AUDIO_64.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="1",NAME="Audio 2",DEFAULT=YES,AUTOSELECT=YES,URI="HLS_AUDIO_128.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",AUDIO="0"
HLS_240.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="0"
HLS_360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="1"
HLS_720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="1"
HLS_1080.m3u8
`;

test('max keeps only 1080p, absolute URL', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: 'max', baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/avc1/1920x1080/v4.m3u8']);
  assert.match(r.text, /URI="https:\/\/video\.twimg\.com\/amplify_video\/1\/pl\/mp4a\/128000\/c\.m3u8"/);
  assert.match(r.text, /^#EXTM3U/);
});

test('cap 720 picks 1280x720', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: '720', baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/avc1/1280x720/v3.m3u8']);
});

test('cap 480 picks 360p (no 480 rendition)', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: '480', baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/avc1/640x360/v2.m3u8']);
});

test('cap below everything falls back to lowest', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: '144', baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/avc1/480x270/v1.m3u8']);
});

test('min picks lowest and bestAudio upgrades its audio group', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: 'min', bestAudio: true, baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/avc1/480x270/v1.m3u8']);
  assert.match(r.text, /RESOLUTION=480x270.*AUDIO="audio-128000"/);
});

test('auto without bestAudio leaves playlist untouched', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: 'auto', bestAudio: false });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, MASTER);
});

test('auto with bestAudio keeps all renditions', () => {
  const r = rewriteMasterPlaylist(MASTER, { quality: 'auto', bestAudio: true, baseUrl: BASE });
  assert.strictEqual(streams(r.text).length, 4);
  assert.ok(!r.text.includes('AUDIO="audio-32000"'));
});

test('portrait video: 1080 cap uses short side', () => {
  const r = rewriteMasterPlaylist(PORTRAIT, { quality: '1080', baseUrl: BASE });
  assert.deepStrictEqual(streams(r.text), ['https://video.twimg.com/amplify_video/1/pl/p3.m3u8']);
  const r2 = rewriteMasterPlaylist(PORTRAIT, { quality: '720', baseUrl: BASE });
  assert.deepStrictEqual(streams(r2.text), ['https://video.twimg.com/amplify_video/1/pl/p2.m3u8']);
});

test('media playlists are not touched', () => {
  const media = '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3.0,\nseg0.m4s\n#EXT-X-ENDLIST\n';
  const r = rewriteMasterPlaylist(media, { quality: 'max', bestAudio: true });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, media);
});

test('CRLF playlists parse', () => {
  const r = rewriteMasterPlaylist(MASTER.replace(/\n/g, '\r\n'), { quality: 'max', baseUrl: BASE });
  assert.strictEqual(streams(r.text).length, 1);
});

test('Reddit master: relative names resolve against v.redd.it, numeric audio groups', () => {
  const r = rewriteMasterPlaylist(REDDIT_MASTER, { quality: 'max', bestAudio: true, baseUrl: REDDIT_BASE });
  assert.deepStrictEqual(streams(r.text), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
  assert.match(r.text, /URI="https:\/\/v\.redd\.it\/abc123\/HLS_AUDIO_128\.m3u8"/);
  const low = rewriteMasterPlaylist(REDDIT_MASTER, { quality: 'min', bestAudio: true, baseUrl: REDDIT_BASE });
  assert.match(low.text, /RESOLUTION=426x240.*AUDIO="1"/);
});

// =========================================================================
section('DASH rewrite');

const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT12S">
  <Period>
    <AdaptationSet segmentAlignment="true" maxWidth="1920" maxHeight="1080" contentType="video">
      <Representation id="VIDEO-1" mimeType="video/mp4" codecs="avc1.4d401e" width="640" height="360" bandwidth="900000">
        <BaseURL>DASH_360.mp4</BaseURL>
        <SegmentBase indexRange="800-900"><Initialization range="0-799"/></SegmentBase>
      </Representation>
      <Representation id="VIDEO-2" mimeType="video/mp4" codecs="avc1.4d401f" width="1280" height="720" bandwidth="2400000">
        <BaseURL>DASH_720.mp4</BaseURL>
        <SegmentBase indexRange="800-900"><Initialization range="0-799"/></SegmentBase>
      </Representation>
      <Representation id="VIDEO-3" mimeType="video/mp4" codecs="avc1.640028" width="1920" height="1080" bandwidth="4800000">
        <BaseURL>DASH_1080.mp4</BaseURL>
        <SegmentBase indexRange="800-900"><Initialization range="0-799"/></SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="en">
      <Representation id="AUDIO-1" codecs="mp4a.40.2" bandwidth="64000"><BaseURL>DASH_AUDIO_64.mp4</BaseURL></Representation>
      <Representation id="AUDIO-2" codecs="mp4a.40.2" bandwidth="128000"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

function baseUrls(text) {
  return [...text.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1]);
}

test('DASH max keeps 1080p video and best audio', () => {
  const r = rewriteMpd(MPD, { quality: 'max', bestAudio: true });
  assert.ok(r.changed);
  assert.deepStrictEqual(baseUrls(r.text), ['DASH_1080.mp4', 'DASH_AUDIO_128.mp4']);
  assert.match(r.text, /<\/AdaptationSet>\s*<AdaptationSet/); // structure intact
  assert.match(r.text, /<\/Period>\s*<\/MPD>/);
});

test('DASH cap 720 / min', () => {
  assert.deepStrictEqual(baseUrls(rewriteMpd(MPD, { quality: '720' }).text),
    ['DASH_720.mp4', 'DASH_AUDIO_64.mp4', 'DASH_AUDIO_128.mp4']);
  assert.deepStrictEqual(baseUrls(rewriteMpd(MPD, { quality: 'min' }).text).slice(0, 1), ['DASH_360.mp4']);
});

test('DASH auto without bestAudio is untouched', () => {
  const r = rewriteMpd(MPD, { quality: 'auto', bestAudio: false });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, MPD);
});

test('DASH self-closing representations', () => {
  const mpd = '<MPD><Period><AdaptationSet contentType="video">' +
    '<Representation id="a" width="640" height="360" bandwidth="1"/>' +
    '<Representation id="b" width="1920" height="1080" bandwidth="2"/>' +
    '</AdaptationSet></Period></MPD>';
  const r = rewriteMpd(mpd, { quality: 'max' });
  assert.ok(r.text.includes('id="b"') && !r.text.includes('id="a"'));
});

// =========================================================================
section('Config');

test('site detection', () => {
  assert.strictEqual(CONFIG.siteForHost('x.com'), 'x');
  assert.strictEqual(CONFIG.siteForHost('mobile.twitter.com'), 'x');
  assert.strictEqual(CONFIG.siteForHost('www.reddit.com'), 'reddit');
  assert.strictEqual(CONFIG.siteForHost('old.reddit.com'), 'reddit');
  assert.strictEqual(CONFIG.siteForHost('m.youtube.com'), 'youtube');
  assert.strictEqual(CONFIG.siteForHost('www.youtube-nocookie.com'), 'youtube');
  assert.strictEqual(CONFIG.siteForHost('www.linkedin.com'), 'linkedin');
  assert.strictEqual(CONFIG.siteForHost('www.tiktok.com'), 'tiktok');
  assert.strictEqual(CONFIG.siteForHost('bsky.app'), 'bluesky');
  assert.strictEqual(CONFIG.siteForHost('www.threads.com'), 'threads');
  assert.strictEqual(CONFIG.siteForHost('www.facebook.com'), null);
  assert.strictEqual(CONFIG.siteForHost('notreddit.com'), null);
  assert.strictEqual(CONFIG.siteForHost('example.com'), null);
});

test('pageSettings respects global and per-site switches', () => {
  const s = Object.assign({}, CONFIG.DEFAULTS, { reddit_videoQuality: '720' });
  assert.deepStrictEqual(CONFIG.pageSettings(s, 'reddit'), { enabled: true, videoQuality: '720', bestAudio: true, images: 'orig', imageData: false, streamHosts: ['v.redd.it'], manifestPaths: [], vhsJson: false, bitrateJson: false });
  assert.strictEqual(CONFIG.pageSettings(Object.assign({}, s, { reddit_enabled: false }), 'reddit').enabled, false);
  assert.strictEqual(CONFIG.pageSettings(Object.assign({}, s, { enabled: false }), 'x').enabled, false);
});

test('v1 settings migrate to x_ keys; removed settings are cleared', () => {
  const { set, remove } = CONFIG.migrateLegacy({ enabled: true, videoQuality: '720', feedImages: 'orig', banners: false });
  assert.deepStrictEqual(set, { x_videoQuality: '720', x_feedImages: 'orig' });
  assert.deepStrictEqual(remove.sort(), ['banners', 'feedImages', 'videoQuality']);
  // Settings that no longer exist are removed from storage.
  assert.deepStrictEqual(CONFIG.migrateLegacy({ x_viewerImages: 'orig', x_avatars: '400x400', x_banners: true, x_feedImages: 'large' }).remove.sort(),
    ['x_avatars', 'x_banners', 'x_viewerImages']);
  // Already-migrated values win.
  assert.deepStrictEqual(CONFIG.migrateLegacy({ videoQuality: '720', x_videoQuality: 'max' }).set, {});
});

test('removed options move to the nearest remaining one', () => {
  const { set } = CONFIG.migrateLegacy({ youtube_videoQuality: '2160', x_videoQuality: '1440', reddit_videoQuality: '360',
    instagram_videoQuality: '720', x_feedImages: 'large', reddit_images: 'large' });
  assert.deepStrictEqual(set, { youtube_videoQuality: 'max', x_videoQuality: 'max', reddit_videoQuality: '480',
    x_feedImages: 'default', reddit_images: 'default' });
  assert.deepStrictEqual(CONFIG.migrateLegacy({ x_feedImages: '4096x4096' }).set, { x_feedImages: 'orig' });
  assert.deepStrictEqual(CONFIG.migrateLegacy({ x_feedImages: 'small', reddit_images: 'orig' }).set, {});
});

// =========================================================================
section('Image rules');

const listeners = () => ({ addListener() {} });

function loadBackground() {
  const sandbox = {
    URL,
    console,
    chrome: {
      runtime: { onInstalled: listeners(), onStartup: listeners() },
      storage: { onChanged: listeners(), sync: {} },
      declarativeNetRequest: {},
    },
  };
  sandbox.self = sandbox;
  const bgDir = path.join(SRC, 'background');
  sandbox.importScripts = (...files) => {
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(bgDir, f), 'utf8'), sandbox);
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(bgDir, 'background.js'), 'utf8'), sandbox);
  return sandbox;
}

const bg = loadBackground();
const defaults = Object.assign({}, CONFIG.DEFAULTS);
const withSettings = (o) => Object.assign({}, defaults, o);

// DNR urlFilter syntax -> JS RegExp: `||` domain anchor, `|` start/end
// anchor, `*` wildcard, `^` separator.
function urlFilterToRegExp(filter, caseSensitive) {
  let src = filter;
  let prefix = '';
  let suffix = '';
  if (src.startsWith('||')) { prefix = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'; src = src.slice(2); }
  else if (src.startsWith('|')) { prefix = '^'; src = src.slice(1); }
  if (src.endsWith('|')) { suffix = '$'; src = src.slice(0, -1); }
  const body = src.split('').map((c) => {
    if (c === '*') return '.*';
    if (c === '^') return '(?:[^A-Za-z0-9_.%-]|$)';
    return c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }).join('');
  return new RegExp(prefix + body + suffix, caseSensitive ? '' : 'i');
}

function conditionRegExp(cond) {
  const flags = cond.isUrlFilterCaseSensitive ? '' : 'i';
  if (cond.regexFilter) return new RegExp(cond.regexFilter, flags);
  return urlFilterToRegExp(cond.urlFilter, cond.isUrlFilterCaseSensitive);
}

// Emulate DNR: highest-priority match wins; redirects are re-evaluated;
// regexSubstitution replaces only the matched part of the URL.
function applyDnr(rules, url) {
  for (let hop = 0; hop < 5; hop++) {
    const matches = rules
      .filter((r) => conditionRegExp(r.condition).test(url))
      .sort((a, b) => b.priority - a.priority);
    const r = matches[0];
    if (!r || r.action.type === 'allow') return url;
    const red = r.action.redirect;
    if (red.regexSubstitution) {
      url = url.replace(conditionRegExp(r.condition), red.regexSubstitution.replace(/\\(\d)/g, '$$$1'));
    } else if (red.transform && typeof red.transform.query === 'string') {
      const u = new URL(url);
      u.search = red.transform.query;
      url = u.href;
    } else {
      throw new Error('unexpected redirect type');
    }
  }
  throw new Error('redirect loop for ' + url);
}

const IMG = 'https://pbs.twimg.com/media/GabcDEF123?format=jpg&name=small';

test('X large: feed small -> large, not re-upgraded to orig', () => {
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'large' })), IMG), 'https://pbs.twimg.com/media/GabcDEF123?name=large&format=jpg');
});

test('X orig URLs pass through untouched', () => {
  const u = 'https://pbs.twimg.com/media/GabcDEF123?format=png&name=orig';
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'orig' })), u), u);
});

test('X feed=4096: image stops at 4096', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: '4096x4096' }));
  assert.strictEqual(applyDnr(rules, IMG), 'https://pbs.twimg.com/media/GabcDEF123?name=4096x4096&format=jpg');
});

test('X feed=medium does not downgrade large', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'medium' }));
  const u = 'https://pbs.twimg.com/media/X?format=jpg&name=large';
  assert.strictEqual(applyDnr(rules, u), u);
});

test('X data saver: bigger sizes come back small, once, in every format', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'small' }));
  for (const size of ['medium', '900x900', 'large', '4096x4096', 'orig']) {
    assert.strictEqual(applyDnr(rules, `https://pbs.twimg.com/media/Gab?format=jpg&name=${size}`),
      'https://pbs.twimg.com/media/Gab?name=small&format=jpg', size);
  }
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/media/Gab?format=webp&name=large'), 'https://pbs.twimg.com/media/Gab?name=small&format=webp');
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/amplify_video_thumb/1/img/A.jpg?name=large'), 'https://pbs.twimg.com/amplify_video_thumb/1/img/A.jpg?name=small');
  // Already small or smaller: untouched.
  for (const u of ['https://pbs.twimg.com/media/Gab?format=jpg&name=small', 'https://pbs.twimg.com/media/Gab?format=jpg&name=360x360']) {
    assert.strictEqual(applyDnr(rules, u), u);
  }
  // Data saver never touches avatars, banners or card images.
  for (const u of ['https://pbs.twimg.com/profile_images/1/A_400x400.jpg', 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=large']) {
    assert.strictEqual(applyDnr(rules, u), u);
  }
  assert.ok(rules.every((r) => !r.condition.regexFilter || !r.condition.regexFilter.includes('twimg')));
});

test('X video thumbnails upgraded', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'large' }));
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/amplify_video_thumb/123/img/AbC.jpg?name=small'),
    'https://pbs.twimg.com/amplify_video_thumb/123/img/AbC.jpg?name=large');
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/amplify_video_thumb/123/img/AbC?format=jpg&name=small'),
    'https://pbs.twimg.com/amplify_video_thumb/123/img/AbC?name=large&format=jpg');
});

test('X png and webp images keep their format', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'large' }));
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/media/Q?format=png&name=900x900'),
    'https://pbs.twimg.com/media/Q?name=large&format=png');
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/media/Q?format=webp&name=small'),
    'https://pbs.twimg.com/media/Q?name=large&format=webp');
});

test('X card images are left alone', () => {
  const u = 'https://pbs.twimg.com/card_img/1/abc?format=jpg&name=small';
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(defaults), u), u);
});

test('X: sizes at or above the setting, profile pictures and banners are left alone', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'large' }));
  for (const u of [
    'https://pbs.twimg.com/media/GabcDEF123?format=jpg&name=4096x4096',
    'https://pbs.twimg.com/media/GabcDEF123?format=jpg&name=large',
    'https://pbs.twimg.com/profile_images/1234/AbCd_normal.jpg',
    'https://pbs.twimg.com/profile_banners/12/1700000000/600x200',
  ]) assert.strictEqual(applyDnr(rules, u), u);
  assert.ok(bg.__QM_BUILD_RULES__(defaults).every((r) => !r.condition.regexFilter || !r.condition.regexFilter.includes('twimg')));
});

test('Reddit previews -> i.redd.it originals (plain and slugged names)', () => {
  const rules = bg.__QM_BUILD_RULES__(defaults);
  assert.strictEqual(applyDnr(rules, 'https://preview.redd.it/abc123xyz.jpg?width=640&crop=smart&auto=webp&s=0f1e2d'),
    'https://i.redd.it/abc123xyz.jpg');
  assert.strictEqual(applyDnr(rules, 'https://preview.redd.it/my-cat-did-a-thing-v0-q9w8e7r6.png?width=1080&format=png&auto=webp&s=ab12'),
    'https://i.redd.it/q9w8e7r6.png');
  assert.strictEqual(applyDnr(rules, 'https://preview.redd.it/k3j2h1.jpeg?auto=webp&s=1'),
    'https://i.redd.it/k3j2h1.jpeg');
});

test('Bluesky Highest: feed previews -> full size; off by default', () => {
  const thumb = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiabc@jpeg';
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ bluesky_images: 'orig' })), thumb),
    'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiabc@jpeg');
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(defaults), thumb), thumb);
  // Avatars and banners are left alone.
  const avatar = 'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abc/bafkreiabc@jpeg';
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ bluesky_images: 'orig' })), avatar), avatar);
  assert.strictEqual(bg.__QM_BUILD_RULES__(withSettings({ bluesky_images: 'orig', bluesky_enabled: false })).length,
    bg.__QM_BUILD_RULES__(defaults).length);
});

test('Reddit GIFs, external previews and originals are left alone', () => {
  const rules = bg.__QM_BUILD_RULES__(defaults);
  for (const u of [
    'https://preview.redd.it/abc123.gif?width=640&format=png8&s=1',
    'https://external-preview.redd.it/abc123.jpg?width=640&s=1',
    'https://i.redd.it/abc123.jpg',
    // Avatars: '-headshot' is not a post-image id.
    'https://preview.redd.it/snoovatar/avatars/6375a3bb-c76d-4c42-8f36-1672ae0e4415-headshot.png?width=64&s=1',
    'https://preview.redd.it/snoovatar/avatars/nftv2_bmZ0X2VpcDE1NToxMzdfZWI5NTlhNzE1ZGZmZmU2ZjgyZjQ2MDU1MzM5ODJjNDg1OWNiMTRmZV8xNTAx_rare_8c606570-13a9-4e46-8e88-0b1dcd483393-headshot.png?width=64&s=1',
    // A slug-like name without the -v0- marker.
    'https://preview.redd.it/some-title-abc123.jpg?width=640&s=1',
  ]) assert.strictEqual(applyDnr(rules, u), u);
});

test('per-site and global switches remove that site\'s rules', () => {
  const all = bg.__QM_BUILD_RULES__(defaults);
  const noReddit = bg.__QM_BUILD_RULES__(withSettings({ reddit_enabled: false }));
  const noX = bg.__QM_BUILD_RULES__(withSettings({ x_enabled: false }));
  assert.ok(noReddit.every((r) => !JSON.stringify(r).includes('redd.it')));
  assert.ok(noX.every((r) => !JSON.stringify(r).includes('twimg')));
  assert.strictEqual(noReddit.length + noX.length, all.length);
  assert.strictEqual(bg.__QM_BUILD_RULES__(withSettings({ enabled: false })).length, 0);
  assert.strictEqual(bg.__QM_BUILD_RULES__(withSettings({ reddit_images: 'default' })).length, noReddit.length);
});

test('rule ids are unique; regexes are RE2-safe (no lookaround/backrefs)', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'orig' }));
  const ids = rules.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const r of rules) {
    if (r.condition.regexFilter) assert.ok(!/\(\?[=!<]|\\[1-9]/.test(r.condition.regexFilter), r.condition.regexFilter);
  }
});

test('X image-size rules use urlFilter, not regex', () => {
  const named = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'large' })).filter((r) => r.action.redirect.transform);
  assert.ok(named.length > 0);
  for (const r of named) assert.ok(r.condition.urlFilter && !r.condition.regexFilter);
});

// RE2 only skips compiling a literal prefix that directly follows `^`
// (outside any group). Keep the variable part of each regex tiny.
test('regex rules: literal host prefix outside groups, short variable part', () => {
  for (const s of [defaults, withSettings({ bluesky_images: 'orig' })]) {
    for (const r of bg.__QM_BUILD_RULES__(s).filter((x) => x.condition.regexFilter)) {
      const m = r.condition.regexFilter.match(/^\^https:\/\/[a-z]+\\\.(?:twimg|redd|bsky)\\\.(?:com|it|app)\/(?:[a-z_]+\/)*(.*)$/);
      assert.ok(m, 'prefix not literal: ' + r.condition.regexFilter);
      assert.ok(m[1].length <= 30, `variable part too long (${m[1].length}): ${m[1]}`);
      assert.ok(!m[1].includes('|'), 'alternation in regex: ' + m[1]);
    }
  }
});

test('unsupported regex rules are dropped, others kept', async () => {
  const rules = bg.__QM_BUILD_RULES__(defaults);
  const calls = [];
  bg.chrome.declarativeNetRequest.isRegexSupported = async (opts) => {
    calls.push(opts);
    return opts.regex.includes('-v0-') ? { isSupported: false, reason: 'memoryLimitExceeded' } : { isSupported: true };
  };
  const origConsole = bg.console;
  const warnings = [];
  bg.console = Object.assign({}, console, { warn: (m) => warnings.push(m) });
  try {
    const kept = await bg.__QM_KEEP_SUPPORTED__(rules);
    assert.strictEqual(kept.length, rules.length - 4); // one slugged-name rule per extension
    assert.ok(kept.every((r) => !(r.condition.regexFilter || '').includes('-v0-')));
    assert.strictEqual(warnings.length, 4);
    assert.match(warnings[0], /skipping rule \d+: regex not supported \(memoryLimitExceeded\)/);
    assert.ok(calls.every((c) => c.requireCapturing === true && c.isCaseSensitive === true));
    assert.strictEqual(calls.length, rules.filter((r) => r.condition.regexFilter).length);
  } finally {
    bg.console = origConsole;
  }
});

test('overlapping rule updates (install + storage change) do not collide on ids', async () => {
  // A dynamic-rule store that rejects duplicate ids the way Chrome does.
  let installed = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const dnr = bg.chrome.declarativeNetRequest;
  dnr.isRegexSupported = async () => ({ isSupported: true });
  dnr.getDynamicRules = async () => { await tick(); return installed.slice(); };
  dnr.updateDynamicRules = async ({ removeRuleIds = [], addRules = [] }) => {
    await tick();
    const next = installed.filter((r) => !removeRuleIds.includes(r.id));
    for (const r of addRules) {
      if (next.some((x) => x.id === r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID.`);
      next.push(r);
    }
    installed = next;
  };
  bg.chrome.storage.sync.get = async (d) => Object.assign({}, d);
  const origConsole = bg.console;
  const errors = [];
  bg.console = Object.assign({}, console, { error: (m) => errors.push(m) });
  try {
    await Promise.all([bg.__QM_APPLY_RULES__(), bg.__QM_APPLY_RULES__(), bg.__QM_APPLY_RULES__()]);
    assert.deepStrictEqual(errors, []);
    const ids = installed.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.strictEqual(ids.length, bg.__QM_BUILD_RULES__(defaults).length);
  } finally {
    bg.console = origConsole;
  }
});

// =========================================================================
section('Page hooks');

// Run a MAIN-world hook in a fake page for the given host.
// `settings` seeds what the bridge would have mirrored into localStorage.
function loadPage(hostname, files, extra, settings) {
  const store = {};
  if (settings) store.__qm_settings = JSON.stringify(settings);
  const listeners = {};
  const sandbox = Object.assign({
    console, URL, Headers, Response, ReadableStream, TextDecoder, TextEncoder,
    location: { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setInterval: () => 0,
  }, extra);
  // Own Response class per page, so the hook's prototype patch stays in the
  // sandbox. The default fetch serves `bodies` (url -> text).
  const PageResponse = class Response extends globalThis.Response {};
  sandbox.Response = PageResponse;
  if (!('fetch' in sandbox)) {
    sandbox.fetch = async (url) => {
      const r = new PageResponse(sandbox.bodies[url], { status: 200 });
      Object.defineProperty(r, 'url', { value: url });
      return r;
    };
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.__store = store;
  sandbox.__emit = (t, detail) => (listeners[t] || []).forEach((fn) => fn({ detail }));
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  return sandbox;
}

const STREAM_FILES = ['shared/hls-rewrite.js', 'shared/dash-rewrite.js', 'page/stream-hook.js'];
const REDDIT_PAGE = CONFIG.pageSettings(CONFIG.DEFAULTS, 'reddit');

test('stream hook (fetch): Reddit HLS master is rewritten, other URLs untouched', async () => {
  const bodies = { [REDDIT_BASE]: REDDIT_MASTER, 'https://www.reddit.com/api/x.m3u8': REDDIT_MASTER };
  const page = loadPage('www.reddit.com', STREAM_FILES, { bodies, XMLHttpRequest: class {} }, REDDIT_PAGE);
  const res = await page.fetch(REDDIT_BASE);
  assert.strictEqual(res.url, REDDIT_BASE);
  assert.deepStrictEqual(streams(await res.text()), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
  // Same body from a non-video host passes through.
  const other = await page.fetch('https://www.reddit.com/api/x.m3u8');
  assert.strictEqual(await other.text(), REDDIT_MASTER);
});

test('stream hook on X: video.twimg.com masters follow the X setting (fetch and XHR)', async () => {
  const xSettings = (q) => Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'x'), { videoQuality: q });
  // fetch -> Response.text(), "Data saver".
  const page = loadPage('x.com', STREAM_FILES, { bodies: { [BASE]: MASTER }, XMLHttpRequest: class {} }, xSettings('min'));
  assert.deepStrictEqual(streams(await (await page.fetch(BASE)).text()), ['https://video.twimg.com/amplify_video/1/pl/avc1/480x270/v1.m3u8']);
  // XHR -> responseText, "Up to 720p".
  class FakeXHR {
    open(method, url) { this._url = url; }
    get readyState() { return 4; }
    get responseURL() { return this._url; }
    get responseText() { return MASTER; }
    get response() { return MASTER; }
  }
  const page2 = loadPage('x.com', STREAM_FILES, { XMLHttpRequest: FakeXHR, fetch: async () => {} }, xSettings('720'));
  const xhr = new page2.XMLHttpRequest();
  xhr.open('GET', BASE);
  assert.deepStrictEqual(streams(xhr.responseText), ['https://video.twimg.com/amplify_video/1/pl/avc1/1280x720/v3.m3u8']);
  // X's own API responses are never treated as embedded manifests.
  const api = new page2.XMLHttpRequest();
  api.open('GET', 'https://x.com/i/api/graphql/abc/TweetDetail');
  assert.strictEqual(api.responseText, MASTER);
});

test('stream hook leaves window.fetch alone and rewrites via arrayBuffer too', async () => {
  const fetchBefore = async () => {};
  const page = loadPage('www.reddit.com', STREAM_FILES, { fetch: fetchBefore, XMLHttpRequest: class {} }, REDDIT_PAGE);
  assert.strictEqual(page.fetch, fetchBefore); // not on the stack of the site's requests
  const res = new page.Response(REDDIT_MASTER, { status: 200 });
  Object.defineProperty(res, 'url', { value: REDDIT_BASE });
  const text = new TextDecoder().decode(await res.arrayBuffer());
  assert.deepStrictEqual(streams(text), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
  // Streaming readers (response.body) get the rewritten playlist too.
  const res2 = new page.Response(REDDIT_MASTER, { status: 200 });
  Object.defineProperty(res2, 'url', { value: REDDIT_BASE });
  assert.strictEqual(res2.body, res2.body);
  let streamed = '';
  for await (const chunk of res2.body) streamed += new TextDecoder().decode(chunk);
  assert.deepStrictEqual(streams(streamed), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
  // Other responses keep their own body stream.
  const plain = new page.Response('hello', { status: 200 });
  assert.strictEqual(await new globalThis.Response(plain.body).text(), 'hello');
  // Node's own Response is untouched.
  assert.strictEqual(Response.prototype.text, NODE_RESPONSE_TEXT);
  assert.strictEqual(Response.prototype.arrayBuffer, NODE_RESPONSE_ARRAYBUFFER);
});

test('stream hook works on pages that define their own global module/require (Reddit)', async () => {
  const pageModule = { exports: { pageOwned: true } };
  let requireCalls = 0;
  const page = loadPage('www.reddit.com', STREAM_FILES, {
    bodies: { [REDDIT_BASE]: REDDIT_MASTER }, XMLHttpRequest: class {},
    module: pageModule, require: () => { requireCalls++; return {}; },
  }, REDDIT_PAGE);
  assert.ok(page.__QM_HLS__ && page.__QM_DASH__);
  assert.deepStrictEqual(pageModule.exports, { pageOwned: true });
  assert.strictEqual(requireCalls, 0);
  const res = await page.fetch(REDDIT_BASE);
  assert.deepStrictEqual(streams(await res.text()), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
});

test('stream hook (XHR): DASH MPD from v.redd.it honours the site setting', () => {
  class FakeXHR {
    open(method, url) { this._url = url; }
    get readyState() { return 4; }
    get responseURL() { return this._url; }
    get responseText() { return MPD; }
    get response() { return MPD; }
  }
  const page = loadPage('www.reddit.com', STREAM_FILES, { XMLHttpRequest: FakeXHR, fetch: async () => {} }, REDDIT_PAGE);
  page.__emit('qm-settings', JSON.stringify({ enabled: true, videoQuality: '720', bestAudio: true }));
  const xhr = new page.XMLHttpRequest();
  xhr.open('GET', 'https://v.redd.it/abc123/DASHPlaylist.mpd?a=1&v=1&f=sd');
  assert.deepStrictEqual(baseUrls(xhr.responseText), ['DASH_720.mp4', 'DASH_AUDIO_128.mp4']);
  assert.strictEqual(xhr.response, xhr.responseText);
  // Disabled for the site -> untouched.
  page.__emit('qm-settings', JSON.stringify({ enabled: false }));
  const xhr2 = new page.XMLHttpRequest();
  xhr2.open('GET', 'https://v.redd.it/abc123/DASHPlaylist.mpd');
  assert.strictEqual(xhr2.responseText, MPD);
});

test('stream hook stays idle until the bridge sends settings, then picks them up', async () => {
  const page = loadPage('www.reddit.com', STREAM_FILES, { bodies: { [REDDIT_BASE]: REDDIT_MASTER }, XMLHttpRequest: class {} });
  assert.strictEqual(await (await page.fetch(REDDIT_BASE)).text(), REDDIT_MASTER);
  // The bridge writes localStorage (read lazily on the next request).
  page.__store.__qm_settings = JSON.stringify(REDDIT_PAGE);
  assert.deepStrictEqual(streams(await (await page.fetch(REDDIT_BASE)).text()), ['https://v.redd.it/abc123/HLS_1080.m3u8']);
});

test("pageSettings carries each site's video hosts to the page hooks", () => {
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'reddit').streamHosts, ['v.redd.it']);
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'x').streamHosts, ['video.twimg.com']);
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'youtube').streamHosts, []);
});

// Reddit's <shreddit-player-2 packaged-media-json="..."> list of MP4s.
const PACKAGED = JSON.stringify({ playbackMp4s: { duration: 31, permutations: [
  { source: { url: 'https://packaged-media.redd.it/xavo/pb/m2-res_240p.mp4?m=DASHPlaylist.mpd&v=1&s=a', dimensions: { width: 426, height: 240 } } },
  { source: { url: 'https://packaged-media.redd.it/xavo/pb/m2-res_480p.mp4?m=DASHPlaylist.mpd&v=1&s=b', dimensions: { width: 854, height: 480 } } },
  { source: { url: 'https://packaged-media.redd.it/xavo/pb/m2-res_720p.mp4?m=DASHPlaylist.mpd&v=1&s=c', dimensions: { width: 1280, height: 720 } } },
  { source: { url: 'https://packaged-media.redd.it/xavo/pb/m2-res_1080p.mp4?m=DASHPlaylist.mpd&v=1&s=d', dimensions: { width: 1920, height: 1080 } } },
] } });
const PACKAGED_PORTRAIT = JSON.stringify({ playbackMp4s: { permutations: [
  { source: { url: 'https://packaged-media.redd.it/p/pb/m2-res_854p.mp4', dimensions: { width: 480, height: 854 } } },
  { source: { url: 'https://packaged-media.redd.it/p/pb/m2-res_1280p.mp4', dimensions: { width: 720, height: 1280 } } },
  { source: { url: 'https://packaged-media.redd.it/p/pb/m2-res_1920p.mp4', dimensions: { width: 1080, height: 1920 } } },
] } });
const mp4s = (json) => JSON.parse(json).playbackMp4s.permutations.map((p) => p.source.url.split('/').pop().split('?')[0]);

function loadRedditVideo(settings, extra) {
  return loadPage('www.reddit.com', ['shared/hls-rewrite.js', 'page/reddit-video.js'], extra, settings);
}

test('Reddit packaged MP4s: keep the one the setting picks (short side, like HLS)', () => {
  const { filterJson } = loadRedditVideo().__QM_REDDIT_VIDEO__;
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED, 'max')), ['m2-res_1080p.mp4']);
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED, '1080')), ['m2-res_1080p.mp4']);
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED, '720')), ['m2-res_720p.mp4']);
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED, 'min')), ['m2-res_240p.mp4']);
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED_PORTRAIT, '720')), ['m2-res_1280p.mp4']);
  assert.deepStrictEqual(mp4s(filterJson(PACKAGED_PORTRAIT, '1080')), ['m2-res_1920p.mp4']);
  // Other fields survive; unknown shapes and 'auto' are left as they are.
  assert.strictEqual(JSON.parse(filterJson(PACKAGED, 'max')).playbackMp4s.duration, 31);
  assert.strictEqual(filterJson(PACKAGED, null), PACKAGED);
  assert.strictEqual(filterJson('{"something":"else"}', 'max'), '{"something":"else"}');
  assert.strictEqual(filterJson('not json', 'max'), 'not json');
});

test('Reddit packaged MP4s: player elements are filtered on the way in', () => {
  const defined = {};
  let observerCallback = null;
  const page = loadRedditVideo(Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'reddit'), { videoQuality: '720' }), {
    customElements: { define(name, ctor) { defined[name] = ctor; } },
    MutationObserver: class { constructor(cb) { observerCallback = cb; } observe() {} },
    document: {},
  });
  // 1) Element defined by Reddit later: the value reaching the element is trimmed.
  class Player { attributeChangedCallback(name, oldValue, value) { this.seen = value; } }
  page.customElements.define('shreddit-player-2', Player);
  const p = new defined['shreddit-player-2']();
  p.attributeChangedCallback('packaged-media-json', null, PACKAGED);
  assert.deepStrictEqual(mp4s(p.seen), ['m2-res_720p.mp4']);
  p.attributeChangedCallback('src', null, 'x');
  assert.strictEqual(p.seen, 'x');
  // 2) Server-rendered element: the attribute itself is rewritten.
  const attrs = { 'packaged-media-json': PACKAGED };
  const el = { nodeType: 1, localName: 'shreddit-player-2', hasAttribute: (n) => n in attrs,
    getAttribute: (n) => attrs[n], setAttribute: (n, v) => { attrs[n] = v; }, querySelectorAll: () => [] };
  observerCallback([{ type: 'childList', addedNodes: [el] }]);
  assert.deepStrictEqual(mp4s(attrs['packaged-media-json']), ['m2-res_720p.mp4']);
  // Other elements are ignored.
  const other = Object.assign({}, el, { localName: 'div', setAttribute: () => { throw new Error('touched'); } });
  observerCallback([{ type: 'childList', addedNodes: [other] }]);
});

test('Reddit packaged MP4s: untouched when the site or quality is off', () => {
  for (const change of [{ enabled: false }, { videoQuality: 'auto' }]) {
    let cb = null;
    const defined = {};
    const page = loadRedditVideo(Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'reddit'), change), {
      customElements: { define(n, c) { defined[n] = c; } },
      MutationObserver: class { constructor(f) { cb = f; } observe() {} },
      document: {},
    });
    class Player { attributeChangedCallback(n, o, v) { this.seen = v; } }
    page.customElements.define('shreddit-player-2', Player);
    const p = new defined['shreddit-player-2']();
    p.attributeChangedCallback('packaged-media-json', null, PACKAGED);
    assert.strictEqual(p.seen, PACKAGED, JSON.stringify(change));
    const el = { nodeType: 1, localName: 'shreddit-player-2', hasAttribute: () => true, getAttribute: () => PACKAGED,
      setAttribute: () => { throw new Error('touched with ' + JSON.stringify(change)); }, querySelectorAll: () => [] };
    cb([{ type: 'childList', addedNodes: [el] }]);
  }
});

function fakeYouTubePlayer(data, videoId) {
  const calls = [];
  return {
    calls,
    classList: { contains: () => false },
    getVideoData: () => ({ video_id: videoId }),
    getAvailableQualityData: () => data,
    getAvailableQualityLevels: () => data.map((d) => d.quality).concat('auto'),
    setPlaybackQualityRange: (a, b) => calls.push(['range', a, b]),
    setPlaybackQuality: (q) => calls.push(['set', q]),
  };
}

const YT_DATA = [
  { quality: 'hd2160', isPlayable: true }, { quality: 'hd1440', isPlayable: true },
  { quality: 'hd1080', isPlayable: false, paygatedQualityDetails: {} }, // "1080p Premium"
  { quality: 'hd1080', isPlayable: true }, { quality: 'hd720', isPlayable: true },
  { quality: 'large', isPlayable: true }, { quality: 'medium', isPlayable: true },
  { quality: 'tiny', isPlayable: true },
];

function loadYouTube(player, settings) {
  const doc = { hidden: false, getElementById: (id) => (id === 'movie_player' ? player : null), addEventListener() {} };
  const page = loadPage('www.youtube.com', ['page/youtube-hook.js'], { document: doc });
  if (settings) page.__emit('qm-settings', JSON.stringify(settings));
  return page;
}

test('YouTube: max picks hd2160 once per video', () => {
  const p = fakeYouTubePlayer(YT_DATA, 'vid1');
  loadYouTube(p, { enabled: true, videoQuality: 'max' });
  assert.deepStrictEqual(p.calls, [['range', 'hd2160', 'hd2160'], ['set', 'hd2160']]);
});

test('YouTube: caps, min and auto', () => {
  const cases = [['1080', 'hd1080'], ['1440', 'hd1440'], ['480', 'large'], ['360', 'medium'], ['144', 'tiny'], ['min', 'tiny']];
  for (const [setting, expected] of cases) {
    const p = fakeYouTubePlayer(YT_DATA, 'v');
    loadYouTube(p, { enabled: true, videoQuality: setting });
    assert.deepStrictEqual(p.calls[0], ['range', expected, expected], setting);
  }
  const p = fakeYouTubePlayer(YT_DATA, 'v');
  loadYouTube(p, { enabled: true, videoQuality: 'auto' });
  assert.deepStrictEqual(p.calls, []);
  const off = fakeYouTubePlayer(YT_DATA, 'v');
  loadYouTube(off, { enabled: false, videoQuality: 'max' });
  assert.deepStrictEqual(off.calls, []);
});

test('YouTube: pay-gated "1080p Premium" alone is never picked', () => {
  const p = fakeYouTubePlayer([
    { quality: 'hd1080', isPlayable: false, paygatedQualityDetails: {} },
    { quality: 'hd720', isPlayable: true },
  ], 'v');
  loadYouTube(p, { enabled: true, videoQuality: 'max' });
  assert.deepStrictEqual(p.calls[0], ['range', 'hd720', 'hd720']);
});

// =========================================================================
section('Instagram');

// A Meta-style MPD, built from what Instagram's /api/graphql returned:
// one line, FBQualityLabel per rendition, and width/height that can be the
// display size (every rendition up to 720p claims 720x1280).
function metaMpd(videos, audioBandwidths) {
  const rep = (v, i) => `<Representation id="${i}v" mimeType="video/mp4" codecs="vp09.00.40.08.00.01.01.01.00" width="${v.w}" height="${v.h}" frameRate="30/1" sar="1:1" startWithSAP="1" bandwidth="${v.bw}" FBEncodingTag="dash_vp9" FBQualityClass="sd" FBQualityLabel="${v.label}"><BaseURL>https://scontent.cdninstagram.com/o1/v/t2/f2/m86/V${i}.mp4?efg=e&amp;_nc_ht=h</BaseURL><SegmentBase indexRange="812-891" timescale="15360"><Initialization range="0-811"/></SegmentBase></Representation>`;
  const arep = (bw, i) => `<Representation id="${i}a" mimeType="audio/mp4" codecs="mp4a.40.5" audioSamplingRate="44100" startWithSAP="1" bandwidth="${bw}"><BaseURL>https://scontent.cdninstagram.com/o1/v/t2/f2/m69/A${i}.mp4?efg=e</BaseURL><SegmentBase indexRange="700-760" timescale="44100"><Initialization range="0-699"/></SegmentBase></Representation>`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.500S" type="static" mediaPresentationDuration="PT0H0M9.300S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period duration="PT0H0M9.300S">'
    + `<AdaptationSet segmentAlignment="true" maxWidth="1440" maxHeight="2560" maxFrameRate="30" par="9:16" lang="und" subsegmentAlignment="true" subsegmentStartsWithSAP="1">${videos.map(rep).join('')}</AdaptationSet>`
    + `<AdaptationSet segmentAlignment="true" lang="und" subsegmentAlignment="true" subsegmentStartsWithSAP="1">${audioBandwidths.map(arep).join('')}</AdaptationSet>`
    + '</Period></MPD>';
}
const IG_REEL_A = metaMpd([
  { w: 720, h: 1280, bw: 264015, label: '240p' }, { w: 720, h: 1280, bw: 483946, label: '360p' },
  { w: 720, h: 1280, bw: 682384, label: '480p' }, { w: 720, h: 1280, bw: 1992703, label: '720p' },
  { w: 1080, h: 1920, bw: 3008526, label: '1080p' },
], [61581]);
const IG_REEL_B = metaMpd([
  { w: 720, h: 1280, bw: 594940, label: '360p' }, { w: 720, h: 1280, bw: 2047987, label: '720p' },
  { w: 1080, h: 1920, bw: 2876889, label: '1080p' }, { w: 1440, h: 2560, bw: 3562138, label: '1440p' },
], [30000, 60908]);
const IG_CAPTION = 'quotes " and \\ slashes <b>';
const IG_RESPONSE = JSON.stringify({ data: { xdt_api__v1__clips__home__connection_v2: { edges: [
  { node: { media: { code: 'AAA', number_of_qualities: 5, video_dash_manifest: IG_REEL_A, like_count: 12 } } },
  { node: { media: { code: 'BBB', number_of_qualities: 4, video_dash_manifest: IG_REEL_B, caption: { text: IG_CAPTION } } } },
] } }, extensions: { is_final: true } });

const igReels = (text) => JSON.parse(text).data.xdt_api__v1__clips__home__connection_v2.edges.map((e) => e.node.media);
const labels = (mpd) => (mpd.match(/FBQualityLabel="[^"]*"/g) || []).map((s) => s.slice(16, -1));
const audioBws = (mpd) => (mpd.match(/mimeType="audio\/mp4"[^>]*bandwidth="(\d+)"/g) || []).map((s) => s.match(/bandwidth="(\d+)"/)[1]);

test('Instagram: embedded MPDs pick by Meta quality label (short side), not the display size', () => {
  const cases = [['max', ['1080p', '1440p']], ['1080', ['1080p', '1080p']], ['720', ['720p', '720p']],
    ['480', ['480p', '360p']], ['min', ['240p', '360p']]];
  for (const [quality, expected] of cases) {
    const r = rewriteEmbedded(IG_RESPONSE, { quality, bestAudio: false });
    assert.strictEqual(r.count, 2, quality);
    assert.deepStrictEqual(igReels(r.text).map((m) => labels(m.video_dash_manifest)[0]), expected, quality);
    assert.ok(igReels(r.text).every((m) => labels(m.video_dash_manifest).length === 1), quality);
  }
});

test('Instagram: the rest of the response is untouched and still valid JSON', () => {
  const r = rewriteEmbedded(IG_RESPONSE, { quality: '720', bestAudio: true });
  const [a, b] = igReels(r.text);
  assert.strictEqual(a.like_count, 12);
  assert.strictEqual(a.number_of_qualities, 5);
  assert.strictEqual(b.caption.text, IG_CAPTION);
  assert.deepStrictEqual(audioBws(b.video_dash_manifest), ['60908']); // best audio kept
  assert.ok(b.video_dash_manifest.includes('V1.mp4?efg=e&amp;_nc_ht=h')); // chosen rendition's URL intact
  assert.ok(b.video_dash_manifest.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<MPD'));
  // 'auto' without best audio: byte-for-byte identical.
  assert.strictEqual(rewriteEmbedded(IG_RESPONSE, { quality: 'auto', bestAudio: false }).text, IG_RESPONSE);
  // Responses without manifests, or with an undecodable one, pass through.
  assert.strictEqual(rewriteEmbedded('{"data":{"user":{"id":"1"}}}', { quality: 'max' }).changed, false);
  const broken = '{"video_dash_manifest":"' + String.fromCharCode(92) + 'x"}';
  assert.strictEqual(rewriteEmbedded(broken, { quality: 'max' }).text, broken);
});

test('Instagram: stream hook rewrites API responses (/api/..., /graphql...) on the page origin only', () => {
  class FakeXHR {
    open(method, url) { this._url = url; }
    get readyState() { return 4; }
    get responseURL() { return new URL(this._url, 'https://www.instagram.com/').href; }
    get responseText() { return IG_RESPONSE; }
    get response() { return IG_RESPONSE; }
  }
  const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'instagram'), { videoQuality: 'min' });
  const page = loadPage('www.instagram.com', STREAM_FILES, { XMLHttpRequest: FakeXHR, fetch: async () => {} }, settings);
  const get = (url) => { const x = new page.XMLHttpRequest(); x.open('POST', url); return x.responseText; };
  assert.deepStrictEqual(igReels(get('/api/graphql')).map((m) => labels(m.video_dash_manifest)), [['240p'], ['360p']]);
  assert.deepStrictEqual(igReels(get('https://www.instagram.com/graphql/query')).map((m) => labels(m.video_dash_manifest)[0]), ['240p', '360p']);
  // Other API routes (profiles, Explore, feed) are covered too.
  assert.deepStrictEqual(igReels(get('/api/v1/feed/user/123/?count=12')).map((m) => labels(m.video_dash_manifest)[0]), ['240p', '360p']);
  // Non-API paths and other origins are not.
  assert.strictEqual(get('/static/bundles/data.json'), IG_RESPONSE);
  assert.strictEqual(get('/apix/graphql'), IG_RESPONSE);
  assert.strictEqual(get('https://evil.example/api/graphql'), IG_RESPONSE);
  // Site switched off -> untouched.
  page.__emit('qm-settings', JSON.stringify(Object.assign({}, settings, { enabled: false })));
  assert.strictEqual(get('/api/graphql'), IG_RESPONSE);
});

// Instagram photo data: each image lists its sizes as "candidates".
const igCand = (w) => ({ width: w, height: Math.round(w * 1.25), url: `https://scontent.cdninstagram.com/v/t51/1_n.jpg?stp=dst-jpg_e35_p${w}x${w}&oh=00_${w}` });
const IG_PHOTOS = JSON.stringify({ data: { xdt_api__v1__feed__timeline__connection: { edges: [
  { node: { media: { code: 'P1', image_versions2: { candidates: [3072, 1440, 1080, 750, 640, 480, 320, 240, 150].map(igCand) },
    caption: { text: 'he said "candidates": [1,2] in quotes' } } } },
  { node: { media: { code: 'P2', carousel_media: [
    { image_versions2: { candidates: [1080, 640, 320].map(igCand) } },
    { image_versions2: { candidates: [2048, 1440].map(igCand) } }, // nothing small: keep the smallest
  ] } } },
] } } });
const igPhotoWidths = (text) => {
  const edges = JSON.parse(text).data.xdt_api__v1__feed__timeline__connection.edges.map((e) => e.node.media);
  return [edges[0].image_versions2.candidates.map((c) => c.width),
    ...edges[1].carousel_media.map((m) => m.image_versions2.candidates.map((c) => c.width))];
};

function igPage(settingsOverride) {
  class FakeXHR {
    open(method, url) { this._url = url; }
    get readyState() { return 4; }
    get responseURL() { return new URL(this._url, 'https://www.instagram.com/').href; }
    get responseText() { return IG_PHOTOS; }
    get response() { return IG_PHOTOS; }
  }
  const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'instagram'), settingsOverride);
  const page = loadPage('www.instagram.com', STREAM_FILES, { XMLHttpRequest: FakeXHR, fetch: async () => {} }, settings);
  return (url) => { const x = new page.XMLHttpRequest(); x.open('POST', url); return x.responseText; };
}

test('Instagram images: data saver drops candidates wider than 640px from API data', () => {
  const get = igPage({ images: 'small', videoQuality: 'auto', bestAudio: false });
  const text = get('/graphql/query');
  assert.deepStrictEqual(igPhotoWidths(text), [[640, 480, 320, 240, 150], [640, 320], [1440]]);
  // Everything else intact, including a caption that mentions "candidates".
  const media = JSON.parse(text).data.xdt_api__v1__feed__timeline__connection.edges[0].node.media;
  assert.strictEqual(media.caption.text, 'he said "candidates": [1,2] in quotes');
  assert.strictEqual(media.image_versions2.candidates[0].url, igCand(640).url);
});

// The page's own JSON object (inside the fake page's sandbox).
const pageJSON = (page) => vm.runInContext('JSON', page);
const plainPage = (host, settings) => loadPage(host, STREAM_FILES, { XMLHttpRequest: class {}, fetch: async () => {} }, settings);

test('Instagram images: photos bundled in the page are trimmed when the app unpacks them', () => {
  const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'instagram'), { images: 'small' });
  const page = plainPage('www.instagram.com', settings);
  assert.deepStrictEqual(igPhotoWidths(JSON.stringify(pageJSON(page).parse(IG_PHOTOS))), [[640, 480, 320, 240, 150], [640, 320], [1440]]);
  // Reviver still works; other JSON is untouched.
  assert.strictEqual(pageJSON(page).parse('{"a":1}', (k, v) => (k === 'a' ? v + 1 : v)).a, 2);
  // Back to default: full lists again.
  page.__emit('qm-settings', JSON.stringify(Object.assign({}, settings, { images: 'default' })));
  assert.strictEqual(igPhotoWidths(JSON.stringify(pageJSON(page).parse(IG_PHOTOS)))[0].length, 9);
});

test('Instagram images: the unpacking hook is only installed where needed', () => {
  const native = (page) => pageJSON(page).parse.toString().includes('[native code]');
  assert.ok(native(plainPage('x.com', CONFIG.pageSettings(CONFIG.DEFAULTS, 'x'))), 'X keeps the native JSON.parse');
  assert.ok(native(plainPage('www.reddit.com', CONFIG.pageSettings(CONFIG.DEFAULTS, 'reddit'))), 'Reddit keeps the native JSON.parse');
  assert.ok(!native(plainPage('www.instagram.com', CONFIG.pageSettings(CONFIG.DEFAULTS, 'instagram'))), 'Instagram gets the wrapper');
});

test('Instagram images: default leaves image data alone; video settings do not touch it', () => {
  assert.strictEqual(igPage({ images: 'default' })('/graphql/query'), IG_PHOTOS);
  assert.strictEqual(igPage({ images: 'default', videoQuality: 'min' })('/api/v1/feed/timeline/'), IG_PHOTOS);
  // Off for the site -> untouched even with data saver.
  assert.strictEqual(igPage({ images: 'small', enabled: false })('/graphql/query'), IG_PHOTOS);
});

test('Instagram: registered as a site with its API paths', () => {
  assert.strictEqual(CONFIG.siteForHost('www.instagram.com'), 'instagram');
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'instagram').manifestPaths, ['/api/', '/graphql']);
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'x').manifestPaths, []);
});

section('Threads');

// A Meta MPD as Threads serves it (labels 240p..1080p, display-size width/height).
const THREADS_LABELS = [240, 360, 480, 720, 1080];
function threadsMpd() {
  const rep = (l) => `<Representation id="42${l}v" mimeType="video/mp4" codecs="vp09.00.31.08" width="1280" height="720" bandwidth="${l * 1000}" FBQualityLabel="${l}p"><BaseURL>https://scontent.cdninstagram.com/o1/v/t2/f2/m86/V${l}.mp4?_nc_ht=x&amp;oh=1</BaseURL><SegmentBase indexRange="800-900"><Initialization range="0-799"/></SegmentBase></Representation>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet segmentAlignment="true">${THREADS_LABELS.map(rep).join('')}</AdaptationSet><AdaptationSet><Representation id="41a" mimeType="audio/mp4" codecs="mp4a.40.5" bandwidth="66466"><BaseURL>https://scontent.cdninstagram.com/A.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
}
const threadsLabels = (mpd) => [...mpd.matchAll(/FBQualityLabel="(\d+p)"/g)].map((m) => m[1]);

function threadsXhr(body) {
  return class FakeXHR {
    open(method, url) { this._url = url; }
    get readyState() { return 4; }
    get responseURL() { return new URL(this._url, 'https://www.threads.com/').href; }
    get responseText() { return body; }
    get response() { return body; }
  };
}

test('Threads: responses read while still arriving get every line rewritten, prefix by prefix', () => {
  // The app reads responseText at readyState 3 and again at 4, each time
  // taking the text after what it already has. One JSON object per line.
  const line = (n) => JSON.stringify({ data: { post: { pk: n, video_dash_manifest: threadsMpd() } } });
  const full = line(1) + '\n' + line(2) + '\n' + line(3);
  const parts = [full.slice(0, full.indexOf('\n') + 40), full.slice(0, full.lastIndexOf('\n') + 1), full];
  let state = 0;
  class StreamXHR {
    open(method, url) { this._url = url; state = 0; }
    get readyState() { return state < 2 ? 3 : 4; }
    get responseURL() { return 'https://www.threads.com/graphql/query'; }
    get responseText() { return parts[state]; }
  }
  const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'threads'), { videoQuality: 'min' });
  const page = loadPage('www.threads.com', STREAM_FILES, { XMLHttpRequest: StreamXHR, fetch: async () => {} }, settings);
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', '/graphql/query');
  const reads = [];
  for (state = 0; state < 3; state++) reads.push(xhr.responseText);
  // Only complete lines are handed out; each read extends the previous one.
  assert.strictEqual(reads[0].split('\n').filter(Boolean).length, 1);
  assert.ok(reads[1].startsWith(reads[0]) && reads[2].startsWith(reads[1]));
  const lines = reads[2].split('\n');
  assert.strictEqual(lines.length, 3);
  for (const l of lines) assert.deepStrictEqual(threadsLabels(JSON.parse(l).data.post.video_dash_manifest), ['240p']);
});

test('Threads: same Meta MPDs as Instagram, from its API paths', () => {
  assert.deepStrictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'threads').manifestPaths, ['/api/', '/graphql']);
  assert.strictEqual(CONFIG.siteForHost('www.threads.net'), 'threads');
  const body = JSON.stringify({ data: { post: { video_versions: [{ type: 101, url: 'https://x/v.mp4' }], video_dash_manifest: threadsMpd() } } });
  const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'threads'), { videoQuality: '480' });
  const page = loadPage('www.threads.com', STREAM_FILES, { XMLHttpRequest: threadsXhr(body), fetch: async () => {} }, settings);
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://www.threads.com/graphql/query');
  const mpd = JSON.parse(xhr.responseText).data.post.video_dash_manifest;
  assert.deepStrictEqual([...mpd.matchAll(/FBQualityLabel="(\d+p)"/g)].map((m) => m[1]), ['480p']);
});

test('Threads images: Data saver trims candidates like Instagram; Highest keeps the largest', () => {
  const tSettings = (images) => Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'threads'), { images, videoQuality: 'auto', bestAudio: false });
  const small = pageJSON(plainPage('www.threads.com', tSettings('small'))).parse(IG_PHOTOS);
  assert.deepStrictEqual(igPhotoWidths(JSON.stringify(small)), [[640, 480, 320, 240, 150], [640, 320], [1440]]);
  const large = pageJSON(plainPage('www.threads.com', tSettings('large'))).parse(IG_PHOTOS);
  assert.deepStrictEqual(igPhotoWidths(JSON.stringify(large)), [[3072], [1080], [2048]]);
  const def = pageJSON(plainPage('www.threads.com', tSettings('default'))).parse(IG_PHOTOS);
  assert.strictEqual(igPhotoWidths(JSON.stringify(def))[0].length, 9);
  // API responses too (Highest).
  const page = loadPage('www.threads.com', STREAM_FILES, { XMLHttpRequest: threadsXhr(IG_PHOTOS), fetch: async () => {} }, tSettings('large'));
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', '/graphql/query');
  assert.deepStrictEqual(igPhotoWidths(xhr.responseText)[0], [3072]);
});

section('LinkedIn');

// LinkedIn's Video.js player is handed each video's quality list as JSON
// ("data:application/vnd.videojs.vhs+json,{...}"), from a real feed video.
function liList(variants) {
  return JSON.stringify({
    allowCache: true, discontinuityStarts: [], segments: [], endList: true,
    mediaGroups: { AUDIO: {}, VIDEO: {}, 'CLOSED-CAPTIONS': {}, SUBTITLES: {} }, uri: '', duration: 28,
    playlists: variants.map(([w, h, bw, codec], i) => ({
      attributes: { AUDIO: 'audio', BANDWIDTH: bw, CODECS: codec, NAME: 'B4D' + i, RESOLUTION: { width: w, height: h } },
      uri: '', resolvedUri: '', segments: [{ duration: 4, uri: `https://dms.licdn.com/playlist/vid/v2/D4D/hls-${h}p/B4D${i}/2/1` }],
    })),
    timelineStarts: [{ start: 0, timeline: 0 }],
  });
}
const AV1 = 'av01.0.04M.10,mp4a.40.2';
const AVC = 'avc1.42001e,mp4a.40.2';
const LI_VIDEO = liList([[1280, 720, 1900000, AVC], [1280, 720, 1500000, AVC], [960, 540, 900000, AVC], [854, 480, 600000, AVC], [640, 360, 400000, AVC], [1280, 720, 1100000, AV1]]);
const liPage = (q, extra) => plainPage('www.linkedin.com', Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'linkedin'), { videoQuality: q }, extra));
const liSizes = (page, text) => Array.from(pageJSON(page).parse(text).playlists, (p) => p.attributes.RESOLUTION.height + (p.attributes.CODECS.startsWith('av01') ? 'av1' : ''));

test('LinkedIn: the player quality list keeps only the chosen size (every codec at it)', () => {
  assert.deepStrictEqual(liSizes(liPage('min'), LI_VIDEO), ['360']);
  assert.deepStrictEqual(liSizes(liPage('480'), LI_VIDEO), ['480']);
  assert.deepStrictEqual(liSizes(liPage('max'), LI_VIDEO), ['720', '720', '720av1']);
  // Portrait videos go by the short side.
  const portrait = liList([[720, 1280, 1500000, AVC], [540, 960, 900000, AVC], [360, 640, 400000, AVC]]);
  assert.deepStrictEqual(liSizes(liPage('720'), portrait).length, 1);
  assert.strictEqual(pageJSON(liPage("720")).parse(portrait).playlists[0].attributes.RESOLUTION.width, 720);
});

test('LinkedIn: Site default, switched off, and other JSON are left alone', () => {
  assert.strictEqual(liSizes(liPage('auto'), LI_VIDEO).length, 6);
  assert.strictEqual(liSizes(liPage('min', { enabled: false }), LI_VIDEO).length, 6);
  const page = liPage('min');
  const other = JSON.stringify({ playlists: [1, 2], data: 'x'.repeat(300) });
  assert.strictEqual(JSON.stringify(pageJSON(page).parse(other)), other);
  // Reviver still works.
  assert.strictEqual(pageJSON(page).parse('{"a":1}', (k, v) => (k === 'a' ? 2 : v)).a, 2);
});

test('LinkedIn: registered, and only LinkedIn wraps JSON.parse for it', () => {
  assert.strictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'linkedin').vhsJson, true);
  const x = plainPage('x.com', Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'x'), { videoQuality: 'min' }));
  assert.strictEqual(liSizes(x, LI_VIDEO).length, 6);
});

section('Bluesky');

// A real Bluesky master playlist (video.bsky.app), shape and all.
const BSKY_URL = 'https://video.bsky.app/watch/did%3Aplc%3Aabc/bafkreiabc/playlist.m3u8';
const BSKY_MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:PROGRAM-ID=0,BANDWIDTH=710640,AVERAGE-BANDWIDTH=710640,CODECS="avc1.64001e",RESOLUTION=626x360
360p/video.m3u8?session_id=s1
#EXT-X-STREAM-INF:PROGRAM-ID=0,BANDWIDTH=2835792,AVERAGE-BANDWIDTH=2835792,CODECS="avc1.64001f",RESOLUTION=1252x720
720p/video.m3u8?session_id=s1
`;

test('Bluesky: master playlists from video.bsky.app follow the setting (XHR)', () => {
  for (const [q, want] of [['max', '720p'], ['min', '360p'], ['480', '360p']]) {
    class FakeXHR {
      open(method, url) { this._url = url; }
      get readyState() { return 4; }
      get responseURL() { return this._url; }
      get responseText() { return BSKY_MASTER; }
      get response() { return BSKY_MASTER; }
    }
    const settings = Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'bluesky'), { videoQuality: q });
    const page = loadPage('bsky.app', STREAM_FILES, { XMLHttpRequest: FakeXHR, fetch: async () => {} }, settings);
    const xhr = new page.XMLHttpRequest();
    xhr.open('GET', BSKY_URL);
    assert.deepStrictEqual(streams(xhr.responseText), [`https://video.bsky.app/watch/did%3Aplc%3Aabc/bafkreiabc/${want}/video.m3u8?session_id=s1`], q);
  }
});

section('TikTok');

// Each TikTok video lists ready-made MP4s ("bitrateInfo"); shaped like the
// data on tiktok.com/foryou (1080/720/540 in H.265, 540 in H.264).
const TT_URL = (gear) => `https://v16-webapp.tiktokcdn-eu.com/sig/6afe0d5b/video/tos/alisg/${gear}/?a=1988&br=1`;
function ttVideo(entries, playAddrGear) {
  return {
    id: '7', width: 576, height: 1024, definition: '540p', format: 'mp4',
    playAddr: TT_URL(playAddrGear), downloadAddr: TT_URL('dl'),
    bitrateInfo: entries.map(([w, h, br, codec, gear]) => ({
      Bitrate: br, QualityType: 2, GearName: gear, CodecType: codec, Format: 'mp4',
      PlayAddr: { Width: w, Height: h, Uri: gear, UrlList: [TT_URL(gear), TT_URL(gear) + '&b=2'], DataSize: 1 },
    })),
  };
}
const TT_ENTRIES = [
  [1080, 1920, 2157597, 'h265_hvc1', 'adapt_lowest_1080_1'],
  [720, 1280, 1161788, 'h265_hvc1', 'adapt_lower_720_1'],
  [576, 1024, 968752, 'h265_hvc1', 'adapt_540_1'],
  [576, 1024, 923009, 'h264', 'lowest_540_0'],
];
const ttFeed = () => JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.updated-items': [{ id: '7', video: ttVideo(TT_ENTRIES, 'lowest_540_0') }, { id: '8', desc: 'x'.repeat(250) }] } });
const ttPage = (q, extra) => plainPage('www.tiktok.com', Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'tiktok'), { videoQuality: q }, extra));
const ttGears = (data) => Array.from(data.__DEFAULT_SCOPE__['webapp.updated-items'][0].video.bitrateInfo, (b) => b.GearName);
const ttPlay = (data) => data.__DEFAULT_SCOPE__['webapp.updated-items'][0].video.playAddr;

test('TikTok: page data keeps only the chosen size (every codec at it)', () => {
  const max = pageJSON(ttPage('max')).parse(ttFeed());
  assert.deepStrictEqual(ttGears(max), ['adapt_lowest_1080_1']);
  assert.strictEqual(ttPlay(max), TT_URL('lowest_540_0'), 'no H.264 at 1080p: fallback address left alone');
  const min = pageJSON(ttPage('min')).parse(ttFeed());
  assert.deepStrictEqual(ttGears(min), ['adapt_540_1', 'lowest_540_0']);
  assert.strictEqual(ttPlay(min), TT_URL('lowest_540_0'));
  assert.deepStrictEqual(ttGears(pageJSON(ttPage('720')).parse(ttFeed())), ['adapt_lower_720_1']);
  assert.deepStrictEqual(ttGears(pageJSON(ttPage('1080')).parse(ttFeed())), ['adapt_lowest_1080_1']);
});

test('TikTok: the fallback address follows the size when an H.264 file exists there', () => {
  const entries = [[1080, 1920, 2000000, 'h264', 'normal_1080_0'], [576, 1024, 900000, 'h264', 'lowest_540_0']];
  const text = JSON.stringify({ itemList: [{ video: ttVideo(entries, 'lowest_540_0') }], pad: 'x'.repeat(250) });
  const out = pageJSON(ttPage('max')).parse(text);
  assert.strictEqual(out.itemList[0].video.playAddr, TT_URL('normal_1080_0'));
});

test('TikTok: API responses read with response.json() are filtered (same origin /api/ only)', async () => {
  const page = ttPage('min');
  const body = JSON.stringify({ itemList: [{ video: ttVideo(TT_ENTRIES, 'lowest_540_0') }] });
  const res = new page.Response(body, { status: 200 });
  Object.defineProperty(res, 'url', { value: 'https://www.tiktok.com/api/recommend/item_list/?aid=1988' });
  assert.strictEqual((await res.json()).itemList[0].video.bitrateInfo.length, 2);
  const other = new page.Response(body, { status: 200 });
  Object.defineProperty(other, 'url', { value: 'https://example.com/api/x' });
  assert.strictEqual((await other.json()).itemList[0].video.bitrateInfo.length, 4);
});

test('TikTok: Site default and switched off leave the data alone; other sites never filter it', () => {
  assert.strictEqual(ttGears(pageJSON(ttPage('auto')).parse(ttFeed())).length, 4);
  assert.strictEqual(ttGears(pageJSON(ttPage('min', { enabled: false })).parse(ttFeed())).length, 4);
  const x = plainPage('x.com', Object.assign({}, CONFIG.pageSettings(CONFIG.DEFAULTS, 'x'), { videoQuality: 'min' }));
  assert.strictEqual(ttGears(pageJSON(x).parse(ttFeed())).length, 4);
  assert.strictEqual(CONFIG.pageSettings(CONFIG.DEFAULTS, 'tiktok').bitrateJson, true);
});

// A tiny fake DOM element: enough for the bridge's badge layer.
function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], parentNode: null, attrs: {}, textContent: '', title: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; },
    remove() { if (this.parentNode) { const kids = this.parentNode.children; kids.splice(kids.indexOf(this), 1); this.parentNode = null; } },
  };
  return el;
}
function fakeVideo(w, h, rect) {
  return { tagName: 'VIDEO', isConnected: true, videoWidth: w, videoHeight: h, getBoundingClientRect: () => rect };
}
// A shadow root (open or closed) holding the given videos.
function fakeShadow(videos) {
  return { querySelectorAll: (sel) => (sel === 'video' ? videos : []) };
}

// Run the isolated-world bridge with a fake chrome.storage and page.
function loadBridge(hostname, stored, page) {
  page = page || {};
  const store = {};
  let onChanged = null;
  const frames = [];
  const docListeners = {};
  const documentElement = fakeEl('html');
  const sandbox = {
    console, JSON, Object, Map, Set, Math, URL,
    location: { hostname },
    innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    addEventListener() {},
    setInterval: () => 0,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    document: {
      documentElement, fullscreenElement: null, hidden: false,
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      createElement: fakeEl,
      querySelectorAll(sel) {
        if (sel === 'video') return page.videos || [];
        if (sel === 'shreddit-player, shreddit-player-2') return page.hosts || [];
        if (sel === 'img[srcset], source[srcset]') return page.imgs || [];
        return [];
      },
    },
    chrome: {
      dom: { openOrClosedShadowRoot: (el) => el.__closedShadow || el.shadowRoot || null },
      storage: {
        sync: { get: (defaults, cb) => cb(Object.assign({}, defaults, stored)) },
        onChanged: { addListener: (fn) => { onChanged = fn; } },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['shared/config.js', 'content/bridge.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  const flush = () => { while (frames.length) frames.shift()(); };
  const badges = () => {
    flush();
    const layer = documentElement.children.find((c) => 'data-qm-badges' in c.attrs);
    return layer ? layer.children.filter((b) => b.style.display !== 'none') : [];
  };
  const fire = (type, target) => (docListeners[type] || []).forEach((fn) => fn({ type, target }));
  return { pageSettings: () => JSON.parse(store.__qm_settings), change: (changes) => onChanged(changes, 'sync'), badges, fire };
}

test('bridge: settings removed by sync fall back to defaults instead of switching the site off', () => {
  const b = loadBridge('www.instagram.com', { instagram_videoQuality: '480' });
  assert.strictEqual(b.pageSettings().videoQuality, '480');
  assert.strictEqual(b.pageSettings().enabled, true);
  // Sync replaces storage with a copy from before Instagram existed.
  b.change({ instagram_enabled: { oldValue: true }, instagram_videoQuality: { oldValue: '480' } });
  assert.strictEqual(b.pageSettings().enabled, true);
  assert.strictEqual(b.pageSettings().videoQuality, CONFIG.DEFAULTS.instagram_videoQuality);
  // A real change still applies.
  b.change({ instagram_enabled: { oldValue: true, newValue: false } });
  assert.strictEqual(b.pageSettings().enabled, false);
});

test('badge: YouTube videos get one, over the video corner, on a page-level layer', () => {
  const video = fakeVideo(1920, 1080, { left: 100, top: 50, right: 1380, bottom: 770, width: 1280, height: 720 });
  const b = loadBridge('www.youtube.com', {}, { videos: [video] });
  const [badge, ...rest] = b.badges();
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(badge.textContent, '1080p');
  assert.strictEqual(badge.style.transform, 'translate(108px, 58px)');
});

test('badge: Reddit videos inside a closed shadow root are found', () => {
  const video = fakeVideo(720, 1280, { left: 0, top: 200, right: 400, bottom: 900, width: 400, height: 700 });
  const host = { localName: 'shreddit-player-2', shadowRoot: null, __closedShadow: fakeShadow([video]) };
  const b = loadBridge('www.reddit.com', {}, { hosts: [host] });
  assert.deepStrictEqual(b.badges().map((x) => x.textContent), ['720p']);
});

test('badge: hidden for tiny or off-screen videos, removed when switched off', () => {
  const big = fakeVideo(3840, 2160, { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 });
  const tiny = fakeVideo(640, 360, { left: 0, top: 0, right: 60, bottom: 40, width: 60, height: 40 });
  const below = fakeVideo(640, 360, { left: 0, top: 900, right: 640, bottom: 1260, width: 640, height: 360 });
  const b = loadBridge('x.com', {}, { videos: [big, tiny, below] });
  assert.deepStrictEqual(b.badges().map((x) => x.textContent), ['4K']);
  b.change({ showBadge: { oldValue: true, newValue: false } });
  assert.deepStrictEqual(b.badges(), []);
});

// A fake <img> with a srcset, laid out at `width` CSS pixels (0 = not yet).
function fakeImg(srcset, width) {
  const attrs = { srcset };
  return {
    tagName: 'IMG', nodeType: 1,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getBoundingClientRect: () => ({ width }),
    get srcset() { return attrs.srcset; },
  };
}
const RD = (w) => `https://preview.redd.it/my-post-v0-abc123.jpeg?width=${w}&crop=smart&auto=webp&s=sig${w}`;
const REDDIT_SRCSET = [108, 216, 320, 640, 960, 1080].map((w) => `${RD(w)} ${w}w`).join(', ');
const IG = (w) => `https://scontent-ams2-1.cdninstagram.com/v/t51.29350-15/1_n.jpg?stp=dst-jpg_e35_p${w}x${w}&_nc_ht=x&oh=00_${w}&oe=1`;
const IG_SRCSET = [150, 240, 320, 480, 640, 750, 1080].map((w) => `${IG(w)} ${w}w`).join(',');

test('images: Reddit data saver picks the largest size no wider than the image', () => {
  const img = fakeImg(REDDIT_SRCSET, 500);
  loadBridge('www.reddit.com', { reddit_images: 'small' }, { imgs: [img] });
  assert.strictEqual(img.srcset, `${RD(320)} 320w`);
  // The feed case from a real Reddit page: shown at 892px, sizes 640/1080 -> 640.
  const feed = fakeImg(`${RD(640)} 640w, ${RD(1080)} 1080w`, 892);
  loadBridge('www.reddit.com', { reddit_images: 'small' }, { imgs: [feed] });
  assert.strictEqual(feed.srcset, `${RD(640)} 640w`);
  // Narrower than every size: the smallest.
  const tiny = fakeImg(`${RD(640)} 640w, ${RD(1080)} 1080w`, 300);
  loadBridge('www.reddit.com', { reddit_images: 'small' }, { imgs: [tiny] });
  assert.strictEqual(tiny.srcset, `${RD(640)} 640w`);
});

test('images: Reddit largest preview; default and original leave the srcset alone', () => {
  const big = fakeImg(REDDIT_SRCSET, 300);
  loadBridge('www.reddit.com', { reddit_images: 'large' }, { imgs: [big] });
  assert.strictEqual(big.srcset, `${RD(1080)} 1080w`);
  for (const mode of ['default', 'orig']) {
    const img = fakeImg(REDDIT_SRCSET, 300);
    loadBridge('www.reddit.com', { reddit_images: mode }, { imgs: [img] });
    assert.strictEqual(img.srcset, REDDIT_SRCSET, mode);
  }
});

test('images: switching back to default restores the site srcset', () => {
  const img = fakeImg(REDDIT_SRCSET, 200);
  const b = loadBridge('www.reddit.com', { reddit_images: 'small' }, { imgs: [img] });
  assert.strictEqual(img.srcset, `${RD(108)} 108w`);
  b.change({ reddit_images: { oldValue: 'small', newValue: 'default' } });
  assert.strictEqual(img.srcset, REDDIT_SRCSET);
});

test('images: Instagram data saver (not laid out yet -> modest size); default untouched', () => {
  const img = fakeImg(IG_SRCSET, 0);
  loadBridge('www.instagram.com', { instagram_images: 'small' }, { imgs: [img] });
  assert.strictEqual(img.srcset, `${IG(480)} 480w`);
  const laid = fakeImg(IG_SRCSET, 600);
  loadBridge('www.instagram.com', { instagram_images: 'small' }, { imgs: [laid] });
  assert.strictEqual(laid.srcset, `${IG(480)} 480w`);
  const def = fakeImg(IG_SRCSET, 600);
  loadBridge('www.instagram.com', {}, { imgs: [def] });
  assert.strictEqual(def.srcset, IG_SRCSET);
});

const LI = (w) => `https://media.licdn.com/dms/image/v2/D4D22AQabc/feedshare-shrink_${w}/B4DZabc/0/1700000000000?e=1&v=beta&t=sig${w}`;
const LI_SRCSET = [20, 160, 480, 800, 1280, 2048].map((w) => `${LI(w)} ${w}w`).join(', ');

test('images: LinkedIn data saver takes the smallest size that fills the slot; Highest the largest', () => {
  const img = fakeImg(LI_SRCSET, 470);
  loadBridge('www.linkedin.com', { linkedin_images: 'small' }, { imgs: [img] });
  assert.strictEqual(img.srcset, `${LI(480)} 480w`);
  const wide = fakeImg(LI_SRCSET, 3000);
  loadBridge('www.linkedin.com', { linkedin_images: 'small' }, { imgs: [wide] });
  assert.strictEqual(wide.srcset, `${LI(2048)} 2048w`);
  const big = fakeImg(LI_SRCSET, 470);
  loadBridge('www.linkedin.com', { linkedin_images: 'large' }, { imgs: [big] });
  assert.strictEqual(big.srcset, `${LI(2048)} 2048w`);
  const def = fakeImg(LI_SRCSET, 470);
  loadBridge('www.linkedin.com', {}, { imgs: [def] });
  assert.strictEqual(def.srcset, LI_SRCSET);
});

test('images: Threads srcset (Highest and Data saver), like Instagram sizes', () => {
  const big = fakeImg(IG_SRCSET, 210);
  loadBridge('www.threads.com', { threads_images: 'large' }, { imgs: [big] });
  assert.strictEqual(big.srcset, `${IG(1080)} 1080w`);
  const small = fakeImg(IG_SRCSET, 210);
  loadBridge('www.threads.com', { threads_images: 'small' }, { imgs: [small] });
  assert.strictEqual(small.srcset, `${IG(150)} 150w`);
  const def = fakeImg(IG_SRCSET, 210);
  loadBridge('www.threads.com', {}, { imgs: [def] });
  assert.strictEqual(def.srcset, IG_SRCSET);
});

test('images: other hosts, single sizes and switched-off sites are left alone', () => {
  const other = fakeImg('https://example.com/a.jpg 320w, https://example.com/b.jpg 640w', 300);
  const single = fakeImg(`${RD(640)} 640w`, 300);
  loadBridge('www.reddit.com', { reddit_images: 'small' }, { imgs: [other, single] });
  assert.ok(other.srcset.includes('b.jpg'));
  assert.strictEqual(single.srcset, `${RD(640)} 640w`);
  const off = fakeImg(REDDIT_SRCSET, 300);
  loadBridge('www.reddit.com', { reddit_images: 'small', reddit_enabled: false }, { imgs: [off] });
  assert.strictEqual(off.srcset, REDDIT_SRCSET);
});

test('X original/4096: the timeline own large (and 4096) images are upgraded too', () => {
  const orig = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'orig' }));
  assert.strictEqual(applyDnr(orig, 'https://pbs.twimg.com/media/Gab?format=jpg&name=large'), 'https://pbs.twimg.com/media/Gab?name=orig&format=jpg');
  assert.strictEqual(applyDnr(orig, 'https://pbs.twimg.com/media/Gab?format=jpg&name=4096x4096'), 'https://pbs.twimg.com/media/Gab?name=orig&format=jpg');
  const big = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: '4096x4096' }));
  assert.strictEqual(applyDnr(big, 'https://pbs.twimg.com/media/Gab?format=jpg&name=large'), 'https://pbs.twimg.com/media/Gab?name=4096x4096&format=jpg');
});

test('X original: WebP requests ask for the original JPG', () => {
  const rules = bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'orig' }));
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/media/Gab?format=webp&name=large'), 'https://pbs.twimg.com/media/Gab?name=orig&format=jpg');
  assert.strictEqual(applyDnr(rules, 'https://pbs.twimg.com/media/Gab?format=png&name=small'), 'https://pbs.twimg.com/media/Gab?name=orig&format=png');
  // Other targets keep WebP (resized copies exist in every format).
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: '4096x4096' })), 'https://pbs.twimg.com/media/Gab?format=webp&name=large'),
    'https://pbs.twimg.com/media/Gab?name=4096x4096&format=webp');
});

test('X original: a photo that still fails is retried once at 4096px, not redirected again', () => {
  const mkImg = (src) => ({ tagName: 'IMG', src, currentSrc: src, dataset: {}, hasAttribute: () => false, removeAttribute() {} });
  const b = loadBridge('x.com', { x_feedImages: 'orig' });
  const img = mkImg('https://pbs.twimg.com/media/Gab?format=webp&name=large');
  b.fire('error', img);
  assert.strictEqual(img.src, 'https://pbs.twimg.com/media/Gab?name=4096x4096&format=webp');
  // The retry URL is name-first, so no redirect rule matches it.
  assert.strictEqual(applyDnr(bg.__QM_BUILD_RULES__(withSettings({ x_feedImages: 'orig' })), img.src), img.src);
  // Only once.
  img.src = 'https://pbs.twimg.com/media/Gab?format=webp&name=large';
  img.currentSrc = img.src;
  b.fire('error', img);
  assert.strictEqual(img.src, 'https://pbs.twimg.com/media/Gab?format=webp&name=large');
  // Not for other settings, other images or other sites.
  const large = loadBridge('x.com', { x_feedImages: 'large' });
  const other = mkImg('https://pbs.twimg.com/media/Gab?format=webp&name=large');
  large.fire('error', other);
  assert.strictEqual(other.src, 'https://pbs.twimg.com/media/Gab?format=webp&name=large');
  const avatar = mkImg('https://pbs.twimg.com/profile_images/1/A_normal.jpg');
  b.fire('error', avatar);
  assert.strictEqual(avatar.src, 'https://pbs.twimg.com/profile_images/1/A_normal.jpg');
});

// =========================================================================
section('Manifest');

test('manifest description fits the stores (Edge: 132 characters)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'manifest.json'), 'utf8'));
  assert.ok(m.description.length <= 132, `description is ${m.description.length} characters`);
});

test('every script the manifest references exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const files = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap((c) => c.js)];
  for (const f of files) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'missing ' + f);
  assert.strictEqual(manifest.name, 'Quality Manager');
});

test('no script is listed in two content-script entries (Chrome runs each file once per page)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  const seen = new Map();
  manifest.content_scripts.forEach((entry, i) => {
    for (const f of entry.js) {
      assert.ok(!seen.has(f), `${f} is in content_scripts[${seen.get(f)}] and [${i}]`);
      seen.set(f, i);
    }
  });
});

runQueued().then(() => {
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
});
