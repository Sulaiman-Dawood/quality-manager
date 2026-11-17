# Quality Manager

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

**Chrome, Edge, Brave and other Chromium browsers**

1. Download `quality-manager-1.3.0.zip` from the latest release and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

**Firefox** (128 or newer)

1. Download `quality-manager-1.3.0-firefox.zip` from the latest release.
2. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Select the zip. Firefox removes temporary add-ons when it closes; a permanent install needs the version signed by Mozilla.

Then reload any open X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok or Bluesky tabs.

Pick a site from the popup's dropdown to see its settings. Changes apply after a reload.

## Limits

- Quality can't go higher than what was uploaded, or lower than the lowest version the site offers.
- On Instagram and Threads, the lower versions are often the same picture size at a lower bitrate, so Data saver can still show 540p or 720p on the badge while using far less data.
- LinkedIn photos without a size list (such as document pages) stay as LinkedIn serves them.
- X's Data saver also applies to photos opened full screen.
- Sites change their code. When one does, the extension stops having an effect there instead of breaking playback.
