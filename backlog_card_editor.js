/**
 * Same "Edit card" modal as the board: reads/writes backlog-board-local-v1, custom cards, hidden ids.
 * Pages with #modal-backdrop include this after backlog_shared.js and call BacklogCardEditor.init().
 */
(function (global) {
  const store = global.BacklogStore;
  if (!store) return;

  const STATUS_ORDER = store.STATUS_ORDER;
  const PRIORITY_ORDER = store.PRIORITY_ORDER;
  const DEFAULT_PRIORITY = store.DEFAULT_PRIORITY;

  let serverItems = [];
  let customItems = [];
  let baseItems = [];
  let frontsMeta = [];
  let itemsById = new Map();
  let overrides = {};
  let hiddenIds = new Set();
  let listenersWired = false;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function notifySaved() {
    document.dispatchEvent(new CustomEvent("backlog-card-saved", { bubbles: true }));
  }

  function effectiveField(item, key, fallback) {
    const o = overrides[item.id] || {};
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
    return item[key] !== undefined ? item[key] : fallback;
  }

  function effectiveStatus(item) {
    const o = overrides[item.id];
    if (o && o.status && STATUS_ORDER.includes(o.status)) return o.status;
    const s = item.status || "backlog";
    return STATUS_ORDER.includes(s) ? s : "backlog";
  }

  function effectivePriority(item) {
    const o = overrides[item.id];
    if (o && o.priority && PRIORITY_ORDER.includes(o.priority)) return o.priority;
    const p = item.priority || DEFAULT_PRIORITY;
    return PRIORITY_ORDER.includes(p) ? p : DEFAULT_PRIORITY;
  }

  function effectiveFront(item) {
    const o = overrides[item.id];
    if (o && o.front !== undefined && String(o.front).length) return String(o.front);
    return item.front || "other";
  }

  function effectiveTitle(item) {
    const o = overrides[item.id] || {};
    if (Object.prototype.hasOwnProperty.call(o, "title")) return String(o.title ?? "");
    return item.title != null ? String(item.title) : "";
  }

  function effectiveDescription(item) {
    return effectiveField(item, "description", item.description || "");
  }

  function effectiveDod(item) {
    return effectiveField(item, "definition_of_done", item.definition_of_done || "");
  }

  function effectiveDates(item) {
    const base = { ...(item.dates || {}) };
    const o = overrides[item.id];
    if (o && o.dates && typeof o.dates === "object") {
      return { ...base, ...o.dates };
    }
    return base;
  }

  function effectiveContext(item) {
    const o = overrides[item.id] || {};
    return o.context || "";
  }

  async function refreshState() {
    const s = await store.loadBoardState();
    serverItems = s.serverItems;
    customItems = s.customItems;
    frontsMeta = s.frontsMeta || [];
    overrides = s.overrides;
    hiddenIds = new Set(s.hidden);
    baseItems = [...serverItems, ...customItems];
    itemsById = new Map(baseItems.map((i) => [i.id, i]));
  }

  function populateModalFrontSelect() {
    const sel = document.getElementById("modal-front");
    if (!sel) return;
    const slugs = new Set(baseItems.map((i) => i.front || "other"));
    for (const f of frontsMeta || []) slugs.add(f.slug);
    const prev = sel.value;
    sel.innerHTML = "";
    const labelMap = Object.fromEntries((frontsMeta || []).map((f) => [f.slug, f.label]));
    for (const slug of [...slugs].sort()) {
      const o = document.createElement("option");
      o.value = slug;
      o.textContent = labelMap[slug] || slug.replace(/_/g, " ");
      sel.appendChild(o);
    }
    if ([...sel.options].some((opt) => opt.value === prev)) sel.value = prev;
  }

  function openModal(id) {
    const item = itemsById.get(id);
    if (!item) return;
    const backdrop = document.getElementById("modal-backdrop");
    if (!backdrop) return;
    const titleIn = document.getElementById("modal-title-input");
    const descEl = document.getElementById("modal-description");
    const dodEl = document.getElementById("modal-dod");
    const ctxEl = document.getElementById("modal-context");
    const dueEl = document.getElementById("modal-due");
    const linksEl = document.getElementById("modal-links");
    const priEl = document.getElementById("modal-priority");
    const stEl = document.getElementById("modal-status");

    backdrop.dataset.itemId = id;
    if (titleIn) titleIn.value = effectiveTitle(item);
    populateModalFrontSelect();
    const frontEl = document.getElementById("modal-front");
    if (frontEl) frontEl.value = effectiveFront(item);
    if (priEl) priEl.value = effectivePriority(item);
    if (stEl) stEl.value = effectiveStatus(item);
    descEl.value = effectiveDescription(item) || "";
    dodEl.value = effectiveDod(item) || "";
    ctxEl.value = effectiveContext(item) || "";
    const d = effectiveDates(item);
    dueEl.value = d.due ? String(d.due).slice(0, 10) : "";

    linksEl.innerHTML = "";
    const srcs = item.sources || [];
    if (srcs.length === 0) {
      linksEl.appendChild(el("p", null, "No links in source data."));
    } else {
      for (const s of srcs) {
        const url = (s.url || "").trim();
        const ref = s.ref || url || s.type || "link";
        if (url) {
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = `${s.type || "link"}: ${ref}`;
          linksEl.appendChild(a);
        } else {
          linksEl.appendChild(el("p", null, `${s.type || "ref"}: ${ref}`));
        }
      }
    }

    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const b = document.getElementById("modal-backdrop");
    if (!b) return;
    b.classList.remove("open");
    b.setAttribute("aria-hidden", "true");
  }

  function saveModal() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop?.dataset.itemId;
    if (!id) return;
    if (!itemsById.has(id)) return;
    if (!overrides[id]) overrides[id] = {};
    const titleInput = document.getElementById("modal-title-input");
    const t = titleInput ? titleInput.value.trim() : "";

    if (id.startsWith("local-")) {
      const card = customItems.find((c) => c.id === id);
      if (card) {
        card.title = t || "(no title)";
        store.saveCustomCards(customItems);
      }
      if (overrides[id].title !== undefined) delete overrides[id].title;
    } else {
      const baseItem = itemsById.get(id);
      const canonical =
        baseItem && baseItem.title != null ? String(baseItem.title).trim() : "";
      if (t === canonical) {
        if (overrides[id].title !== undefined) delete overrides[id].title;
      } else {
        overrides[id].title = t;
      }
    }

    const priEl = document.getElementById("modal-priority");
    const stEl = document.getElementById("modal-status");
    const frontEl = document.getElementById("modal-front");
    if (frontEl && frontEl.value) overrides[id].front = frontEl.value;
    if (priEl && PRIORITY_ORDER.includes(priEl.value)) overrides[id].priority = priEl.value;
    if (stEl && STATUS_ORDER.includes(stEl.value)) overrides[id].status = stEl.value;
    overrides[id].description = document.getElementById("modal-description").value;
    overrides[id].definition_of_done = document.getElementById("modal-dod").value;
    overrides[id].context = document.getElementById("modal-context").value;
    const due = document.getElementById("modal-due").value.trim();
    if (!overrides[id].dates) overrides[id].dates = {};
    if (due) overrides[id].dates.due = due;
    else delete overrides[id].dates.due;
    if (!overrides[id].dates || Object.keys(overrides[id].dates).length === 0) {
      delete overrides[id].dates;
    }
    store.saveOverridesObj(overrides);
    closeModal();
    notifySaved();
  }

  function resetLocalCard() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop?.dataset.itemId;
    if (
      !id ||
      !confirm(
        "Remove all local edits for this card (label, status, priority, text, dates, context)?"
      )
    )
      return;
    delete overrides[id];
    store.saveOverridesObj(overrides);
    closeModal();
    notifySaved();
  }

  function removeFromBoard() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop?.dataset.itemId;
    if (!id || !itemsById.has(id)) return;
    const isCustom = id.startsWith("local-");
    const msg = isCustom
      ? "Delete this task permanently? It exists only in this browser."
      : "Remove this card from the board? Jira / YAML are unchanged. Clear site data or localStorage key backlog-board-hidden-v1 to see it again after reload.";
    if (!confirm(msg)) return;
    if (isCustom) {
      customItems = customItems.filter((c) => c.id !== id);
      store.saveCustomCards(customItems);
    } else {
      hiddenIds.add(id);
      store.saveHiddenSet(hiddenIds);
    }
    delete overrides[id];
    store.saveOverridesObj(overrides);
    closeModal();
    notifySaved();
  }

  function resetDescriptionOnly() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop?.dataset.itemId;
    if (!id) return;
    const item = itemsById.get(id);
    if (overrides[id]) {
      delete overrides[id].description;
      if (Object.keys(overrides[id]).length === 0) delete overrides[id];
    }
    store.saveOverridesObj(overrides);
    document.getElementById("modal-description").value = item ? item.description || "" : "";
    notifySaved();
  }

  function wireListeners() {
    if (listenersWired) return;
    if (!document.getElementById("modal-backdrop")) return;
    listenersWired = true;
    document.getElementById("btn-modal-save")?.addEventListener("click", saveModal);
    document.getElementById("btn-modal-close")?.addEventListener("click", closeModal);
    document.getElementById("btn-modal-reset-desc")?.addEventListener("click", resetDescriptionOnly);
    document.getElementById("btn-modal-reset-all")?.addEventListener("click", resetLocalCard);
    document.getElementById("btn-modal-remove-from-board")?.addEventListener("click", removeFromBoard);
    document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
  }

  async function openCard(id) {
    wireListeners();
    try {
      await refreshState();
    } catch (e) {
      alert(String(e.message || e));
      return;
    }
    if (!itemsById.has(id)) {
      alert("That task is not on the board (removed or missing). Refresh and try again.");
      return;
    }
    openModal(id);
  }

  function init() {
    wireListeners();
  }

  global.BacklogCardEditor = {
    init,
    openCard,
    closeModal,
  };
})(typeof window !== "undefined" ? window : globalThis);
