/**
 * Shared backlog persistence: same keys as board_app.js so every page sees the same tasks.
 * Load this script before board_app.js or focus_app.js.
 */
(function (global) {
  const DATA_URL = "./board-data.json";
  const LS_CUSTOM = "backlog-board-custom-cards-v1";
  const LS_KEY = "backlog-board-local-v1";
  const LS_HIDDEN = "backlog-board-hidden-v1";

  const STATUS_ORDER = [
    "backlog",
    "selected_for_development",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "canceled",
  ];
  const PRIORITY_ORDER = ["critical", "urgent", "medium", "backlog", "next_steps"];
  const DEFAULT_PRIORITY = "urgent";

  function loadCustomCards() {
    try {
      const raw = localStorage.getItem(LS_CUSTOM);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveCustomCards(arr) {
    try {
      localStorage.setItem(LS_CUSTOM, JSON.stringify(arr));
    } catch (e) {
      throw new Error(
        "Could not save local cards (browser storage). Same URL every time (e.g. 127.0.0.1, not localhost), not private mode, and enough disk space. " +
          String(e.message || e)
      );
    }
  }

  function loadOverridesObj() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function loadHiddenSet() {
    try {
      const raw = localStorage.getItem(LS_HIDDEN);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveOverridesObj(obj) {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }

  function saveHiddenSet(set) {
    localStorage.setItem(LS_HIDDEN, JSON.stringify([...set]));
  }

  function effectiveStatus(item, overrides) {
    const o = overrides[item.id] || {};
    if (o.status && STATUS_ORDER.includes(o.status)) return o.status;
    const s = item.status || "backlog";
    return STATUS_ORDER.includes(s) ? s : "backlog";
  }

  function effectiveTitle(item, overrides) {
    const o = overrides[item.id] || {};
    if (Object.prototype.hasOwnProperty.call(o, "title")) return String(o.title ?? "");
    return item.title != null ? String(item.title) : "";
  }

  function enrichItem(item, overrides) {
    const o = overrides[item.id] || {};
    const status = effectiveStatus(item, overrides);
    const title = effectiveTitle(item, overrides).trim() || "(no title)";
    const front = o.front !== undefined && String(o.front).length ? String(o.front) : item.front || "other";
    let priority = item.priority || DEFAULT_PRIORITY;
    if (o.priority && PRIORITY_ORDER.includes(o.priority)) priority = o.priority;
    else if (!PRIORITY_ORDER.includes(priority)) priority = DEFAULT_PRIORITY;
    return { ...item, status, title, front, priority };
  }

  /**
   * Full board state for the card editor and board merge (same rules as board_app.js).
   */
  async function loadBoardState() {
    const customItems = loadCustomCards();
    const hidden = loadHiddenSet();
    const overrides = loadOverridesObj();
    let serverItems = [];
    let frontsMeta = [];
    let boardDataLoaded = false;
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const data = await res.json();
      serverItems = data.items || [];
      frontsMeta = data.fronts || [];
      boardDataLoaded = true;
    } catch (e) {
      console.warn("BacklogStore: could not load board-data.json", e);
    }
    /** Server first, then custom — duplicate id keeps the browser-local row. */
    const baseItems = [...serverItems, ...customItems];
    const itemsById = new Map(baseItems.map((i) => [i.id, i]));
    const merged = baseItems.filter((i) => !hidden.has(i.id));
    const itemsDisplay = merged.map((item) => enrichItem(item, overrides));
    return {
      serverItems,
      customItems,
      frontsMeta,
      overrides,
      hidden,
      baseItems,
      itemsById,
      itemsDisplay,
      boardDataLoaded,
    };
  }

  /**
   * Single fetch: display items + fronts meta (same merge as the board).
   */
  async function loadBoardPayload() {
    const s = await loadBoardState();
    return {
      itemsDisplay: s.itemsDisplay,
      frontsMeta: s.frontsMeta,
      boardDataLoaded: s.boardDataLoaded,
    };
  }

  /** @deprecated use loadBoardPayload */
  async function loadAllDisplayItems() {
    const { itemsDisplay } = await loadBoardPayload();
    return itemsDisplay;
  }

  function createLocalTask(fields) {
    const title = (fields.title || "").trim();
    if (!title) throw new Error("Title required");
    const id =
      "local-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()));
    let priority = fields.priority || DEFAULT_PRIORITY;
    if (!PRIORITY_ORDER.includes(priority)) priority = DEFAULT_PRIORITY;
    let status = fields.status || "backlog";
    if (!STATUS_ORDER.includes(status)) status = "backlog";
    const card = {
      id,
      title,
      description: (fields.description || "").trim(),
      front: fields.front || "other",
      priority,
      status,
      definition_of_done: (fields.definition_of_done || "").trim(),
      people: Array.isArray(fields.people) ? fields.people : [],
      sources: [{ type: "local", url: "", ref: "Added in browser" }],
    };
    const arr = loadCustomCards();
    arr.push(card);
    saveCustomCards(arr);
    return card;
  }

  global.BacklogStore = {
    DATA_URL,
    LS_CUSTOM,
    LS_KEY,
    LS_HIDDEN,
    STATUS_ORDER,
    PRIORITY_ORDER,
    DEFAULT_PRIORITY,
    loadCustomCards,
    saveCustomCards,
    loadOverridesObj,
    loadHiddenSet,
    saveOverridesObj,
    saveHiddenSet,
    loadBoardState,
    loadAllDisplayItems,
    loadBoardPayload,
    createLocalTask,
  };
})(typeof window !== "undefined" ? window : globalThis);
