#!/usr/bin/env python3
"""Render the follow-ups HTML shell + data JSON.

The HTML is a thin shell — all card rendering, bucketing, and state persistence
happens client-side in ``follow_ups.js`` (backed by localStorage + this JSON).

Flow:
  follow_ups.yaml   (optional, checked in for backups / cross-device sync)
        |
        v  (this script)
  follow_ups-data.json  ----->  follow_ups.js  <-->  localStorage
        |                            |
        v                            v
  follow_ups.html              renders columns
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Install PyYAML: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

BACKLOG_DIR = Path(__file__).resolve().parent.parent
FOLLOWUPS_FILE = BACKLOG_DIR / "follow_ups.yaml"
PAGE_FILE = BACKLOG_DIR / "follow_ups.html"
DATA_FILE = BACKLOG_DIR / "follow_ups-data.json"

BUCKETS = [
    ("overdue", "Overdue"),
    ("today", "Today"),
    ("tomorrow", "Tomorrow"),
    ("this_week", "This week"),
    ("later", "Later"),
    ("done", "Recently done"),
]

DONE_WINDOW_DAYS = 30


def load_items() -> list[dict]:
    if not FOLLOWUPS_FILE.is_file():
        return []
    data = yaml.safe_load(FOLLOWUPS_FILE.read_text(encoding="utf-8")) or {}
    return data.get("items") or []


def render_html(today: date) -> str:
    today_label = today.strftime("%A %b %d")
    columns_html = "\n".join(
        f'    <section class="fu-col fu-col--{key}" data-bucket="{key}">'
        f'      <header class="fu-col-head"><h2>{label}</h2><span class="fu-col-count" data-count-for="{key}">0</span></header>'
        f'      <div class="fu-col-body" data-body-for="{key}"></div>'
        f'    </section>'
        for key, label in BUCKETS
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Follow-ups — Backlog</title>
  <link rel="stylesheet" href="board_styles.css?v=home-dual-11">
  <link rel="stylesheet" href="follow_up_styles.css?v=2">
</head>
<body class="fu-body">
  <header class="fu-page-head">
    <nav class="app-pages" aria-label="Pages">
      <a href="index.html" class="app-page-link">Home</a>
      <a href="board.html" class="app-page-link">Board</a>
      <a href="focus.html" class="app-page-link">Daily focus</a>
      <a href="follow_ups.html" class="app-page-link is-current">Follow-ups</a>
    </nav>
    <div class="fu-header-row">
      <div>
        <h1>Follow-ups</h1>
        <p class="fu-lead" id="fu-lead">{today_label} · loading…</p>
      </div>
      <div class="fu-header-actions">
        <button type="button" class="fu-add-btn" id="fu-add-open">+ New follow-up</button>
        <button type="button" class="fu-secondary-btn" id="fu-export-open" title="Copy the YAML for all items (for backup / git)">Export YAML</button>
      </div>
    </div>
  </header>

  <main class="fu-board" id="fu-board">
{columns_html}
  </main>

  <dialog id="fu-edit-dialog" class="fu-dialog">
    <form method="dialog" class="fu-form" id="fu-edit-form">
      <h2 id="fu-edit-title">New follow-up</h2>
      <label>Title
        <input type="text" name="title" required autocomplete="off" placeholder="Reply to Davi re: Staging issues">
      </label>
      <label>Link (Slack thread / Jira / doc)
        <input type="url" name="url" autocomplete="off" placeholder="https://nubank.slack.com/...">
      </label>
      <label>Context (optional)
        <input type="text" name="context" autocomplete="off" placeholder="waiting on PR review">
      </label>
      <label>People (optional, comma-separated)
        <input type="text" name="people" autocomplete="off" placeholder="Davi Melazo, Viotti">
      </label>
      <label>Follow up on
        <input type="date" name="follow_up_on" required>
      </label>
      <div class="fu-form-actions">
        <button type="button" class="fu-danger-btn" id="fu-edit-delete" hidden>Delete</button>
        <span class="fu-spacer"></span>
        <button type="button" id="fu-edit-close">Cancel</button>
        <button type="button" class="fu-primary-btn" id="fu-edit-save">Save</button>
      </div>
    </form>
  </dialog>

  <dialog id="fu-export-dialog" class="fu-dialog">
    <form method="dialog" class="fu-form">
      <h2>Export follow-ups</h2>
      <p class="fu-form-hint">Paste this into <code>follow_ups.yaml</code> (or save to disk) to back up your browser state to git.</p>
      <textarea id="fu-export-text" rows="14" readonly spellcheck="false"></textarea>
      <div class="fu-form-actions">
        <span class="fu-spacer"></span>
        <button type="button" id="fu-export-copy" class="fu-primary-btn">Copy to clipboard</button>
        <button type="button" id="fu-export-close">Close</button>
      </div>
    </form>
  </dialog>

  <div id="fu-toast" class="fu-toast" role="status" aria-live="polite"></div>

  <script src="follow_ups.js?v=2" defer></script>
</body>
</html>
"""


def main() -> None:
    items = load_items()
    today = date.today()

    PAGE_FILE.write_text(render_html(today), encoding="utf-8")

    data_payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "done_window_days": DONE_WINDOW_DAYS,
        "items": items,
    }
    DATA_FILE.write_text(json.dumps(data_payload, indent=2), encoding="utf-8")

    print(f"Wrote {PAGE_FILE}")
    print(f"Wrote {DATA_FILE}  ({len(items)} YAML items)")


if __name__ == "__main__":
    main()
