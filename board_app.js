/**
 * Interactive backlog board: stacked priority swimlanes; workflow columns through Done and Canceled.
 */
(function () {
  const DATA_URL = "./board-data.json";
  const LS_KEY = "backlog-board-local-v1";
  const LS_CUSTOM = "backlog-board-custom-cards-v1";
  const LS_COL_COLLAPSE = "backlog-board-col-collapse";
  const LS_HIDDEN = "backlog-board-hidden-v1";
  const SS_VIEW = "backlog-board-view-v1";

  const STATUS_ORDER = [
    "backlog",
    "selected_for_development",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "canceled",
  ];
  const STATUS_LABELS = {
    backlog: "Backlog",
    selected_for_development: "Selected for development",
    in_progress: "In progress",
    in_review: "In review",
    blocked: "Blocked",
    done: "Done",
    canceled: "Canceled",
  };

  const PRIORITY_ORDER = ["critical", "urgent", "medium", "backlog", "next_steps"];
  const PRIORITY_LABELS = {
    critical: "Critical",
    urgent: "Urgent",
    medium: "Medium",
    backlog: "Low",
    next_steps: "Next step",
  };

  /** When YAML/JSON has no priority, board uses this (modal or drag into a priority section). */
  const DEFAULT_PRIORITY = "urgent";

  let serverItems = [];
  let customItems = [];
  let baseItems = [];
  let frontsMeta = [];
  let itemsById = new Map();
  let overrides = {};
  /** Server/YAML card ids hidden locally (not deleted in Jira). */
  let hiddenIds = new Set();
  let ignoreCardClicksUntil = 0;
  let filterListenersWired = false;

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
        "Could not save local cards (browser storage). Use the same host each time (e.g. 127.0.0.1), not private mode. " +
          String(e.message || e)
      );
    }
  }

  function loadHiddenIds() {
    try {
      const raw = localStorage.getItem(LS_HIDDEN);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveHiddenIds() {
    localStorage.setItem(LS_HIDDEN, JSON.stringify([...hiddenIds]));
  }

  function rebuildMerged() {
    baseItems = [...serverItems, ...customItems];
    itemsById = new Map(baseItems.map((i) => [i.id, i]));
  }

  function priorityRowCollapseKey(priorityKey) {
    return `p:${priorityKey}`;
  }

  function loadColCollapse() {
    try {
      return JSON.parse(sessionStorage.getItem(LS_COL_COLLAPSE) || "{}");
    } catch {
      return {};
    }
  }

  function saveColCollapse(obj) {
    sessionStorage.setItem(LS_COL_COLLAPSE, JSON.stringify(obj));
  }

  function isPriorityRowCollapsed(priorityKey) {
    return !!loadColCollapse()[priorityRowCollapseKey(priorityKey)];
  }

  function togglePriorityRowCollapse(priorityKey) {
    const o = loadColCollapse();
    const k = priorityRowCollapseKey(priorityKey);
    if (o[k]) delete o[k];
    else o[k] = 1;
    saveColCollapse(o);
    renderBoard();
  }

  function getBoardView() {
    try {
      const v = sessionStorage.getItem(SS_VIEW);
      return v === "labels" ? "labels" : "priority";
    } catch {
      return "priority";
    }
  }

  function setBoardView(mode) {
    sessionStorage.setItem(SS_VIEW, mode === "labels" ? "labels" : "priority");
    syncViewTabs();
    renderBoard();
  }

  function syncViewTabs() {
    const v = getBoardView();
    document.querySelectorAll(".view-tab").forEach((btn) => {
      const on = btn.dataset.boardView === v;
      btn.classList.toggle("is-active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  function frontRowCollapseKey(frontSlug) {
    return `f:${frontSlug}`;
  }

  function isFrontRowCollapsed(frontSlug) {
    return !!loadColCollapse()[frontRowCollapseKey(frontSlug)];
  }

  function toggleFrontRowCollapse(frontSlug) {
    const o = loadColCollapse();
    const k = frontRowCollapseKey(frontSlug);
    if (o[k]) delete o[k];
    else o[k] = 1;
    saveColCollapse(o);
    renderBoard();
  }

  function priorityFrontCollapseKey(priorityKey, frontSlug) {
    return `pf:${priorityKey}:${frontSlug}`;
  }

  function isPriorityFrontSubCollapsed(priorityKey, frontSlug) {
    return !!loadColCollapse()[priorityFrontCollapseKey(priorityKey, frontSlug)];
  }

  function togglePriorityFrontSubCollapse(priorityKey, frontSlug) {
    const o = loadColCollapse();
    const k = priorityFrontCollapseKey(priorityKey, frontSlug);
    if (o[k]) delete o[k];
    else o[k] = 1;
    saveColCollapse(o);
    renderBoard();
  }

  function classifySource(item) {
    const id = item.id || "";
    const srcs = item.sources || [];
    if (id.startsWith("jira-") || srcs.some((s) => (s.type || "") === "jira")) {
      return "jira";
    }
    if (srcs.some((s) => (s.type || "") === "slack")) return "slack";
    const blob = ((item.title || "") + "\n" + (item.description || "")).toLowerCase();
    if (
      id.startsWith("gemini-") ||
      srcs.some((s) => (s.type || "") === "gdrive") ||
      /gemini|notes by gemini/.test(blob)
    ) {
      return "gemini_notes";
    }
    return "other";
  }

  function matchesFilters(item) {
    const srcSel = document.getElementById("filter-source");
    const frontSel = document.getElementById("filter-front");
    const srcVal = srcSel ? srcSel.value : "all";
    const frontVal = frontSel ? frontSel.value : "all";
    if (srcVal !== "all" && classifySource(item) !== srcVal) return false;
    if (frontVal !== "all" && effectiveFront(item) !== frontVal) return false;
    return true;
  }

  function visibleItems() {
    return baseItems.filter((item) => !hiddenIds.has(item.id) && matchesFilters(item));
  }

  function boardVisibleCount() {
    return baseItems.filter((item) => !hiddenIds.has(item.id)).length;
  }

  function populateFrontFilter() {
    const sel = document.getElementById("filter-front");
    if (!sel) return;
    const previous = sel.value;
    const slugs = [...new Set(baseItems.map((i) => i.front || "other"))].sort();
    const labelMap = Object.fromEntries((frontsMeta || []).map((f) => [f.slug, f.label]));
    sel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All labels";
    sel.appendChild(allOpt);
    for (const slug of slugs) {
      const opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = labelMap[slug] || slug.replace(/_/g, " ");
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === previous)) {
      sel.value = previous;
    }
  }

  function populateAddFrontSelect() {
    const sel = document.getElementById("add-front");
    if (!sel) return;
    sel.innerHTML = "";
    if (frontsMeta && frontsMeta.length) {
      for (const f of frontsMeta) {
        const o = document.createElement("option");
        o.value = f.slug;
        o.textContent = f.label;
        sel.appendChild(o);
      }
    } else {
      const o = document.createElement("option");
      o.value = "other";
      o.textContent = "Other";
      sel.appendChild(o);
    }
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

  function updateFilterSummary(visibleCount) {
    const el = document.getElementById("filter-summary");
    if (!el) return;
    const total = boardVisibleCount();
    const hiddenN = baseItems.length - total;
    if (visibleCount === total) {
      el.textContent =
        hiddenN > 0
          ? `Showing all ${total} cards (${hiddenN} removed from board in this browser).`
          : `Showing all ${total} cards.`;
    } else {
      el.textContent = `Showing ${visibleCount} of ${total} cards (filters active).`;
    }
  }

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveOverrides() {
    localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  }

  function sourceSummary(item) {
    const srcs = item.sources || [];
    if (!srcs.length) return { label: "LOCAL", ref: "" };
    const s = srcs[0];
    const t = (s.type || "other").toUpperCase();
    const r = s.ref || s.url || "";
    return { label: t, ref: r };
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

  function frontLabel(slug) {
    const m = (frontsMeta || []).find((f) => f.slug === slug);
    return m ? m.label : slug.replace(/_/g, " ");
  }

  function getFrontBandsOrder(vis) {
    const slugs = new Set(vis.map((item) => effectiveFront(item)));
    const ordered = [];
    for (const f of frontsMeta || []) {
      if (slugs.has(f.slug)) ordered.push(f.slug);
    }
    const rest = [...slugs].filter((s) => !ordered.includes(s)).sort();
    return [...ordered, ...rest];
  }

  function effectiveField(item, key, fallback) {
    const o = overrides[item.id] || {};
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
    return item[key] !== undefined ? item[key] : fallback;
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

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function renderCard(item) {
    const card = el("article", "card");
    card.draggable = true;
    card.dataset.itemId = item.id;

    const src = sourceSummary(item);
    const front = effectiveFront(item);
    const people = (item.people || []).join(", ") || "—";
    const dod = effectiveDod(item);
    const dates = effectiveDates(item);
    const dateStr = Object.entries(dates)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    const pr = effectivePriority(item);
    const st = effectiveStatus(item);

    card.dataset.status = st;
    const displayTitle = effectiveTitle(item).trim() || "(no title)";
    card.appendChild(el("h3", "card-title", displayTitle));

    const rPrio = el("div", "card-row");
    rPrio.appendChild(el("span", null, "Priority: "));
    const chipP = el("span", "chip chip-priority", PRIORITY_LABELS[pr]);
    chipP.dataset.priority = pr;
    rPrio.appendChild(chipP);
    card.appendChild(rPrio);

    const rStat = el("div", "card-row");
    rStat.appendChild(el("span", null, "Status: "));
    rStat.appendChild(el("span", "chip chip-status-mini", STATUS_LABELS[st]));
    card.appendChild(rStat);

    const r1 = el("div", "card-row");
    const refShort = src.ref ? String(src.ref) : "";
    const refDisp =
      refShort.length > 32 ? refShort.slice(0, 30) + "…" : refShort;
    r1.appendChild(
      el("span", "chip chip-source", refDisp ? `${src.label} · ${refDisp}` : src.label)
    );
    card.appendChild(r1);

    const r2 = el("div", "card-row");
    r2.appendChild(el("span", "chip chip-front", front.replace(/_/g, " ")));
    card.appendChild(r2);

    const r3 = el("div", "card-row");
    r3.appendChild(el("span", null, "People: "));
    r3.appendChild(el("span", "clamp-1", people));
    card.appendChild(r3);

    const r4 = el("div", "card-row");
    r4.appendChild(el("span", null, "DoD: "));
    r4.appendChild(el("span", "clamp-1", dod || "—"));
    card.appendChild(r4);

    if (dateStr) {
      card.appendChild(el("div", "card-row", "Dates: " + dateStr));
    }

    const hint =
      getBoardView() === "labels"
        ? "Click to open · drag to another label band or status column"
        : "Click to open · drag to another priority band or status column";
    card.appendChild(el("div", "card-hint", hint));

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      ignoreCardClicksUntil = Date.now() + 400;
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (Date.now() < ignoreCardClicksUntil) return;
      openModal(item.id);
    });

    return card;
  }

  function applyCardDrop(id, patch) {
    if (!id || !itemsById.has(id)) return;
    if (!overrides[id]) overrides[id] = {};
    if (patch.status !== undefined && STATUS_ORDER.includes(patch.status)) {
      overrides[id].status = patch.status;
    }
    if (patch.priority !== undefined && PRIORITY_ORDER.includes(patch.priority)) {
      overrides[id].priority = patch.priority;
    }
    if (patch.front !== undefined && typeof patch.front === "string" && patch.front.length) {
      overrides[id].front = patch.front;
    }
    saveOverrides();
    renderBoard();
  }

  function setupPriorityDropZone(zone, statusKey, priorityKey, frontSlug) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      const patch = { status: statusKey, priority: priorityKey };
      if (frontSlug) patch.front = frontSlug;
      applyCardDrop(id, patch);
    });
  }

  /** One row of status headers + 6-column grid for priority view; optional frontSlug scopes cards and drop target. */
  function appendPriorityStatusSection(parent, vis, priorityKey, frontSlug) {
    const match = (item) =>
      effectivePriority(item) === priorityKey &&
      (frontSlug === null || effectiveFront(item) === frontSlug);

    const labelRow = el("div", "priority-inner-label-row");
    for (const statusKey of STATUS_ORDER) {
      const list = vis.filter((item) => effectiveStatus(item) === statusKey && match(item));
      const lab = el("div", "priority-inner-label");
      lab.setAttribute("data-status-col", statusKey);
      lab.appendChild(el("span", "priority-inner-label-text", STATUS_LABELS[statusKey]));
      lab.appendChild(el("span", "count priority-inner-count", String(list.length)));
      labelRow.appendChild(lab);
    }
    parent.appendChild(labelRow);

    const grid = el("div", "priority-status-grid");
    for (const statusKey of STATUS_ORDER) {
      const list = vis.filter((item) => effectiveStatus(item) === statusKey && match(item));
      const zone = el("div", "session-cards swim-cell");
      zone.setAttribute("data-drop-status", statusKey);
      zone.setAttribute("data-drop-priority", priorityKey);
      if (frontSlug) zone.setAttribute("data-drop-front", frontSlug);
      setupPriorityDropZone(zone, statusKey, priorityKey, frontSlug);
      if (list.length === 0) {
        zone.appendChild(el("p", "empty-hint", "Drop here"));
      } else {
        for (const item of list) zone.appendChild(renderCard(item));
      }
      grid.appendChild(zone);
    }
    parent.appendChild(grid);
  }

  function setupLabelDropZone(zone, statusKey, frontSlug) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      applyCardDrop(id, { status: statusKey, front: frontSlug });
    });
  }

  /** Collapsed row hides cells; dropping on the row shell only changes priority (status unchanged). */
  function bindCollapsedPriorityRowDrop(block, priorityKey) {
    block.addEventListener("dragover", (e) => {
      if (!block.classList.contains("is-collapsed")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      block.classList.add("session-drop-target");
    });
    block.addEventListener("dragleave", () => block.classList.remove("session-drop-target"));
    block.addEventListener("drop", (e) => {
      if (!block.classList.contains("is-collapsed")) return;
      e.preventDefault();
      block.classList.remove("session-drop-target");
      const id = e.dataTransfer.getData("text/plain");
      applyCardDrop(id, { priority: priorityKey });
    });
  }

  function bindCollapsedLabelRowDrop(block, frontSlug) {
    block.addEventListener("dragover", (e) => {
      if (!block.classList.contains("is-collapsed")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      block.classList.add("session-drop-target");
    });
    block.addEventListener("dragleave", () => block.classList.remove("session-drop-target"));
    block.addEventListener("drop", (e) => {
      if (!block.classList.contains("is-collapsed")) return;
      e.preventDefault();
      block.classList.remove("session-drop-target");
      const id = e.dataTransfer.getData("text/plain");
      applyCardDrop(id, { front: frontSlug });
    });
  }

  /** Collapsed front subsection: drop sets priority + front (status unchanged). */
  function bindCollapsedPriorityFrontDrop(subsection, priorityKey, frontSlug) {
    subsection.addEventListener("dragover", (e) => {
      if (!subsection.classList.contains("is-collapsed")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      subsection.classList.add("session-drop-target");
    });
    subsection.addEventListener("dragleave", () => subsection.classList.remove("session-drop-target"));
    subsection.addEventListener("drop", (e) => {
      if (!subsection.classList.contains("is-collapsed")) return;
      e.preventDefault();
      subsection.classList.remove("session-drop-target");
      const id = e.dataTransfer.getData("text/plain");
      applyCardDrop(id, { priority: priorityKey, front: frontSlug });
    });
  }

  function renderPriorityBands(matrix, vis) {
    matrix.appendChild(
      el(
        "p",
        "swimlane-intro",
        "Priority runs in horizontal bands (top to bottom: Critical → Urgent → Medium → Low → Next step). Each band is split by label (front); ▼ collapses the whole priority band, and each front row has its own ▼ to expand or collapse that label’s columns."
      )
    );

    for (const priorityKey of PRIORITY_ORDER) {
      const block = el("section", "swimlane-band swim-priority-block priority-session");
      block.setAttribute("data-priority-tier", priorityKey);

      const inPriority = vis.filter((item) => effectivePriority(item) === priorityKey);
      const collapsed = isPriorityRowCollapsed(priorityKey);
      if (collapsed) block.classList.add("is-collapsed");

      const headerRow = el("div", "session-header-row session-section-header swim-row-head");
      headerRow.setAttribute("role", "button");
      headerRow.tabIndex = 0;
      headerRow.setAttribute("aria-expanded", collapsed ? "false" : "true");
      headerRow.setAttribute(
        "aria-label",
        (collapsed ? "Expand " : "Collapse ") + PRIORITY_LABELS[priorityKey] + " priority band"
      );

      const toggleBtn = el("button", "column-toggle session-toggle", collapsed ? "▶" : "▼");
      toggleBtn.type = "button";
      toggleBtn.setAttribute("aria-hidden", "true");
      toggleBtn.tabIndex = -1;
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        togglePriorityRowCollapse(priorityKey);
      });

      headerRow.appendChild(toggleBtn);
      headerRow.appendChild(el("span", "session-title-text", PRIORITY_LABELS[priorityKey]));
      headerRow.appendChild(el("span", "count session-count", String(inPriority.length)));

      headerRow.addEventListener("click", (e) => {
        if (e.target.closest(".column-toggle")) return;
        togglePriorityRowCollapse(priorityKey);
      });
      headerRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          togglePriorityRowCollapse(priorityKey);
        }
      });

      block.appendChild(headerRow);

      const n = inPriority.length;
      block.appendChild(
        el(
          "p",
          "session-collapsed-hint",
          n === 0
            ? "Collapsed — expand for status columns, or drop here to set priority only"
            : `Collapsed · ${n} card${n === 1 ? "" : "s"} — expand to see Backlog / In progress / …`
        )
      );

      const inner = el("div", "priority-column-inner swimlane-band-body");

      if (inPriority.length === 0) {
        appendPriorityStatusSection(inner, vis, priorityKey, null);
      } else {
        const bandOrder = getFrontBandsOrder(inPriority);
        for (const frontSlug of bandOrder) {
          const subsection = el("div", "priority-front-subsection");
          const inSlice = inPriority.filter((item) => effectiveFront(item) === frontSlug);
          const subCollapsed = isPriorityFrontSubCollapsed(priorityKey, frontSlug);
          if (subCollapsed) subsection.classList.add("is-collapsed");

          const subHead = el("div", "session-header-row session-section-header priority-front-subhead swim-row-head");
          subHead.setAttribute("role", "button");
          subHead.tabIndex = 0;
          subHead.setAttribute("aria-expanded", subCollapsed ? "false" : "true");
          subHead.setAttribute(
            "aria-label",
            (subCollapsed ? "Expand " : "Collapse ") + frontLabel(frontSlug) + " within " + PRIORITY_LABELS[priorityKey]
          );

          const subToggle = el("button", "column-toggle session-toggle", subCollapsed ? "▶" : "▼");
          subToggle.type = "button";
          subToggle.setAttribute("aria-hidden", "true");
          subToggle.tabIndex = -1;
          subToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            togglePriorityFrontSubCollapse(priorityKey, frontSlug);
          });

          subHead.appendChild(subToggle);
          const titleEl = el("span", "session-title-text priority-front-subhead-title", frontLabel(frontSlug));
          subHead.appendChild(titleEl);
          subHead.appendChild(el("span", "count session-count", String(inSlice.length)));

          subHead.addEventListener("click", (e) => {
            if (e.target.closest(".column-toggle")) return;
            togglePriorityFrontSubCollapse(priorityKey, frontSlug);
          });
          subHead.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePriorityFrontSubCollapse(priorityKey, frontSlug);
            }
          });

          subsection.appendChild(subHead);

          const nSlice = inSlice.length;
          subsection.appendChild(
            el(
              "p",
              "session-collapsed-hint priority-front-collapsed-hint",
              nSlice === 0
                ? "Collapsed — expand for columns, or drop here to set priority + label"
                : `Collapsed · ${nSlice} card${nSlice === 1 ? "" : "s"} — expand for status columns`
            )
          );

          const subBody = el("div", "priority-front-subsection-body");
          appendPriorityStatusSection(subBody, vis, priorityKey, frontSlug);
          subsection.appendChild(subBody);

          bindCollapsedPriorityFrontDrop(subsection, priorityKey, frontSlug);
          inner.appendChild(subsection);
        }
      }

      block.appendChild(inner);

      bindCollapsedPriorityRowDrop(block, priorityKey);
      matrix.appendChild(block);
    }
  }

  function renderLabelBands(matrix, vis) {
    matrix.appendChild(
      el(
        "p",
        "swimlane-intro",
        "Each band is a front / label. Inside: the same six workflow columns. Drag moves status and label; priority stays unless you edit the card. ▼ folds that band."
      )
    );

    const bandOrder = getFrontBandsOrder(vis);
    if (!bandOrder.length) {
      matrix.appendChild(
        el("p", "swimlane-empty", "No cards match the current filters — try widening source or label filters.")
      );
      return;
    }

    for (const frontSlug of bandOrder) {
      const block = el("section", "swimlane-band swim-label-block swim-priority-block priority-session");
      block.setAttribute("data-front-slug", frontSlug);

      const inBand = vis.filter((item) => effectiveFront(item) === frontSlug);
      const collapsed = isFrontRowCollapsed(frontSlug);
      if (collapsed) block.classList.add("is-collapsed");

      const headerRow = el("div", "session-header-row session-section-header swim-row-head");
      headerRow.setAttribute("role", "button");
      headerRow.tabIndex = 0;
      headerRow.setAttribute("aria-expanded", collapsed ? "false" : "true");
      headerRow.setAttribute(
        "aria-label",
        (collapsed ? "Expand " : "Collapse ") + frontLabel(frontSlug) + " label band"
      );

      const toggleBtn = el("button", "column-toggle session-toggle", collapsed ? "▶" : "▼");
      toggleBtn.type = "button";
      toggleBtn.setAttribute("aria-hidden", "true");
      toggleBtn.tabIndex = -1;
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleFrontRowCollapse(frontSlug);
      });

      headerRow.appendChild(toggleBtn);
      headerRow.appendChild(el("span", "session-title-text", frontLabel(frontSlug)));
      headerRow.appendChild(el("span", "count session-count", String(inBand.length)));

      headerRow.addEventListener("click", (e) => {
        if (e.target.closest(".column-toggle")) return;
        toggleFrontRowCollapse(frontSlug);
      });
      headerRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleFrontRowCollapse(frontSlug);
        }
      });

      block.appendChild(headerRow);

      const n = inBand.length;
      block.appendChild(
        el(
          "p",
          "session-collapsed-hint",
          n === 0
            ? "Collapsed — expand for status columns, or drop here to set label only"
            : `Collapsed · ${n} card${n === 1 ? "" : "s"} — expand to see Backlog / In progress / …`
        )
      );

      const inner = el("div", "priority-column-inner swimlane-band-body");

      const labelRow = el("div", "priority-inner-label-row");
      for (const statusKey of STATUS_ORDER) {
        const list = vis.filter(
          (item) => effectiveStatus(item) === statusKey && effectiveFront(item) === frontSlug
        );
        const lab = el("div", "priority-inner-label");
        lab.setAttribute("data-status-col", statusKey);
        lab.appendChild(el("span", "priority-inner-label-text", STATUS_LABELS[statusKey]));
        lab.appendChild(el("span", "count priority-inner-count", String(list.length)));
        labelRow.appendChild(lab);
      }
      inner.appendChild(labelRow);

      const grid = el("div", "priority-status-grid");
      for (const statusKey of STATUS_ORDER) {
        const list = vis.filter(
          (item) => effectiveStatus(item) === statusKey && effectiveFront(item) === frontSlug
        );
        const zone = el("div", "session-cards swim-cell");
        zone.setAttribute("data-drop-status", statusKey);
        zone.setAttribute("data-drop-front", frontSlug);
        setupLabelDropZone(zone, statusKey, frontSlug);
        if (list.length === 0) {
          zone.appendChild(el("p", "empty-hint", "Drop here"));
        } else {
          for (const item of list) zone.appendChild(renderCard(item));
        }
        grid.appendChild(zone);
      }
      inner.appendChild(grid);

      block.appendChild(inner);

      bindCollapsedLabelRowDrop(block, frontSlug);
      matrix.appendChild(block);
    }
  }

  function renderBoard() {
    const root = document.getElementById("board-root");
    if (!root) return;
    root.innerHTML = "";
    syncViewTabs();

    const vis = visibleItems();
    updateFilterSummary(vis.length);

    const matrix = el("div", "swimlane-matrix");
    if (getBoardView() === "labels") {
      root.className = "board swimlane-board swimlane-board--labels";
      renderLabelBands(matrix, vis);
    } else {
      root.className = "board swimlane-board";
      renderPriorityBands(matrix, vis);
    }
    root.appendChild(matrix);
  }

  function openModal(id) {
    const item = itemsById.get(id);
    if (!item) return;
    const backdrop = document.getElementById("modal-backdrop");
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
    b.classList.remove("open");
    b.setAttribute("aria-hidden", "true");
  }

  function saveModal() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop.dataset.itemId;
    if (!id) return;
    if (!overrides[id]) overrides[id] = {};
    const titleInput = document.getElementById("modal-title-input");
    const t = titleInput ? titleInput.value.trim() : "";

    if (id.startsWith("local-")) {
      const card = customItems.find((c) => c.id === id);
      if (card) {
        card.title = t || "(no title)";
        saveCustomCards(customItems);
        rebuildMerged();
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
    saveOverrides();
    renderBoard();
    closeModal();
  }

  function resetLocalCard() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop.dataset.itemId;
    if (
      !id ||
      !confirm(
        "Remove all local edits for this card (label, status, priority, text, dates, context)?"
      )
    )
      return;
    delete overrides[id];
    saveOverrides();
    renderBoard();
    closeModal();
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
      saveCustomCards(customItems);
    } else {
      hiddenIds.add(id);
      saveHiddenIds();
    }
    delete overrides[id];
    saveOverrides();
    rebuildMerged();
    populateFrontFilter();
    renderBoard();
    closeModal();
  }

  function resetDescriptionOnly() {
    const backdrop = document.getElementById("modal-backdrop");
    const id = backdrop.dataset.itemId;
    if (!id) return;
    const item = itemsById.get(id);
    if (overrides[id]) {
      delete overrides[id].description;
      if (Object.keys(overrides[id]).length === 0) delete overrides[id];
    }
    saveOverrides();
    document.getElementById("modal-description").value = item ? item.description || "" : "";
  }

  function openAddModal() {
    populateAddFrontSelect();
    document.getElementById("add-title").value = "";
    document.getElementById("add-description").value = "";
    document.getElementById("add-dod").value = "";
    document.getElementById("add-people").value = "";
    document.getElementById("add-priority").value = DEFAULT_PRIORITY;
    document.getElementById("add-status").value = "backlog";
    const b = document.getElementById("add-modal-backdrop");
    b.classList.add("open");
    b.setAttribute("aria-hidden", "false");
  }

  function closeAddModal() {
    const b = document.getElementById("add-modal-backdrop");
    b.classList.remove("open");
    b.setAttribute("aria-hidden", "true");
  }

  function saveNewTask() {
    const title = document.getElementById("add-title").value.trim();
    if (!title) {
      alert("Please enter a title.");
      return;
    }
    const fields = {
      title,
      description: document.getElementById("add-description").value.trim() || "",
      front: document.getElementById("add-front").value || "other",
      priority: document.getElementById("add-priority").value || "backlog",
      status: document.getElementById("add-status").value || "backlog",
      definition_of_done: document.getElementById("add-dod").value.trim() || "",
      people: document
        .getElementById("add-people")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (globalThis.BacklogStore && typeof globalThis.BacklogStore.createLocalTask === "function") {
      try {
        globalThis.BacklogStore.createLocalTask(fields);
      } catch (e) {
        alert(e.message || "Could not create task");
        return;
      }
    } else {
      const id =
        "local-" +
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()));
      const card = {
        id,
        title: fields.title,
        description: fields.description,
        front: fields.front,
        priority: fields.priority,
        status: fields.status,
        definition_of_done: fields.definition_of_done,
        people: fields.people,
        sources: [{ type: "local", url: "", ref: "Added in browser" }],
      };
      if (!PRIORITY_ORDER.includes(card.priority)) card.priority = DEFAULT_PRIORITY;
      if (!STATUS_ORDER.includes(card.status)) card.status = "backlog";
      customItems.push(card);
      saveCustomCards(customItems);
    }
    customItems = loadCustomCards();
    rebuildMerged();
    populateFrontFilter();
    saveOverrides();
    renderBoard();
    closeAddModal();
  }

  async function init() {
    const err = document.getElementById("load-error");
    err.classList.remove("visible");
    err.textContent = "";

    hiddenIds = loadHiddenIds();
    overrides = loadOverrides();
    customItems = loadCustomCards();
    rebuildMerged();
    populateFrontFilter();
    populateAddFrontSelect();
    populateModalFrontSelect();
    syncViewTabs();
    if (!filterListenersWired) {
      filterListenersWired = true;
      document.getElementById("filter-source")?.addEventListener("change", renderBoard);
      document.getElementById("filter-front")?.addEventListener("change", renderBoard);
      document.querySelectorAll(".view-tab").forEach((btn) => {
        btn.addEventListener("click", () => setBoardView(btn.dataset.boardView || "priority"));
      });
      document.getElementById("btn-open-add-task")?.addEventListener("click", openAddModal);
      document.getElementById("btn-add-cancel")?.addEventListener("click", closeAddModal);
      document.getElementById("btn-add-save")?.addEventListener("click", saveNewTask);
      document.getElementById("add-modal-backdrop")?.addEventListener("click", (e) => {
        if (e.target.id === "add-modal-backdrop") closeAddModal();
      });
    }
    renderBoard();

    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const data = await res.json();
      serverItems = data.items || [];
      frontsMeta = data.fronts || [];
      rebuildMerged();
      populateFrontFilter();
      populateAddFrontSelect();
      populateModalFrontSelect();
      renderBoard();
    } catch (e) {
      err.textContent =
        "Could not load board-data.json — local cards above still load. Run scripts/render_board.py and open via scripts/serve_board.py (not file://). " +
        String(e.message || e);
      err.classList.add("visible");
      serverItems = [];
      frontsMeta = [];
      rebuildMerged();
      populateFrontFilter();
      populateAddFrontSelect();
      populateModalFrontSelect();
      renderBoard();
    }
  }

  document.getElementById("btn-modal-save")?.addEventListener("click", saveModal);
  document.getElementById("btn-modal-close")?.addEventListener("click", closeModal);
  document.getElementById("btn-modal-reset-desc")?.addEventListener("click", resetDescriptionOnly);
  document.getElementById("btn-modal-reset-all")?.addEventListener("click", resetLocalCard);
  document.getElementById("btn-modal-remove-from-board")?.addEventListener("click", removeFromBoard);
  document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });

  init();
})();
