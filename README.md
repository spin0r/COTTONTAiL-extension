# DS Thumbnail Picker — Chrome/Edge Extension

A browser extension that lets you search DrunkenSlug and save thumbnails directly to COTTONTAiL log entries — with one click from the logs page.

---

## Flow

1. On the COTTONTAiL `/log` page, each row gets a small **DS 🔍** button in the actions column.
2. Click it → the extension stores that row's `msg_id` + `fileName`.
3. Click the extension icon — the popup opens pre-filled with a cleaned search query.
4. Browse the results grid (thumbnails shown inline), adjust the query/category as needed.
5. Click a card to select it, then **Save to Log Entry** — the background worker POSTs the thumbnail URL to `/api/logs/:id/sample`.
6. The green dot appears on that row in the log list.

---

## Setup

### 1. Convert the SVG icon to PNGs

You need `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`.

Quick option — use Inkscape CLI:
```bash
inkscape icons/icon.svg -w 16  -h 16  -o icons/icon16.png
inkscape icons/icon.svg -w 48  -h 48  -o icons/icon48.png
inkscape icons/icon.svg -w 128 -h 128 -o icons/icon128.png
```

Or use any online SVG→PNG converter.

### 2. Install dependencies and build

```bash
cd extension
npm install
npm run build        # outputs to extension/dist/
```

Watch mode (auto-rebuild on save):
```bash
npm run dev
```

### 3. Load into Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/dist/` folder

---

## Cookie Setup

1. Log in to [drunkenslug.com](https://drunkenslug.com)
2. Install **Get cookies.txt LOCALLY** (Chrome extension)
3. On drunkenslug.com, click the extension → **Export** → copies Netscape-format cookies
4. In the DS Thumbnail Picker popup → **Cookies** tab → paste → **Save Cookies**

The cookies are stored in `chrome.storage.local` (local device only, never leaves the browser).

---

## File structure

```
extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── icons/
│   ├── icon.svg          ← source, convert to PNGs
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── types.ts           ← shared types + message protocol
    ├── background.ts      ← service worker (DS search proxy + save relay)
    ├── content.ts         ← injects DS button into logs page rows
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.ts
```
