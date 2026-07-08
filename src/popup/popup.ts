/**
 * popup.ts — Popup controller
 *
 * Two tabs:
 *   Search  — context bar (current log entry) + DS search + thumbnail grid + save action
 *   Cookies — paste Netscape cookie text, persist to chrome.storage.local
 */

import type {
  ExtMessage,
  DSResult,
  SearchMsg,
  SearchResultMsg,
  SaveThumbMsg,
  SaveThumbResultMsg,
  StoredSettings,
  LogEntry,
} from "../types";

// ─── DOM refs ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

const tabs        = document.querySelectorAll<HTMLButtonElement>(".tab");
const panels      = document.querySelectorAll<HTMLElement>(".tab-panel");

// Search tab
const contextBar  = $<HTMLDivElement>("#context-bar");
const contextName = $<HTMLSpanElement>("#context-name");
const contextClearBtn = $<HTMLButtonElement>("#context-clear");
const manualRow      = $<HTMLDivElement>("#manual-row");
const manualMsgId    = $<HTMLInputElement>("#manual-msgid");
const manualFilename = $<HTMLInputElement>("#manual-filename");
const manualSetBtn   = $<HTMLButtonElement>("#manual-set-btn");
const searchInput = $<HTMLInputElement>("#search-input");
const catSelect   = $<HTMLSelectElement>("#cat-select");
const searchBtn   = $<HTMLButtonElement>("#search-btn");
const statusBar   = $<HTMLDivElement>("#status-bar");
const resultsEmpty = $<HTMLDivElement>("#results-empty");
const resultsGrid = $<HTMLDivElement>("#results-grid");
const saveBar     = $<HTMLDivElement>("#save-bar");
const saveBarTarget = $<HTMLSpanElement>("#save-bar-target");
const saveBtn     = $<HTMLButtonElement>("#save-btn");

// Cookies tab
const cookieInput    = $<HTMLTextAreaElement>("#cookie-input");
const saveCookiesBtn = $<HTMLButtonElement>("#save-cookies-btn");
const cookieStatus   = $<HTMLSpanElement>("#cookie-status");

// ─── State ─────────────────────────────────────────────────────────────────

let currentEntry:   LogEntry  | null = null;
let selectedResult: DSResult  | null = null;

// ─── Tab switching ─────────────────────────────────────────────────────────

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t)   => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const panelId = `tab-${tab.dataset["tab"]}`;
    document.getElementById(panelId)?.classList.add("active");
  });
});

// ─── Context bar ────────────────────────────────────────────────────────────

function setEntry(entry: LogEntry | null): void {
  currentEntry = entry;
  if (entry) {
    contextBar.classList.add("has-entry");
    contextName.textContent = entry.fileName;
    contextClearBtn.hidden = false;
    manualRow.hidden = true;
    if (!searchInput.value.trim()) {
      searchInput.value = cleanForSearch(entry.fileName);
    }
  } else {
    contextBar.classList.remove("has-entry");
    contextName.textContent = "No log item selected";
    contextClearBtn.hidden = true;
    manualRow.hidden = false;
  }
  refreshSaveBar();
}

contextClearBtn.addEventListener("click", () => {
  setEntry(null);
  void chrome.storage.session.remove("pendingEntry");
});

// ─── Manual entry ────────────────────────────────────────────────────────────

function applyManual(): void {
  const id   = parseInt(manualMsgId.value.trim(), 10);
  const name = manualFilename.value.trim();

  if (isNaN(id) || id <= 0) {
    manualMsgId.style.borderColor = "var(--error)";
    setTimeout(() => { manualMsgId.style.borderColor = ""; }, 1200);
    return;
  }

  // Detect the app origin from the active tab, fall back to localhost
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const rawUrl = tabs[0]?.url ?? "http://localhost:10000";
    let origin = "http://localhost:10000";
    try { origin = new URL(rawUrl).origin; } catch { /* use default */ }
    setEntry({ msgId: id, fileName: name || `msg_id:${id}`, appOrigin: origin });
    if (name && !searchInput.value.trim()) {
      searchInput.value = cleanForSearch(name);
    }
  });
}

manualSetBtn.addEventListener("click", applyManual);
manualMsgId.addEventListener("keydown",    (e) => { if (e.key === "Enter") applyManual(); });
manualFilename.addEventListener("keydown", (e) => { if (e.key === "Enter") applyManual(); });

