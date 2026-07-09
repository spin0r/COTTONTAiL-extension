/**
 * background.ts — Service Worker
 *
 * Responsibilities:
 *  1. Store the pending LogEntry when content.ts fires SET_LOG_CONTEXT
 *  2. Proxy DS searches: parse Netscape cookies → fetch DS /search HTML → scrape results
 *  3. Relay SAVE_THUMB requests to the COTTONTAiL app's /api/logs/:id/sample endpoint
 */

import type {
  ExtMessage,
  DSResult,
  SearchResultMsg,
  SaveThumbResultMsg,
  StoredSettings,
  LogEntry,
} from "./types";

// ─── Netscape cookie parser ───────────────────────────────────────────────────
// Handles both tab-separated AND space-separated Netscape cookie formats,
// including lines prefixed with #HttpOnly_ (Cookie-Editor export style).
//
// Column order: domain  httpOnly  path  secure  expiry  name  value

interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

function parseNetscapeCookies(raw: string): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];

  for (let line of raw.split("\n")) {
    line = line.trim();
    if (!line) continue;

    // Strip #HttpOnly_ prefix — Cookie-Editor uses this for HttpOnly cookies
    if (line.startsWith("#HttpOnly_")) {
      line = line.slice("#HttpOnly_".length).trim();
    } else if (line.startsWith("#")) {
      // Pure comment line — skip
      continue;
    }

    // Split on any run of whitespace (tabs OR multiple spaces)
    const parts = line.split(/\s+/);
    if (parts.length < 7) continue;

    // domain  httpOnly  path  secure  expiry  name  value
    const [domain, , path, secureStr, , name, ...valueParts] = parts;
    if (!name || !domain) continue;

    // Value may contain spaces — rejoin remaining parts
    const value = valueParts.join(" ");

    cookies.push({
      domain: domain.replace(/^\./, ""),  // strip leading dot for chrome.cookies
      path,
      secure: secureStr.toUpperCase() === "TRUE",
      name,
      value,
    });
  }

  return cookies;
}

/** Inject parsed cookies into Chrome's cookie store so fetch() will send them */
async function injectCookies(cookies: ParsedCookie[]): Promise<void> {
  for (const c of cookies) {
    const url = `http${c.secure ? "s" : ""}://${c.domain.replace(/^\./, "")}${c.path}`;
    try {
      await chrome.cookies.set({
        url,
        domain: c.domain,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
      });
    } catch (e) {
      console.warn(`Failed to set cookie ${c.name}:`, e);
    }
  }
}

/** Extract XSRF-TOKEN value (URL-decoded) for the X-XSRF-TOKEN header */
function extractXsrf(cookies: ParsedCookie[]): string {
  const c = cookies.find((x) => x.name === "XSRF-TOKEN");
  if (!c) return "";
  try { return decodeURIComponent(c.value); } catch { return c.value; }
}

// ─── DS HTML scraper ──────────────────────────────────────────────────────────
// Parse the search results table from DrunkenSlug's /search/<query> page.
// We avoid any CORS/API complexity by just fetching the page HTML.

const DS_BASE = "https://drunkenslug.com";

/** Clean filename for a useful DS search query */
function buildQuery(raw: string): string {
  return raw
    .replace(/\.nzb$/i, "")
    .replace(/[._\-]/g, " ")
    .replace(/\b\d{2,4}[\s]\d{2}[\s]\d{2}\b/g, "") // strip date tokens
    .replace(/\b(19|20)\d{2}\b/g, "")               // strip years
    .replace(/\b\d{3,4}p\b/gi, "")                  // strip resolution
    .replace(/\b(x26[45]|hevc|h\.?26[45]|mp4|avi|mkv)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}



// ─── DS search fetch ──────────────────────────────────────────────────────────

async function searchDS(query: string, cat: number, xsrf: string): Promise<string> {
  const catParam = cat > 0 ? `?t=${cat}` : "";
  const url = `${DS_BASE}/search/${encodeURIComponent(query)}${catParam}`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "X-XSRF-TOKEN": xsrf,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": DS_BASE,
    },
  });

  if (!res.ok) throw new Error(`DS returned HTTP ${res.status}`);
  const html = await res.text();

  // If we got redirected to a login page the cookies are bad
  if (html.includes("/login") && html.includes("form") && !html.includes("browsetable")) {
    throw new Error("DS session expired — please update your cookies in the extension.");
  }

  return html;
}

