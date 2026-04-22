// Follow-ups page -- client-side add/edit/done/push, persisted in localStorage.
//
// Data sources merged at render time:
//   1) follow_ups-data.json  (YAML-backed items, served from disk)
//   2) localStorage['fu.local']      -> items created in the browser
//   3) localStorage['fu.overrides']  -> per-id {status, follow_up_on, done_at, deleted}
//
// Writing back to the YAML file is optional (the "Export YAML" button gives you
// a paste-ready snippet when you want to commit to git).
(function () {
  'use strict';

  const LOCAL_KEY = 'fu.local';
  const OVR_KEY = 'fu.overrides';
  const DONE_WINDOW_DAYS = 30;

  const SOURCE_LABELS = {
    slack: 'Slack',
    jira: 'Jira',
    confluence: 'Confluence',
    doc: 'Doc',
    other: 'Other',
  };

  const BUCKETS = ['overdue', 'today', 'tomorrow', 'this_week', 'later', 'done'];

  let yamlItems = [];
  let todayISO = '';

  // ---------- storage helpers ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      console.warn('localStorage read failed for', key, e);
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage write failed for', key, e);
      showToast('Could not save — browser storage is full or blocked.');
    }
  }
  function readLocal() { return readJSON(LOCAL_KEY, []); }
  function writeLocal(v) { writeJSON(LOCAL_KEY, v); }
  function readOverrides() { return readJSON(OVR_KEY, {}); }
  function writeOverrides(v) { writeJSON(OVR_KEY, v); }

  // ---------- date helpers ----------
  function todayDate() {
    return new Date(`${todayISO}T00:00:00`);
  }
  function parseISO(s) {
    if (!s) return null;
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(d, n) {
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + n);
    return out;
  }
  function daysBetween(a, b) {
    return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
  }
  function humanize(dueISO) {
    const due = parseISO(dueISO);
    if (!due) return '';
    const delta = daysBetween(due, todayDate());
    if (delta < 0) return `${-delta}d overdue`;
    if (delta === 0) return 'today';
    if (delta === 1) return 'tomorrow';
    if (delta <= 7) return `in ${delta} days`;
    return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- source inference ----------
  function inferSource(url) {
    if (!url) return 'other';
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('slack.com')) return 'slack';
      if (host.includes('atlassian.net')) return url.includes('/wiki/') ? 'confluence' : 'jira';
      if (host.includes('docs.google.com') || host.includes('drive.google.com')) return 'doc';
    } catch (e) { /* invalid URL */ }
    return 'other';
  }

  // ---------- id generation ----------
  function nextId() {
    const stamp = todayISO.replace(/-/g, '');
    const prefix = `fu-${stamp}-`;
    const local = readLocal();
    const allIds = new Set([
      ...yamlItems.map(i => i.id || ''),
      ...local.map(i => i.id || ''),
    ]);
    let n = 1;
    // find max existing number for today's prefix
    for (const id of allIds) {
      if (id.startsWith(prefix)) {
        const tail = id.slice(prefix.length);
        const num = parseInt(tail, 10);
        if (!isNaN(num) && num >= n) n = num + 1;
      }
    }
    return `${prefix}${String(n).padStart(3, '0')}`;
  }

  // ---------- merge & bucket ----------
  function mergedItems() {
    const local = readLocal();
    const overrides = readOverrides();
    const out = [];
    for (const raw of yamlItems.concat(local)) {
      const ov = overrides[raw.id] || {};
      if (ov.deleted) continue;
      const merged = Object.assign({}, raw, ov);
      merged._origin = local.includes(raw) ? 'local' : 'yaml';
      out.push(merged);
    }
    return out;
  }

  function bucketize(items) {
    const buckets = {};
    BUCKETS.forEach(k => { buckets[k] = []; });
    const today = todayDate();
    const doneCutoff = addDays(today, -DONE_WINDOW_DAYS);
    for (const item of items) {
      if (item.status === 'done') {
        const doneAt = parseISO(item.done_at) || today;
        if (doneAt >= doneCutoff) buckets.done.push(item);
        continue;
      }
      const due = parseISO(item.follow_up_on);
      if (!due) { buckets.later.push(item); continue; }
      const delta = daysBetween(due, today);
      if (delta < 0) buckets.overdue.push(item);
      else if (delta === 0) buckets.today.push(item);
      else if (delta === 1) buckets.tomorrow.push(item);
      else if (delta <= 7) buckets.this_week.push(item);
      else buckets.later.push(item);
    }
    // sort within buckets
    const byDue = (a, b) => (a.follow_up_on || '9999-12-31').localeCompare(b.follow_up_on || '9999-12-31');
    const byDoneDesc = (a, b) => (b.done_at || '').localeCompare(a.done_at || '');
    ['overdue', 'today', 'tomorrow', 'this_week', 'later'].forEach(k => buckets[k].sort(byDue));
    buckets.done.sort(byDoneDesc);
    return buckets;
  }

  // ---------- rendering ----------
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderCard(item) {
    const card = document.createElement('article');
    card.className = 'fu-card';
    if (item.status === 'done') card.classList.add('fu-card--done');
    const due = parseISO(item.follow_up_on);
    const today = todayDate();
    const isOverdue = due && daysBetween(due, today) < 0 && item.status !== 'done';
    if (isOverdue) card.classList.add('fu-card--overdue');
    card.dataset.id = item.id || '';

    const head = document.createElement('header');
    head.className = 'fu-head';
    if (item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'fu-title-link';
      a.textContent = item.title || '(untitled)';
      head.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'fu-title-link';
      span.textContent = item.title || '(untitled)';
      head.appendChild(span);
    }
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'fu-meta';
    const source = item.source || inferSource(item.url);
    meta.innerHTML = `<span class="fu-source fu-source--${escapeHtml(source)}">${escapeHtml(SOURCE_LABELS[source] || source)}</span>`;
    if (item.status === 'done' && item.done_at) {
      meta.innerHTML += `<span class="fu-due fu-due--done">Done ${escapeHtml(item.done_at)}</span>`;
    } else if (item.follow_up_on) {
      meta.innerHTML += `<span class="fu-due">${escapeHtml(humanize(item.follow_up_on))}</span>`;
    }
    if (item.people && item.people.length) {
      meta.innerHTML += `<span class="fu-people">${escapeHtml(item.people.join(', '))}</span>`;
    }
    card.appendChild(meta);

    if (item.context) {
      const p = document.createElement('p');
      p.className = 'fu-context';
      p.textContent = item.context;
      card.appendChild(p);
    }

    if (item.id) card.title = item.id;

    const foot = document.createElement('footer');
    foot.className = 'fu-foot';

    const actions = document.createElement('div');
    actions.className = 'fu-actions';

    if (item.status === 'done') {
      const reopen = mkBtn('Re-open', 'fu-action', () => reopenItem(item.id), 'Re-open this follow-up');
      actions.appendChild(reopen);
    } else {
      const editBtn = mkBtn('Edit', 'fu-action fu-action--icon', () => openEdit(item), 'Edit');
      editBtn.innerHTML = '<span aria-hidden="true">✎</span><span class="fu-sr">Edit</span>';
      const doneBtn = mkBtn('Done', 'fu-action fu-action--done fu-action--icon', () => markDone(item.id), 'Mark done');
      doneBtn.innerHTML = '<span aria-hidden="true">✓</span><span class="fu-sr">Done</span>';
      const plus1 = mkBtn('+1', 'fu-action', () => pushItem(item.id, 1), 'Push +1 day');
      const plus3 = mkBtn('+3', 'fu-action', () => pushItem(item.id, 3), 'Push +3 days');
      actions.appendChild(editBtn);
      actions.appendChild(doneBtn);
      actions.appendChild(plus1);
      actions.appendChild(plus3);
    }
    foot.appendChild(actions);
    card.appendChild(foot);
    return card;
  }

  function mkBtn(label, cls, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderAll() {
    const items = mergedItems();
    const buckets = bucketize(items);
    let pending = 0;
    let doneRecent = buckets.done.length;
    for (const key of BUCKETS) {
      const body = document.querySelector(`[data-body-for="${key}"]`);
      const countEl = document.querySelector(`[data-count-for="${key}"]`);
      if (!body || !countEl) continue;
      body.innerHTML = '';
      const arr = buckets[key] || [];
      countEl.textContent = String(arr.length);
      if (key !== 'done') pending += arr.length;
      if (arr.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fu-empty';
        empty.textContent = 'Nothing here.';
        body.appendChild(empty);
      } else {
        arr.forEach(item => body.appendChild(renderCard(item)));
      }
    }
    const todayLabel = new Date(`${todayISO}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric',
    });
    const lead = document.getElementById('fu-lead');
    if (lead) {
      lead.innerHTML = `${escapeHtml(todayLabel)} · <strong>${pending}</strong> pending · <strong>${doneRecent}</strong> done in last ${DONE_WINDOW_DAYS} days`;
    }
  }

  // ---------- actions ----------
  function findItem(id) {
    return mergedItems().find(x => x.id === id);
  }

  function setOverride(id, patch) {
    const ov = readOverrides();
    ov[id] = Object.assign({}, ov[id] || {}, patch);
    writeOverrides(ov);
  }

  function markDone(id) {
    setOverride(id, { status: 'done', done_at: todayISO });
    showToast('Marked done');
    renderAll();
  }

  function pushItem(id, days) {
    const item = findItem(id);
    if (!item) return;
    const base = parseISO(item.follow_up_on) || todayDate();
    const anchor = base < todayDate() ? todayDate() : base;
    const next = addDays(anchor, days);
    setOverride(id, { status: 'pending', follow_up_on: toISO(next), done_at: null });
    showToast(`Pushed to ${toISO(next)}`);
    renderAll();
  }

  function reopenItem(id) {
    setOverride(id, { status: 'pending', done_at: null });
    // If follow_up_on is in the past, bump to today
    const item = findItem(id);
    const due = item && parseISO(item.follow_up_on);
    if (!due || due < todayDate()) {
      setOverride(id, { follow_up_on: toISO(addDays(todayDate(), 1)) });
    }
    showToast('Re-opened');
    renderAll();
  }

  function deleteItem(id) {
    const local = readLocal();
    const idx = local.findIndex(x => x.id === id);
    if (idx >= 0) {
      // purely-local: drop it from the array
      local.splice(idx, 1);
      writeLocal(local);
      // also drop any overrides
      const ov = readOverrides();
      delete ov[id];
      writeOverrides(ov);
    } else {
      // yaml-origin: mark deleted via override so it stays gone across reloads
      setOverride(id, { deleted: true });
    }
    showToast('Deleted');
    renderAll();
  }

  function saveItem(existing, fields) {
    const cleaned = {
      title: (fields.title || '').trim(),
      url: (fields.url || '').trim(),
      context: (fields.context || '').trim(),
      people: (fields.people || '').split(',').map(s => s.trim()).filter(Boolean),
      follow_up_on: (fields.follow_up_on || '').trim(),
    };
    if (!cleaned.title) { showToast('Title is required'); return false; }
    if (!cleaned.follow_up_on) { showToast('Follow-up date is required'); return false; }
    const source = inferSource(cleaned.url) || 'other';

    if (existing && existing._origin === 'yaml') {
      // Override the YAML item
      setOverride(existing.id, Object.assign({}, cleaned, { source, status: 'pending', done_at: null }));
      showToast('Saved');
    } else if (existing && existing._origin === 'local') {
      // Update the local item in place
      const local = readLocal();
      const idx = local.findIndex(x => x.id === existing.id);
      if (idx >= 0) {
        local[idx] = Object.assign({}, local[idx], cleaned, { source, status: 'pending' });
        delete local[idx].done_at;
        writeLocal(local);
      }
      // clear any leftover override
      const ov = readOverrides();
      if (ov[existing.id]) { delete ov[existing.id]; writeOverrides(ov); }
      showToast('Saved');
    } else {
      // Brand new
      const local = readLocal();
      local.push(Object.assign({
        id: nextId(),
        source,
        status: 'pending',
        created_at: todayISO,
      }, cleaned));
      writeLocal(local);
      showToast('Added');
    }
    renderAll();
    return true;
  }

  // ---------- dialogs ----------
  const editDialog = document.getElementById('fu-edit-dialog');
  const editForm = document.getElementById('fu-edit-form');
  const editTitleHeading = document.getElementById('fu-edit-title');
  const editSave = document.getElementById('fu-edit-save');
  const editClose = document.getElementById('fu-edit-close');
  const editDelete = document.getElementById('fu-edit-delete');
  const addOpen = document.getElementById('fu-add-open');

  let currentEditing = null;

  function openEdit(item) {
    currentEditing = item || null;
    editTitleHeading.textContent = item ? 'Edit follow-up' : 'New follow-up';
    editForm.reset();
    editForm.elements['title'].value = item ? (item.title || '') : '';
    editForm.elements['url'].value = item ? (item.url || '') : '';
    editForm.elements['context'].value = item ? (item.context || '') : '';
    editForm.elements['people'].value = item && item.people ? item.people.join(', ') : '';
    const defaultDue = item && item.follow_up_on
      ? item.follow_up_on
      : toISO(addDays(todayDate(), 2));
    editForm.elements['follow_up_on'].value = defaultDue;
    editDelete.hidden = !item;
    if (typeof editDialog.showModal === 'function') editDialog.showModal();
    else editDialog.setAttribute('open', '');
    setTimeout(() => editForm.elements['title'].focus(), 50);
  }

  addOpen && addOpen.addEventListener('click', () => openEdit(null));
  editClose && editClose.addEventListener('click', () => editDialog.close());
  editSave && editSave.addEventListener('click', () => {
    const fields = {
      title: editForm.elements['title'].value,
      url: editForm.elements['url'].value,
      context: editForm.elements['context'].value,
      people: editForm.elements['people'].value,
      follow_up_on: editForm.elements['follow_up_on'].value,
    };
    if (saveItem(currentEditing, fields)) editDialog.close();
  });
  editDelete && editDelete.addEventListener('click', () => {
    if (!currentEditing) return;
    if (!confirm(`Delete "${currentEditing.title}"? This can't be undone.`)) return;
    deleteItem(currentEditing.id);
    editDialog.close();
  });

  // ---------- export ----------
  const exportDialog = document.getElementById('fu-export-dialog');
  const exportText = document.getElementById('fu-export-text');
  const exportOpen = document.getElementById('fu-export-open');
  const exportClose = document.getElementById('fu-export-close');
  const exportCopy = document.getElementById('fu-export-copy');

  function buildYamlSnippet() {
    const items = mergedItems();
    const lines = [
      '# Follow-up tracker -- exported from browser on ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      'version: 1',
      'items:',
    ];
    if (items.length === 0) { lines.push('  []'); return lines.join('\n') + '\n'; }
    const order = ['id','title','url','context','source','created_at','follow_up_on','status','done_at','people'];
    for (const item of items) {
      lines.push(`  - id: ${yamlScalar(item.id)}`);
      for (const key of order.slice(1)) {
        if (item[key] == null || item[key] === '') continue;
        if (key === 'people') {
          if (!item.people || !item.people.length) continue;
          lines.push(`    people:`);
          item.people.forEach(p => lines.push(`      - ${yamlScalar(p)}`));
        } else {
          lines.push(`    ${key}: ${yamlScalar(item[key])}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  function yamlScalar(v) {
    const s = String(v);
    if (s === '') return '""';
    if (/^[\w/:\-.,+()#@?=&%]+$/.test(s) && !/^[-?!@%`&*#>|]/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return "'" + s.replace(/'/g, "''") + "'";
  }

  exportOpen && exportOpen.addEventListener('click', () => {
    exportText.value = buildYamlSnippet();
    if (typeof exportDialog.showModal === 'function') exportDialog.showModal();
    else exportDialog.setAttribute('open', '');
  });
  exportClose && exportClose.addEventListener('click', () => exportDialog.close());
  exportCopy && exportCopy.addEventListener('click', () => {
    exportText.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(exportText.value).then(
        () => showToast('YAML copied to clipboard'),
        () => showToast('Copy failed — select and copy manually'),
      );
    } else {
      try { document.execCommand('copy'); showToast('YAML copied to clipboard'); }
      catch (e) { showToast('Copy failed — select and copy manually'); }
    }
  });

  // ---------- toast ----------
  const toast = document.getElementById('fu-toast');
  let toastTimer = null;
  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  // ---------- boot ----------
  fetch(`follow_ups-data.json?ts=${Date.now()}`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => {
      yamlItems = (data.items || []).map(i => Object.assign({}, i));
      todayISO = data.today || toISO(new Date());
      renderAll();
    })
    .catch(err => {
      console.warn('Could not load follow_ups-data.json', err);
      // Still usable -- user can add items client-side
      yamlItems = [];
      todayISO = toISO(new Date());
      renderAll();
      showToast('Could not load YAML items — browser-only mode.');
    });
})();
