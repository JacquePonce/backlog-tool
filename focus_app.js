/**
 * Daily focus: pick in-progress work per day. Uses BacklogStore (same tasks as the board).
 */
(function () {
  const LS_FOCUS = "backlog-daily-focus-v1";
  /** YYYY-MM-DD — last calendar day we ran “carry incomplete focus forward”. */
  const LS_LAST_ROLL = "backlog-focus-last-roll-v1";
  const store = window.BacklogStore;
  if (!store) {
    document.getElementById("load-error").textContent = "Missing backlog_shared.js — load it before focus_app.js.";
    document.getElementById("load-error").classList.add("visible");
    return;
  }

  if (globalThis.BacklogCardEditor) globalThis.BacklogCardEditor.init();
  document.addEventListener("backlog-card-saved", () => {
    loadAndRender();
  });

  let frontsMeta = [];
  let inProgressItems = [];
  let focusMap = {};

  function loadFocusMap() {
    try {
      const raw = localStorage.getItem(LS_FOCUS);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  function saveFocusMap() {
    localStorage.setItem(LS_FOCUS, JSON.stringify(focusMap));
  }

  function todayISODate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDaysISO(iso, deltaDays) {
    const p = iso.split("-").map(Number);
    const dt = new Date(p[0], p[1] - 1, p[2]);
    dt.setDate(dt.getDate() + deltaDays);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /**
   * Once per local calendar day: any task that still appears In progress on the board
   * and was on **any** of the last 14 days' saved focus lists gets merged into today's focus.
   * (Earlier we only looked at calendar yesterday — if you skipped opening Daily focus for
   * several days, older picks never rolled until the day after you last had a saved "yesterday".)
   */
  const ROLL_LOOKBACK_DAYS = 14;

  function rollIncompleteFocusFromYesterday() {
    const today = todayISODate();
    let lastRoll = "";
    try {
      lastRoll = localStorage.getItem(LS_LAST_ROLL) || "";
    } catch {
      lastRoll = "";
    }
    if (lastRoll === today) return 0;

    const inProg = new Set(inProgressItems.map((i) => i.id));
    const seen = new Set();
    const carry = [];
    for (let offset = 1; offset <= ROLL_LOOKBACK_DAYS; offset++) {
      const day = addDaysISO(today, -offset);
      for (const id of focusMap[day] || []) {
        if (!inProg.has(id) || seen.has(id)) continue;
        seen.add(id);
        carry.push(id);
      }
    }

    if (!carry.length) {
      try {
        localStorage.setItem(LS_LAST_ROLL, today);
      } catch {
        /* ignore */
      }
      return 0;
    }

    const todaySet = new Set(focusMap[today] || []);
    let added = 0;
    for (const id of carry) {
      if (!todaySet.has(id)) {
        todaySet.add(id);
        added += 1;
      }
    }

    try {
      localStorage.setItem(LS_LAST_ROLL, today);
    } catch {
      /* ignore */
    }

    if (!added) return 0;

    focusMap[today] = [...todaySet];
    saveFocusMap();
    return added;
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function getSelectedDate() {
    const inp = document.getElementById("focus-date");
    return inp && inp.value ? inp.value : todayISODate();
  }

  function renderInProgressList() {
    const root = document.getElementById("in-progress-list");
    if (!root) return;
    root.innerHTML = "";
    const date = getSelectedDate();
    const picked = new Set(focusMap[date] || []);

    if (!inProgressItems.length) {
      root.appendChild(
        el(
          "p",
          "focus-empty",
          "No tasks in “In progress”. Move cards on the board or set status in the card editor, then refresh this page."
        )
      );
      return;
    }

    for (const item of inProgressItems) {
      const row = el("div", "focus-task-row");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.itemId = item.id;
      cb.checked = picked.has(item.id);
      cb.setAttribute("aria-label", `Include in today's focus: ${item.title}`);
      row.appendChild(cb);
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "focus-task-open";
      openBtn.dataset.itemId = item.id;
      openBtn.textContent = item.title;
      openBtn.title = "Edit card (same as board)";
      row.appendChild(openBtn);
      const meta = el("span", "focus-task-meta", item.id.replace(/^jira-/, "").replace(/^local-/, "local · "));
      row.appendChild(meta);
      root.appendChild(row);
    }
  }

  function collectCheckedIds() {
    const ids = [];
    document.querySelectorAll("#in-progress-list input[type=checkbox]").forEach((cb) => {
      if (cb.checked && cb.dataset.itemId) ids.push(cb.dataset.itemId);
    });
    return ids;
  }

  function saveDayFocus() {
    const date = getSelectedDate();
    focusMap[date] = collectCheckedIds();
    saveFocusMap();
    renderWorkingOnPanel();
    const status = document.getElementById("focus-save-status");
    if (status) {
      status.textContent = `Saved focus for ${date}.`;
      setTimeout(() => {
        status.textContent = "";
      }, 2500);
    }
  }

  function renderWorkingOnPanel() {
    const out = document.getElementById("focus-selected-summary");
    const countEl = document.getElementById("focus-working-count");
    if (!out) return;

    const ids = collectCheckedIds();
    out.innerHTML = "";

    if (countEl) {
      countEl.textContent = ids.length ? `${ids.length} selected` : "";
    }

    if (!ids.length) {
      const msg = !inProgressItems.length
        ? "No in-progress tasks loaded — open the board, move work to In progress, then refresh."
        : "Tick tasks on the left; they show up here as your focus for this day.";
      out.appendChild(el("p", "focus-working-empty", msg));
      return;
    }

    const byId = new Map(inProgressItems.map((i) => [i.id, i]));
    // Rank by priority using the same order as the board bands. Most-urgent first.
    const PRIORITY_RANK = {
      critical: 0,
      urgent: 1,
      medium: 2,
      backlog: 3,
      next_steps: 4,
    };
    const PRIORITY_LABELS = {
      critical: "Critical",
      urgent: "Urgent",
      medium: "Medium",
      backlog: "Backlog",
      next_steps: "Next steps",
    };
    const rankedIds = ids.slice().sort((a, b) => {
      const pa = (byId.get(a) || {}).priority || "medium";
      const pb = (byId.get(b) || {}).priority || "medium";
      const ra = PRIORITY_RANK[pa] ?? 99;
      const rb = PRIORITY_RANK[pb] ?? 99;
      if (ra !== rb) return ra - rb;
      return ids.indexOf(a) - ids.indexOf(b);
    });

    for (const id of rankedIds) {
      const item = byId.get(id);
      const priority = (item && item.priority) || "medium";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "focus-working-card";
      card.dataset.itemId = id;
      card.dataset.priority = priority;
      card.title = `${PRIORITY_LABELS[priority] || priority} — click to edit (same as board)`;
      const titleEl = el("span", "focus-working-card-title", item ? item.title : id);
      const ref = item ? item.id.replace(/^jira-/, "").replace(/^local-/, "local · ") : id;
      const refEl = el("span", "focus-working-card-ref", ref);
      const pill = el("span", "focus-working-card-priority", PRIORITY_LABELS[priority] || priority);
      pill.dataset.priority = priority;
      card.appendChild(titleEl);
      const footRow = el("span", "focus-working-card-foot");
      footRow.appendChild(pill);
      footRow.appendChild(refEl);
      card.appendChild(footRow);
      out.appendChild(card);
    }
  }

  function populateAddFrontSelect() {
    const sel = document.getElementById("add-front");
    if (!sel) return;
    sel.innerHTML = "";
    const labelMap = Object.fromEntries((frontsMeta || []).map((f) => [f.slug, f.label]));
    const slugs = new Set([...(frontsMeta || []).map((f) => f.slug), "other"]);
    for (const slug of [...slugs].sort()) {
      const o = document.createElement("option");
      o.value = slug;
      o.textContent = labelMap[slug] || slug.replace(/_/g, " ");
      sel.appendChild(o);
    }
  }

  function openAddModal() {
    populateAddFrontSelect();
    document.getElementById("add-title").value = "";
    document.getElementById("add-description").value = "";
    document.getElementById("add-dod").value = "";
    document.getElementById("add-people").value = "";
    document.getElementById("add-priority").value = store.DEFAULT_PRIORITY;
    document.getElementById("add-status").value = "in_progress";
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
    try {
      store.createLocalTask({
        title,
        description: document.getElementById("add-description").value.trim(),
        front: document.getElementById("add-front").value || "other",
        priority: document.getElementById("add-priority").value,
        status: document.getElementById("add-status").value,
        definition_of_done: document.getElementById("add-dod").value.trim(),
        people: document
          .getElementById("add-people")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } catch (e) {
      alert(e.message || "Could not create task");
      return;
    }
    closeAddModal();
    loadAndRender();
  }

  async function loadAndRender() {
    const err = document.getElementById("load-error");
    err.classList.remove("visible");
    err.textContent = "";
    try {
      const { itemsDisplay, frontsMeta: fm, boardDataLoaded } = await store.loadBoardPayload();
      frontsMeta = fm || [];
      inProgressItems = itemsDisplay.filter((i) => i.status === "in_progress");
      focusMap = loadFocusMap();
      if (!boardDataLoaded) {
        err.textContent =
          "Could not load board-data.json — only browser-local cards appear. Open over https (GitHub Pages) or http://127.0.0.1 with serve_board.py — not file://.";
        err.classList.add("visible");
      }
      const carried = rollIncompleteFocusFromYesterday();
      if (carried > 0) {
        const status = document.getElementById("focus-save-status");
        if (status) {
          status.textContent =
            carried === 1
              ? "Carried 1 unfinished task from recent days to today (still in progress)."
              : `Carried ${carried} unfinished tasks from recent days to today (still in progress).`;
          setTimeout(() => {
            status.textContent = "";
          }, 6000);
        }
      }
      renderInProgressList();
      renderWorkingOnPanel();
    } catch (e) {
      err.textContent = String(e.message || e);
      err.classList.add("visible");
    }
  }

  document.getElementById("focus-date").value = todayISODate();
  document.getElementById("focus-date")?.addEventListener("change", () => {
    renderInProgressList();
    renderWorkingOnPanel();
  });

  document.querySelector(".focus-columns")?.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("input[type=checkbox]") && t.closest("#in-progress-list")) {
      renderWorkingOnPanel();
    }
  });

  document.querySelector(".focus-main")?.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("input[type=checkbox]")) return;
    const trigger = t.closest && t.closest(".focus-task-open, .focus-working-card");
    if (!trigger || !trigger.dataset.itemId || !globalThis.BacklogCardEditor) return;
    e.preventDefault();
    globalThis.BacklogCardEditor.openCard(trigger.dataset.itemId);
  });
  document.getElementById("btn-save-focus")?.addEventListener("click", saveDayFocus);
  document.getElementById("btn-refresh")?.addEventListener("click", loadAndRender);
  document.getElementById("btn-open-add-task")?.addEventListener("click", openAddModal);
  document.getElementById("btn-add-cancel")?.addEventListener("click", closeAddModal);
  document.getElementById("btn-add-save")?.addEventListener("click", saveNewTask);
  document.getElementById("add-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "add-modal-backdrop") closeAddModal();
  });

  loadAndRender();
})();