/** Clean NZB filename into a short, DS-friendly search string */
function cleanForSearch(raw: string): string {
  return raw
    .replace(/\.nzb$/i, "")
    .replace(/[._\-]/g, " ")
    .replace(/\b\d{2,4}[\s]\d{2}[\s]\d{2}\b/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b\d{3,4}p\b/gi, "")
    .replace(/\b(x26[45]|hevc|h\.?26[45]|mp4|avi|mkv)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Status bar helpers ─────────────────────────────────────────────────────

function showStatus(msg: string, variant: "loading" | "error" | "success" | "" = ""): void {
  statusBar.hidden = false;
  statusBar.className = `status-bar${variant ? ` ${variant}` : ""}`;
  statusBar.textContent = msg;
}

function hideStatus(): void {
  statusBar.hidden = true;
  statusBar.textContent = "";
  statusBar.className = "status-bar";
}

// ─── Send message helper (typed) ───────────────────────────────────────────

function sendMsg<Req extends ExtMessage, Res extends ExtMessage>(msg: Req): Promise<Res> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response: Res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Search ─────────────────────────────────────────────────────────────────

const DS_BASE = "https://drunkenslug.com";

function scrapeResults(html: string): DSResult[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const results: DSResult[] = [];

  const rows = doc.querySelectorAll<HTMLTableRowElement>("#browsetable tbody tr");

  for (const row of rows) {
    const rowId = row.id ?? "";
    const guidMatch = rowId.match(/^guid([0-9a-f]{40})$/i);
    if (!guidMatch) continue;
    const guid = guidMatch[1];

    const titleEl = row.querySelector<HTMLElement>("td.item a.title h5");
    const title = titleEl?.textContent?.trim() ?? "";

    const catEl = row.querySelector<HTMLAnchorElement>("td.less a[href*='browse?t=']");
    const category = catEl?.textContent?.trim() ?? "";

    const cells = row.querySelectorAll("td");
    const size = cells[6]?.textContent?.trim() ?? "";

    const age = cells[4]?.textContent?.trim() ?? "";

    const grabsEl = row.querySelector<HTMLElement>(".label-default");
    const grabsText = grabsEl?.textContent?.replace(/\D/g, "") ?? "0";
    const grabs = parseInt(grabsText, 10) || 0;

    // Find any anchor or image that looks like a thumbnail link
    const thumbNode = row.querySelector("a.cboxElement, img.inline-image, a[href*='_thumb'], img[src*='_thumb']");
    let thumbUrl: string | null = null;
    if (thumbNode) {
      // DS thumbnails are deterministic based on the GUID
      thumbUrl = `${DS_BASE}/covers/sample/${guid}_thumb.jpg`;
    }

    if (title) {
      results.push({ guid, title, category, size, grabs, age, thumbUrl });
    }
  }

  return results;
}

async function doSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) return;

  setSelected(null);
  resultsGrid.innerHTML = "";
  resultsEmpty.style.display = "none";
  showStatus("Searching DrunkenSlug…", "loading");
  searchBtn.disabled = true;

  const req: SearchMsg = {
    type: "DS_SEARCH",
    query,
    cat: parseInt(catSelect.value, 10),
  };

  try {
    const res = await sendMsg<SearchMsg, SearchResultMsg>(req);
    if (res.error) {
      showStatus(`Error: ${res.error}`, "error");
      resultsEmpty.style.display = "block";
      resultsEmpty.textContent = res.error;
      return;
    }
    hideStatus();
    const results = scrapeResults(res.html || "");
    renderResults(results);
  } catch (e) {
    showStatus(`Extension error: ${(e as Error).message}`, "error");
  } finally {
    searchBtn.disabled = false;
  }
}

searchBtn.addEventListener("click", () => void doSearch());
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void doSearch();
});

// ─── Result grid ────────────────────────────────────────────────────────────

function renderResults(results: DSResult[]): void {
  resultsGrid.innerHTML = "";

  if (results.length === 0) {
    resultsEmpty.style.display = "block";
    resultsEmpty.textContent = "No results found. Try a different query or category.";
    return;
  }

  resultsEmpty.style.display = "none";

  for (const r of results) {
    const card = buildCard(r);
    resultsGrid.appendChild(card);
  }
}

