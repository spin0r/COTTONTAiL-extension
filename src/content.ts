/**
 * content.ts — Content Script
 *
 * Injects a "DS 🔍" button into every row of the COTTONTAiL NZB logs table.
 * The app is a hash-router SPA that renders #logs-tbody asynchronously, so we
 * use a MutationObserver that watches the whole document and retries via
 * debounce — this is robust against any timing of dynamic rendering.
 *
 * Actual DOM structure (from logs.ts):
 *   <tr data-id="MSG_ID">
 *     <td>
 *       <div class="cell-name filename-display">
 *         <span class="log-name-link cell-name-link">FILENAME</span>
 *         ...
 *       </div>
 *     </td>
 *     <td class="cell-mono">DATE</td>
 *     <td>
 *       <div class="cell-actions action-buttons">
 *         <button class="btn-icon btn-grab">...</button>
 *         ...
 *       </div>
 *     </td>
 *   </tr>
 */

import type { SetLogContextMsg, LogEntry } from "./types";

// ─── Button factory ───────────────────────────────────────────────────────────

function makeSearchBtn(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = "Search DrunkenSlug for thumbnail";
  btn.setAttribute("data-ds-injected", "1");
  btn.className = "btn-icon";     // match existing action button styling
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="13" height="13" style="vertical-align:middle;flex-shrink:0">
      <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd"/>
    </svg>
    <span style="font-size:10px;margin-left:2px;font-weight:700;letter-spacing:.03em">DS</span>
  `;
  btn.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "color:#e68000",
    "background:transparent",
    "border:none",
    "padding:2px 5px",
    "border-radius:3px",
    "cursor:pointer",
    "transition:color .15s,background .15s",
    "flex-shrink:0",
    "line-height:1",
  ].join(";");

  btn.addEventListener("mouseenter", () => {
    btn.style.color = "#ff9f1a";
    btn.style.background = "rgba(230,128,0,.12)";
  });
  btn.addEventListener("mouseleave", () => {
    // only reset if not in a flash state
    if (btn.dataset["flashing"] !== "1") {
      btn.style.color = "#e68000";
      btn.style.background = "transparent";
    }
  });

  return btn;
}

// ─── Extract LogEntry from a row ─────────────────────────────────────────────

function extractEntry(tr: HTMLTableRowElement): LogEntry | null {
  const idStr = tr.getAttribute("data-id");
  if (!idStr) return null;
  const msgId = parseInt(idStr, 10);
  if (isNaN(msgId) || msgId <= 0) return null;

  // Filename is inside: <span class="log-name-link cell-name-link">
  const nameEl = tr.querySelector<HTMLElement>(".log-name-link");
  const fileName = nameEl?.textContent?.trim() ?? "";
  if (!fileName) return null;

  return { msgId, fileName, appOrigin: window.location.origin };
}

// ─── Inject into a single row ─────────────────────────────────────────────────

function injectRow(tr: HTMLTableRowElement): void {
  if (tr.querySelector("[data-ds-injected]")) return; // already done

  // Actions cell: <div class="cell-actions action-buttons">
  const actionsCell = tr.querySelector<HTMLElement>(".cell-actions");
  if (!actionsCell) return;

  // Don't pre-capture entry — read it fresh on every click so renames are reflected
  const btn = makeSearchBtn();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const entry = extractEntry(tr);
    if (!entry) return;
    handleClick(entry, btn);
  });
  actionsCell.appendChild(btn);
}

// ─── Scan the whole document for uninjected rows ─────────────────────────────

function scanAll(): void {
  const tbody = document.getElementById("logs-tbody");
  if (tbody) {
    // Prefer scanning inside the known tbody for performance
    tbody.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach(injectRow);
  } else {
    // Fallback: scan entire document (in case ID changed)
    document.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach(injectRow);
  }
}

// ─── Handle DS button click ───────────────────────────────────────────────────

function handleClick(entry: LogEntry, btn: HTMLButtonElement): void {
  const msg: SetLogContextMsg = { type: "SET_LOG_CONTEXT", entry };

  btn.style.opacity = "0.4";
  btn.style.pointerEvents = "none";

  chrome.runtime.sendMessage(msg, (response) => {
    btn.style.opacity = "";
    btn.style.pointerEvents = "";

    if (chrome.runtime.lastError) {
      console.warn("[DS Ext]", chrome.runtime.lastError.message);
      flash(btn, "#ea4335");
      return;
    }

    if (response?.ok) {
      flash(btn, "#34a853");
      // Background will try chrome.action.openPopup() — if it fails (browser
      // restriction), user clicks the extension icon manually; context is saved.
    }
  });
}

function flash(btn: HTMLButtonElement, color: string): void {
  btn.dataset["flashing"] = "1";
  btn.style.color = color;
  btn.style.background = "transparent";
  setTimeout(() => {
    btn.dataset["flashing"] = "0";
    btn.style.color = "#e68000";
  }, 1500);
}

// ─── MutationObserver with debounce ──────────────────────────────────────────
// Watch the whole document body. The SPA may add rows at any depth at any time.
// We debounce to avoid running scanAll() on every single DOM mutation during
// a large table render.

let _scanTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleScan(): void {
  if (_scanTimer) clearTimeout(_scanTimer);
  _scanTimer = setTimeout(() => {
    scanAll();
    _scanTimer = null;
  }, 150);
}

const observer = new MutationObserver((mutations) => {
  // Check if any mutation involves nodes that could be or contain log rows
  for (const m of mutations) {
    // Check added nodes
    for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      // If the added node is a tr[data-id], a tbody, a table, or any container
      if (
        node.matches("tr[data-id]") ||
        node.querySelector("tr[data-id]") ||
        node.id === "logs-tbody" ||
        node.id === "page-logs" ||
        node.matches("table") ||
        node.matches("tbody")
      ) {
        scheduleScan();
        return;
      }
    }
    // Also check if innerHTML was swapped (characterData or removal + addition)
    if (m.type === "childList" && m.target instanceof HTMLElement) {
      if (m.target.id === "logs-tbody" || m.target.closest("#logs-tbody")) {
        scheduleScan();
        return;
      }
    }
  }
});

// ─── Listen for save success to update UI immediately ───────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "THUMB_SAVED_NOTIFY") {
    // 1. Tell the COTTONTAiL frontend to update its native UI for this row
    window.postMessage({ type: "DS_THUMB_SAVED", msgId: msg.msgId }, "*");

    // 2. Change the DS button color permanently for this row to indicate success
    const tr = document.querySelector<HTMLTableRowElement>(`tr[data-id="${msg.msgId}"]`);
    if (tr) {
      const dsBtn = tr.querySelector<HTMLButtonElement>("button[data-ds-injected]");
      if (dsBtn) {
        dsBtn.style.color = "#34a853";
        // Override the hover colors so it stays green
        dsBtn.addEventListener("mouseleave", () => {
          dsBtn.style.color = "#34a853";
        });
      }
    }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

function boot(): void {
  console.log("[DS Ext] Content script loaded, scanning for log rows...");

  // Immediate scan for anything already rendered
  scanAll();

  // Also scan on hash changes — user switches to/from the Logs tab
  window.addEventListener("hashchange", () => {
    console.log("[DS Ext] Hash changed, scheduling scan...");
    scheduleScan();
  });

  // Start observing the whole document
  observer.observe(document.body, { childList: true, subtree: true });

  // Extra safety: scan again after a short delay (for slow initial async render)
  setTimeout(scanAll, 500);
  setTimeout(scanAll, 1500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
