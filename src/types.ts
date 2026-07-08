// ─── DS search result ─────────────────────────────────────────────────────────

export interface DSResult {
  /** 40-char SHA1 GUID used in all DS URLs */
  guid: string;
  /** Release title from the search result row */
  title: string;
  /** Category string e.g. "XXX > HD" */
  category: string;
  /** Size string e.g. "3.05 GB" */
  size: string;
  /** Grabs count */
  grabs: number;
  /** Age string e.g. "27.1d" */
  age: string;
  /** Thumbnail URL — present only when DS has a cover for this release */
  thumbUrl: string | null;
}

// ─── Log entry passed from content → popup ───────────────────────────────────

export interface LogEntry {
  msgId: number;
  fileName: string;
  /** The web app's origin so the popup knows where to POST */
  appOrigin: string;
}

// ─── Extension message protocol ──────────────────────────────────────────────

export type ExtMessage =
  | SearchMsg
  | SearchResultMsg
  | SaveThumbMsg
  | SaveThumbResultMsg
  | SetLogContextMsg
  | ThumbSavedNotifyMsg;

/** Popup → Content: Notify that thumbnail was saved for msgId so DOM can update */
export interface ThumbSavedNotifyMsg {
  type: "THUMB_SAVED_NOTIFY";
  msgId: number;
}

/** Popup → Background: proxy a DS search */
export interface SearchMsg {
  type: "DS_SEARCH";
  query: string;
  /** Category filter, -1 = All, 6000 = XXX */
  cat: number;
}

/** Background → Popup: search results */
export interface SearchResultMsg {
  type: "DS_SEARCH_RESULT";
  results?: DSResult[];
  html?: string;
  error?: string;
}

/** Popup → Background: POST the thumb URL to the app's /api/logs/:id/sample */
export interface SaveThumbMsg {
  type: "SAVE_THUMB";
  msgId: number;
  thumbUrl: string;
  appOrigin: string;
}

/** Background → Popup: save result */
export interface SaveThumbResultMsg {
  type: "SAVE_THUMB_RESULT";
  ok: boolean;
  error?: string;
  /** KB stored */
  size?: number;
  mime?: string;
}

/** Content → Background (via chrome.runtime.sendMessage): pass selected log row context to popup */
export interface SetLogContextMsg {
  type: "SET_LOG_CONTEXT";
  entry: LogEntry;
}

// ─── Stored settings ─────────────────────────────────────────────────────────

export interface StoredSettings {
  /** Raw Netscape-format cookie text pasted by the user */
  dsCookies: string;
  /** The last log entry the user clicked "Search DS" on */
  pendingEntry: LogEntry | null;
}