// ─── Pending log context ──────────────────────────────────────────────────────

let _pendingEntry: LogEntry | null = null;

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtMessage, _sender, sendResponse) => {
    switch (message.type) {

      // ── Content script tells us which log row was clicked ──────────────────
      case "SET_LOG_CONTEXT": {
        _pendingEntry = message.entry;
        // Also persist so popup can read it after service worker wakes up
        void chrome.storage.session.set({ pendingEntry: message.entry });
        sendResponse({ ok: true });
        // Try to open the popup automatically; works in Chrome 127+ with the
        // "action" permission. Silently ignored if called outside a user gesture.
        void chrome.action.openPopup().catch(() => {
          // Browser may reject if not triggered by a direct user gesture —
          // user can still click the extension icon manually; context is saved.
        });
        return false;
      }

      // ── Popup asks for a DS search ─────────────────────────────────────────
      case "DS_SEARCH": {
        const query = message.query.trim();
        const cat   = message.cat ?? -1;

        void (async () => {
          const { dsCookies = "" } = await chrome.storage.local.get("dsCookies") as Partial<StoredSettings>;
          if (!dsCookies) {
            const reply: SearchResultMsg = {
              type: "DS_SEARCH_RESULT",
              results: [],
              error: "No DrunkenSlug cookies saved. Go to the Cookie Setup tab.",
            };
            sendResponse(reply);
            return;
          }

          const parsed = parseNetscapeCookies(dsCookies);
          const xsrf = extractXsrf(parsed);

          try {
            await injectCookies(parsed);
            const html = await searchDS(query, cat, xsrf);
            const reply: SearchResultMsg = { type: "DS_SEARCH_RESULT", html };
            sendResponse(reply);
          } catch (e) {
            const reply: SearchResultMsg = {
              type: "DS_SEARCH_RESULT",
              results: [],
              error: (e as Error).message,
            };
            sendResponse(reply);
          }
        })();

        return true; // keep channel open for async sendResponse
      }

      // ── Popup saves a thumb URL to the COTTONTAiL server ──────────────────
      case "SAVE_THUMB": {
        const { msgId, thumbUrl, appOrigin } = message;

        void (async () => {
          try {
            const res = await fetch(`${appOrigin}/api/logs/${msgId}/sample`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: thumbUrl }),
            });

            const json = await res.json() as { success?: boolean; error?: string; size?: number; mime?: string };
            if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);

            const reply: SaveThumbResultMsg = {
              type: "SAVE_THUMB_RESULT",
              ok: true,
              size: json.size,
              mime: json.mime,
            };
            sendResponse(reply);
          } catch (e) {
            const reply: SaveThumbResultMsg = {
              type: "SAVE_THUMB_RESULT",
              ok: false,
              error: (e as Error).message,
            };
            sendResponse(reply);
          }
        })();

        return true;
      }

      default:
        return false;
    }
  }
);

// ── Expose pending entry to popup on demand ───────────────────────────────────
// The popup also reads pendingEntry directly from chrome.storage.session,
// but service-worker memory is faster when it's still alive.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    port.onMessage.addListener((msg: { type: string }) => {
      if (msg.type === "GET_PENDING") {
        port.postMessage({ type: "PENDING_ENTRY", entry: _pendingEntry });
      }
    });
  }
});

// ── auto-clean pending entry after popup saves ───────────────────────────────
chrome.runtime.onMessage.addListener((message: ExtMessage) => {
  if (message.type === "SAVE_THUMB") {
    _pendingEntry = null;
    void chrome.storage.session.remove("pendingEntry");
  }
});

// Keep service worker alive in dev (no-op ping every 20s)
// Comment out in production if you prefer strict lifecycle.
// setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);
