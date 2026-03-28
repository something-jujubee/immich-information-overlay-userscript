# Immich Mobile Userscript - Vibe Coded

A Tampermonkey userscript that overlays useful metadata badges on every thumbnail in [Immich](https://immich.app/) — file size, filename, RAW indicator, and album status. Designed for photo culling workflows on both the timeline (`/photos`) and album (`/albums`) pages.

![Version](https://img.shields.io/badge/version-2.3-blue) ![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-green)

---

## What It Does

Each thumbnail gets up to four badges overlaid on it:

| Badge | Position | Description |
|-------|----------|-------------|
| 📁 Album Name | Top-left (blue) | The album this asset belongs to |
| ➕ No Album | Top-left (amber) | Warning — asset has not been added to any album yet |
| `RAW` | Top-right (yellow) | Asset is a RAW file (CR2, CR3, ARW, DNG, NEF, ORF, GPR, RW2, RAF) |
| File size | Bottom-left | e.g. `29.5 MB` |
| Filename | Bottom-right | e.g. `IMG_4633.CR3` |

### On the `/photos` timeline page
Every thumbnail shows its album status. Blue = already filed, amber = needs an album. This lets you identify unorganised assets at a glance without opening each photo individually.

### On an `/albums/{id}` page
The album name is fetched once for the whole page (a single API call) and displayed on every thumbnail.

---

## Screenshots

> _Add your own screenshots here_

---

## Installation

### Prerequisites
- [Tampermonkey](https://www.tampermonkey.net/) browser extension (Chrome, Edge, Firefox, Safari)
- A running Immich instance (self-hosted)

### Steps

1. Install [Tampermonkey](https://www.tampermonkey.net/) if you haven't already.
2. Click **"Create a new script"** in the Tampermonkey dashboard.
3. Paste the full contents of [`immich-plus-mobile.user.js`](./immich-plus-mobile.user.js) into the editor.
4. Save with `Ctrl+S` (or `Cmd+S`).
5. Navigate to your Immich instance — the badges will appear automatically.

> **Tip:** If you have Tampermonkey set to auto-update, you can also host the raw file on GitHub and point `@updateURL` / `@downloadURL` to the raw URL for automatic updates.

---

## How It Works

### Layout — no interference with Immich's grid
Overlays are appended to `document.body` as `position: fixed` elements, positioned using `getBoundingClientRect()` to match each thumbnail's screen coordinates. The script **never modifies** Immich's grid/masonry container elements, which prevents layout breakage.

Overlays reposition themselves on scroll, resize, wheel, and touch events via `requestAnimationFrame`.

### API calls — efficient and safe
- **Asset details** (`/api/assets/{id}`): fetched once per asset, cached for the session.
- **Album membership** (`/api/assets/{id}/albums`): fetched once per asset on the `/photos` page, cached for the session.
- **Album name** (`/api/albums/{id}`): fetched **once per album page**, shared across all thumbnails.
- All fetches are throttled to **6 concurrent requests** max via an internal queue, so the Immich server is never flooded.
- Each asset is fetched at most once — repeat scans from scrolling or the 2-second interval never re-fetch.

### SPA navigation support
Immich uses client-side routing. The script intercepts `history.pushState` / `replaceState` and `popstate` to reset the album name cache when you navigate between pages.

---

## Configuration

All tweaks are at the top of the script or in the CSS block. Common ones:

### Change concurrency limit
```js
const apiQueue = new ThrottledQueue(6); // lower to 3 for slower servers
```

### Change badge colours
```css
.i-album    { background: rgba(30, 64, 175, 0.88); }  /* Blue — has album */
.i-no-album { background: rgba(180, 83, 9, 0.88);  }  /* Amber — no album */
.i-raw      { background: #eab308; color: #000;    }  /* Yellow — RAW */
```

### Change font size
```css
.i-badge { font-size: 10px; } /* Increase for larger thumbnails */
```

### Add more RAW formats
```js
const RAW_EXTS = new Set(['CR2','CR3','ARW','DNG','NEF','ORF','GPR','RW2','RAF']);
// Add your format: 'IIQ', 'FFF', 'SRW', etc.
```

---

## Compatibility

| Browser | Status |
|---------|--------|
| Chrome / Edge (desktop) | ✅ Tested |
| Firefox (desktop) | ✅ Should work |
| Edge (Android) | ✅ Tested (primary use case) |
| Safari (iOS) | ⚠️ Requires Userscripts app instead of Tampermonkey |

Tested against **Immich v1.x** self-hosted. The script relies on the following stable Immich API endpoints:

- `GET /api/assets/{id}`
- `GET /api/assets/{id}/albums`
- `GET /api/albums/{id}`

---

## Troubleshooting

**Badges not appearing**
- Open browser DevTools → Console and check for `IMMICH PLUS v2.3 STARTING`. If missing, Tampermonkey isn't running the script.
- Check that the `@match` pattern covers your Immich URL. The default `*://*/*` matches everything.

**Layout looks broken / thumbnails misaligned**
- Make sure you're using v2.3+. Earlier versions modified `position` on Immich's grid containers, which caused layout issues.

**Album badge shows "➕ No Album" for everything**
- Check DevTools → Network for requests to `/api/assets/{id}/albums`. If they're returning 401, your session may have expired — log in again.

**Badges don't follow thumbnails when scrolling**
- This is handled by scroll/resize listeners. If it's happening, check the console for JS errors that might be stopping the reposition loop.

**Script runs on every site, not just Immich**
- Change the `@match` line in the script header to your specific Immich URL:
```
// @match  http://192.168.0.23:2283/*
```

---

## Contributing

PRs and issues welcome. If you add support for new RAW formats, additional badge types, or other Immich API features, feel free to open a PR.

---

## License

MIT — do whatever you like with it.
