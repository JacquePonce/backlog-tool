// Follow-ups page interactions.
// Strategy: the browser never mutates follow_ups.yaml directly. All action
// buttons (Mark done, +1d, +3d, Re-open, New follow-up) generate the exact
// shell command needed and copy it to the clipboard so you can paste it into
// your terminal.
(function () {
  'use strict';

  const ADD_DIALOG = document.getElementById('fu-add-dialog');
  const ADD_FORM = document.getElementById('fu-add-form');
  const ADD_PREVIEW = document.getElementById('fu-add-preview');
  const ADD_OPEN = document.getElementById('fu-add-open');
  const ADD_COPY = document.getElementById('fu-add-copy');
  const ADD_CLOSE = document.getElementById('fu-add-close');
  const TOAST = document.getElementById('fu-toast');

  let toastTimer = null;

  function showToast(text) {
    if (!TOAST) return;
    TOAST.textContent = text;
    TOAST.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => TOAST.classList.remove('is-visible'), 2400);
  }

  function shellEscape(value) {
    if (value == null) return '""';
    const s = String(value);
    if (s === '') return '""';
    if (/^[A-Za-z0-9._\/:+=-]+$/.test(s)) return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`') + '"';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function buildAddCommand(data) {
    const parts = ['make followup-add'];
    parts.push('TITLE=' + shellEscape(data.title || ''));
    parts.push('DAYS=' + shellEscape(String(data.days || 2)));
    if (data.url) parts.push('URL=' + shellEscape(data.url));
    if (data.context) parts.push('CONTEXT=' + shellEscape(data.context));
    if (data.people) parts.push('PEOPLE=' + shellEscape(data.people));
    return parts.join(' ');
  }

  function refreshAddPreview() {
    if (!ADD_FORM || !ADD_PREVIEW) return;
    const fd = new FormData(ADD_FORM);
    const cmd = buildAddCommand({
      title: fd.get('title'),
      url: fd.get('url'),
      context: fd.get('context'),
      people: fd.get('people'),
      days: fd.get('days'),
    });
    ADD_PREVIEW.textContent = cmd;
  }

  // Add dialog wiring
  if (ADD_OPEN && ADD_DIALOG) {
    ADD_OPEN.addEventListener('click', () => {
      if (typeof ADD_DIALOG.showModal === 'function') {
        ADD_DIALOG.showModal();
      } else {
        ADD_DIALOG.setAttribute('open', '');
      }
      refreshAddPreview();
      const titleInput = ADD_FORM.querySelector('input[name="title"]');
      if (titleInput) setTimeout(() => titleInput.focus(), 50);
    });
  }
  if (ADD_FORM) {
    ADD_FORM.addEventListener('input', refreshAddPreview);
    ADD_FORM.addEventListener('change', refreshAddPreview);
  }
  if (ADD_CLOSE && ADD_DIALOG) {
    ADD_CLOSE.addEventListener('click', () => ADD_DIALOG.close());
  }
  if (ADD_COPY) {
    ADD_COPY.addEventListener('click', () => {
      refreshAddPreview();
      const cmd = ADD_PREVIEW.textContent.trim();
      if (!cmd) return;
      copyToClipboard(cmd)
        .then(() => showToast('Command copied — paste in terminal'))
        .catch(() => showToast('Copy failed — select the text manually'));
    });
  }

  // Per-card action buttons (Mark done / +1d / +3d / Re-open)
  document.querySelectorAll('.fu-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      let cmd;
      let label;
      if (btn.classList.contains('fu-action--done')) {
        cmd = `make followup-done ID=${id}`;
        label = 'Mark done';
      } else {
        const days = btn.getAttribute('data-days') || '1';
        cmd = `make followup-push ID=${id} DAYS=${days}`;
        label = `Push +${days}d`;
      }
      copyToClipboard(cmd)
        .then(() => showToast(`${label} command copied: ${cmd}`))
        .catch(() => showToast('Copy failed — command: ' + cmd));
    });
  });
})();
