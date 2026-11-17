# Microsoft Edge Add-ons listing

Copy each part into Partner Center (Extensions → your extension → Store listings → English).

## Package

Upload `dist/quality-manager-1.2.2.zip` (from the GitHub release).

## Name

Quality Manager

## Short description

Choose video and image quality on X, Reddit, YouTube, Instagram, TikTok and more. Force the best, or save data.

## Description

Sites pick video and image quality for you, and often get it wrong. You get blurry videos on a fast connection, or 4K on a phone hotspot. Quality Manager lets you choose instead.

VIDEO QUALITY ON 8 SITES
X, Reddit, YouTube, Instagram, Threads, LinkedIn, TikTok and Bluesky. For each site, pick:
• Highest: the best version the site has
• Up to 1080p, 720p or 480p
• Data saver: the smallest version
• Site default: leave it to the site

IMAGE QUALITY
• X and Reddit: original uploads, or smaller previews to save data
• LinkedIn and Threads: the largest size listed, or a smaller one
• Instagram: smaller photos to save data
• Bluesky: full-size photos instead of 1000px previews

ONE TAP FOR EVERYTHING
"All sites → Highest" or "All sites → Data saver" sets video and images everywhere at once.

ALSO
• A resolution badge on each video shows what's actually playing
• Best audio quality where the site offers a choice
• Turn the extension off for any site with one switch

PRIVATE BY DESIGN
No accounts, no tracking, no analytics, and no data leaves your browser. Settings stay in your browser.

LIMITS
Quality can't go higher than what was uploaded, or lower than the lowest version the site offers. On Instagram and Threads, the lower versions are often the same picture size at a lower bitrate, so Data saver can still show 540p or 720p on the badge while using far less data.

Open source: https://github.com/Sulaiman-Dawood/quality-manager

## Category

Social

## Search terms

Edge allows up to 7.

- video quality
- data saver
- youtube 4k
- reddit hd video
- twitter image quality
- tiktok hd
- instagram quality

## Privacy policy URL

https://github.com/Sulaiman-Dawood/quality-manager/blob/main/PRIVACY.md

(This page goes live once `PRIVACY.md` is pushed to GitHub.)

## Website / support URL

https://github.com/Sulaiman-Dawood/quality-manager

## Images

| Field | File |
|---|---|
| Extension Store logo (300×300) | `store/edge/logo-300.png` |
| Screenshots (1280×800) | `store/edge/screenshot-1-quality.png`, `screenshot-2-sites.png`, `screenshot-3-all-sites.png` |
| Small promotional tile (440×280, optional) | `store/edge/promo-440x280.png` |

To rebuild them: `node store/make-assets.mjs` (needs Microsoft Edge).

## Availability and pricing

- Visibility: Public
- Markets: all
- Pricing: Free

## Notes for certification

Paste this into the "Notes for certification" box:

> Quality Manager changes the video and image quality that the supported sites load. It has no server and collects no data.
>
> Permissions:
> - storage: saves the user's settings.
> - declarativeNetRequestWithHostAccess: redirects image requests on X (pbs.twimg.com), Reddit (preview.redd.it to i.redd.it) and Bluesky (cdn.bsky.app) to a larger or smaller copy of the same image, depending on the user's setting.
> - Host access to x.com, twitter.com, reddit.com, youtube.com, instagram.com, threads.com, linkedin.com, tiktok.com and bsky.app: content scripts that pick the video quality. On each site, they remove the versions the user didn't choose from the quality list the site's player reads. Some of these scripts run in the page's main world, because the player reads the list there.
>
> How to test: install, open any YouTube video, and open the extension popup. "Video quality" is "Highest" by default, and the badge on the video's top-left corner shows the resolution playing. Change it to "Data saver", click "Reload tab", and the badge drops to the lowest quality.
>
> No login is needed for YouTube. Source code: https://github.com/Sulaiman-Dawood/quality-manager
