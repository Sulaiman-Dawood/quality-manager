# Quality Manager

[![CI](https://github.com/Sulaiman-Dawood/quality-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Sulaiman-Dawood/quality-manager/actions/workflows/ci.yml)

A Chrome and Firefox extension that controls video and image quality on **X**, **Reddit**, **YouTube**, **Instagram**, **Threads**, **LinkedIn**, **TikTok** and **Bluesky**: force the best, cap it, or save data.

## Features

| Site | Video | Images |
|---|---|---|
| X | ✓ | Highest (original), Data saver, Site default |
| Reddit | ✓ | Highest (original), Data saver, Site default |
| YouTube | ✓ | — |
| Instagram | ✓ | Data saver, Site default |
| Threads | ✓ | Highest, Data saver, Site default |
| LinkedIn | ✓ | Highest, Data saver, Site default |
| TikTok | ✓ | — |
| Bluesky | ✓ | Highest (full size), Site default |

- **Video:** Highest, Up to 1080p / 720p / 480p, Data saver, or Site default.
- **All sites → Highest / Data saver** sets everything at once.
- **Resolution badge** on videos, **best audio**, and per-site on/off switches.

## Install

**Firefox:** [Quality Manager on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/quality-manager/). Updates install automatically.

**Microsoft Edge:** [Quality Manager on Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/quality-manager/fphggkohkinjkanigapnbinagbebkkmm). Updates install automatically.

**Chrome, Brave and other Chromium browsers (manual install)**

1. Download `quality-manager-<version>.zip` from the [latest release](https://github.com/Sulaiman-Dawood/quality-manager/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

A manual install doesn't update itself: download the new zip when a release comes out.

Then reload any open X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok or Bluesky tabs.

Pick a site from the popup's dropdown to see its settings. Changes apply after a reload.

## Limits

- Quality can't go higher than what was uploaded, or lower than the lowest version the site offers.
- On Instagram and Threads, the lower versions are often the same picture size at a lower bitrate, so Data saver can still show 540p or 720p on the badge while using far less data.
- LinkedIn photos without a size list (such as document pages) stay as LinkedIn serves them.
- X's Data saver also applies to photos opened full screen.
- Sites change their code. When one does, the extension stops having an effect there instead of breaking playback.

## Developing

- `node test/run-tests.js` runs the unit tests.
- `node tools/build.mjs` builds the Chrome/Edge and Firefox zips into `dist/`.
- GitHub Actions runs the tests and builds both zips on every push. Publishing a GitHub release (tag `v` + the manifest version, e.g. `v1.3.0`) attaches the zips to it automatically.
- `node tools/check.mjs` loads the extension into real Edge and Firefox and checks it on public sites (YouTube, Bluesky, TikTok). Run it before a release; sites change their code without warning.

## License

[MIT](LICENSE)
