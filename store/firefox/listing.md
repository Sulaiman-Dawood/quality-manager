# Firefox Add-ons (AMO) listing

Submit at https://addons.mozilla.org/developers → **Submit a New Add-on**.

## 1. Distribution

Choose **On this site**, so it gets a public listing and updates automatically.

## 2. Upload

Upload `quality-manager-<version>-firefox.zip` from the GitHub release, or build it with `node tools/build.mjs`.

- **Compatible platforms:** Firefox (desktop) only. Leave Android unticked; it hasn't been tested there.
- **"Do you need to submit source code?"** Answer **No**. Nothing is minified, bundled or generated; the zip holds the source files as they are.

## 3. Describe the add-on

**Name**

Quality Manager

**Add-on URL**

`quality-manager`. If that's taken, use `quality-manager-video`.

**Summary** (250 characters max)

Choose video and image quality on X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok and Bluesky. Force the best quality, cap it at 1080p, 720p or 480p, or save data.

**Description**

Sites pick video and image quality for you, and often get it wrong. You get blurry videos on a fast connection, or 4K on a phone hotspot. Quality Manager lets you choose instead.

<b>Video quality on 8 sites</b>
X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok and Bluesky. For each site, pick:
• Highest: the best version the site has
• Up to 1080p, 720p or 480p
• Data saver: the smallest version
• Site default: leave it to the site

<b>Image quality</b>
• X and Reddit: original uploads, or smaller previews to save data
• LinkedIn and Threads: the largest size listed, or a smaller one
• Instagram: smaller photos to save data
• Bluesky: full-size photos instead of 1000px previews

<b>One tap for everything</b>
"All sites → Highest" or "All sites → Data saver" sets video and images everywhere at once.

<b>Also</b>
• A resolution badge on each video shows what's actually playing
• Best audio quality where the site offers a choice
• Turn it off for any site with one switch

<b>Private by design</b>
No accounts, no tracking, no analytics, and no data leaves your browser.

<b>Limits</b>
Quality can't go higher than what was uploaded, or lower than the lowest version the site offers. Some sizes exist only in formats your browser may not play (for example H.265); the extension then picks the best size your browser can play.

Open source: https://github.com/Sulaiman-Dawood/quality-manager

**Categories** (pick up to 2)

- Photos, Music & Videos
- Social & Communication

**Tags**

video quality, youtube, reddit, twitter, tiktok, data saver

**Support website**

https://github.com/Sulaiman-Dawood/quality-manager/issues

**Homepage**

https://github.com/Sulaiman-Dawood/quality-manager

**License**

The repository has no license file yet, so this is your choice:
- **All Rights Reserved:** people can install and use it, but not reuse the code.
- **MIT:** the most common open-source license; anyone can reuse the code if they keep your copyright notice.

**Privacy policy**

Tick "This add-on has a privacy policy" and paste the text of `PRIVACY.md`.

**Notes to reviewer**

> Quality Manager changes the video and image quality the supported sites load. It collects no data (data_collection_permissions: none) and has no server.
>
> - storage: saves the user's settings.
> - declarativeNetRequestWithHostAccess: redirects image requests on X (pbs.twimg.com), Reddit (preview.redd.it to i.redd.it) and Bluesky (cdn.bsky.app) to a larger or smaller copy of the same image, per the user's setting.
> - Host access to x.com, twitter.com, reddit.com, youtube.com, instagram.com, threads.com/threads.net, linkedin.com, tiktok.com and bsky.app: content scripts that remove, from the quality list each site's player reads, the versions the user didn't choose. Some run in the page's MAIN world because the player reads the list there. They hook XMLHttpRequest/Response body getters and JSON.parse on those sites only, and only rewrite video/photo quality lists.
>
> No code is minified or generated. Source: https://github.com/Sulaiman-Dawood/quality-manager (tools/build.mjs builds this zip; tools/firefox-manifest.js makes the Firefox manifest).
>
> How to test (no login needed): open a YouTube video. The badge in the video's top-left corner shows the resolution playing. In the toolbar popup, set YouTube's "Video quality" to "Data saver", click "Reload tab", and the badge drops to the lowest quality.

## 4. Images

| Field | File |
|---|---|
| Icon | Taken from the package (`icons/icon128.png`) |
| Screenshots | `store/edge/screenshot-1-quality.png`, `screenshot-2-sites.png`, `screenshot-3-all-sites.png` (1280×800) |

## 5. Version notes (for each new version)

1.3.0: First Firefox release. Video quality on 8 sites, image options on X, Reddit, Instagram, Threads, LinkedIn and Bluesky, and a resolution badge.

## After submitting

- The automatic check runs in minutes. It may show warnings (for example about the scripts that run in the page's own world). Warnings don't block publishing; only errors do.
- Once it's signed, the listing goes live, and users install it permanently from addons.mozilla.org.
- **Updates:** upload each new `-firefox.zip` under **Manage Status & Versions → Upload a New Version**. The version in `manifest.json` must go up each time.