function buildCard(r: DSResult): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "result-card";
  card.dataset["guid"] = r.guid;

  // Thumb area
  const thumbWrap = document.createElement("div");
  thumbWrap.className = "result-thumb-wrap";

  if (r.thumbUrl) {
    const img = document.createElement("img");
    img.className = "result-thumb loading";
    img.alt = r.title;
    img.loading = "lazy";
    img.onload  = () => img.classList.remove("loading");
    img.onerror = () => {
      img.replaceWith(noThumbLabel());
    };
    img.src = r.thumbUrl;
    thumbWrap.appendChild(img);
  } else {
    thumbWrap.appendChild(noThumbLabel());
  }

  // Info
  const info = document.createElement("div");
  info.className = "result-info";

  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = r.title;
  title.title = r.title;

  const cat = document.createElement("div");
  cat.className = "result-cat";
  cat.textContent = r.category;

  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.innerHTML = `<span>${r.size}</span><span>${r.grabs} grabs</span>`;

  info.append(title, cat, meta);
  card.append(thumbWrap, info);

  card.addEventListener("click", () => {
    if (r.thumbUrl) {
      setSelected(r);
    } else {
      // Allow selecting for title reference even without thumb — user sees warning
      setSelected(r);
      showStatus("This result has no thumbnail on DS.", "error");
    }
  });

  return card;
}

function noThumbLabel(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "no-thumb-label";
  el.textContent = "No thumbnail";
  return el;
}

// ─── Selection ──────────────────────────────────────────────────────────────

function setSelected(r: DSResult | null): void {
  // Clear previous card highlight
  resultsGrid.querySelectorAll(".result-card.selected")
    .forEach((c) => c.classList.remove("selected"));

  selectedResult = r;

  if (r) {
    resultsGrid.querySelector(`[data-guid="${r.guid}"]`)?.classList.add("selected");
  }

  refreshSaveBar();
}

// ─── Save bar ───────────────────────────────────────────────────────────────

function refreshSaveBar(): void {
  const canSave = !!(currentEntry && selectedResult?.thumbUrl);
  saveBar.hidden = !canSave;
  if (canSave) {
    saveBarTarget.textContent = currentEntry!.fileName;
  }
}

saveBtn.addEventListener("click", () => void doSave());

async function doSave(): Promise<void> {
  if (!currentEntry || !selectedResult?.thumbUrl) return;

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  showStatus("Saving thumbnail URL\u2026", "loading");

  const req: SaveThumbMsg = {
    type: "SAVE_THUMB",
    msgId:      currentEntry.msgId,
    thumbUrl:   selectedResult.thumbUrl,
    appOrigin:  currentEntry.appOrigin,
  };

  try {
    const res = await sendMsg<SaveThumbMsg, SaveThumbResultMsg>(req);
    if (res.ok) {
      const kb = res.size ? `${(res.size / 1024).toFixed(1)} KB` : "";
      showStatus(`✓ Saved${kb ? ` — ${kb}` : ""}. Green dot will appear in the log list.`, "success");

      // Notify the content script to update the DOM immediately
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          const notify: ThumbSavedNotifyMsg = { type: "THUMB_SAVED_NOTIFY", msgId: req.msgId };
          chrome.tabs.sendMessage(tabs[0].id, notify).catch(() => {});
        }
      });

      setEntry(null);
      setSelected(null);
      void chrome.storage.session.remove("pendingEntry");
    } else {
      showStatus(`✗ ${res.error ?? "Unknown error"}`, "error");
    }
  } catch (e) {
    showStatus(`✗ ${(e as Error).message}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to Log Entry";
  }
}

// ─── Cookies tab ────────────────────────────────────────────────────────────

saveCookiesBtn.addEventListener("click", async () => {
  const raw = cookieInput.value.trim();
  if (!raw) {
    cookieStatus.textContent = "Paste your Netscape cookies first.";
    cookieStatus.className = "cookie-status error";
    return;
  }

  // Basic sanity check — must have at least a drunkenslug_session line
  const hasDsLine = raw.split("\n").some(
    (l) => l.includes("drunkenslug.com") || l.includes("drunkenslug_session")
  );

  if (!hasDsLine) {
    cookieStatus.textContent = "Doesn't look like DrunkenSlug cookies. Make sure you export from drunkenslug.com.";
    cookieStatus.className = "cookie-status error";
    return;
  }

  const settings: Partial<StoredSettings> = { dsCookies: raw };
  await chrome.storage.local.set(settings);
  cookieStatus.textContent = "✓ Cookies saved.";
  cookieStatus.className = "cookie-status ok";
  setTimeout(() => { cookieStatus.textContent = ""; cookieStatus.className = "cookie-status"; }, 3000);
});

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Load saved cookies into textarea
  const local = await chrome.storage.local.get("dsCookies") as Partial<StoredSettings>;
  if (local.dsCookies) {
    cookieInput.value = local.dsCookies;
  }

  // Restore pending log entry (set by content.ts)
  const session = await chrome.storage.session.get("pendingEntry") as Partial<StoredSettings>;
  if (session.pendingEntry) {
    setEntry(session.pendingEntry);
  } else {
    setEntry(null);
  }
}

void boot();
