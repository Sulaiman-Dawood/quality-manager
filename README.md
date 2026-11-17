# Quality Manager

A Chrome extension that controls video and image quality on **X**, **Reddit**, **YouTube**, **Instagram**, **Threads**, **LinkedIn**, **TikTok** and **Bluesky**: force the best, cap it, or save data.

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

1. Download `quality-manager-1.2.1.zip` from the latest release and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Reload any open X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok or Bluesky tabs.

Pick a site from the popup's dropdown to see its settings. Changes apply after a reload.

## Limits

- Quality can't go higher than what was uploaded, or lower than the lowest version the site offers.
- On Instagram and Threads, the lower versions are often the same picture size at a lower bitrate, so Data saver can still show 540p or 720p on the badge while using far less data.
- LinkedIn photos without a size list (such as document pages) stay as LinkedIn serves them.
- X's Data saver also applies to photos opened full screen.
- Sites change their code. When one does, the extension stops having an effect there instead of breaking playback.
