#!/usr/bin/env python3
"""Render follow_ups.html and follow_ups-data.json from follow_ups.yaml.

Time buckets are computed at render time (not stored in YAML):

    overdue    follow_up_on < today  AND status = pending
    today      follow_up_on = today  AND status = pending
    tomorrow   follow_up_on = today+1 AND status = pending
    this_week  today+2 <= follow_up_on <= today+7 AND status = pending
    later      follow_up_on > today+7 AND status = pending
    done       status = done, sorted by done_at desc, capped to last 30 days
"""

from __future__ import annotations

import html
import json
import sys
from datetime import date, datetime, timedelta
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

SOURCE_LABELS = {
    "slack": "Slack",
    "jira": "Jira",
    "confluence": "Confluence",
    "doc": "Doc",
    "other": "Other",
}

DONE_WINDOW_DAYS = 30


def load_items() -> list[dict]:
    if not FOLLOWUPS_FILE.is_file():
        return []
    data = yaml.safe_load(FOLLOWUPS_FILE.read_text(encoding="utf-8")) or {}
    return data.get("items") or []


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s))
    except ValueError:
        return None


def bucketize(items: list[dict], today: date) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {k: [] for k, _ in BUCKETS}
    cutoff_done = today - timedelta(days=DONE_WINDOW_DAYS)
    for raw in items:
        item = dict(raw)
        status = item.get("status", "pending")
        due = _parse_date(item.get("follow_up_on"))
        item["_due_date"] = due
        if status == "done":
            done_at = _parse_date(item.get("done_at")) or today
            if done_at >= cutoff_done:
                item["_sort_key"] = done_at
                out["done"].append(item)
            continue
        if due is None:
            out["later"].append(item)
            continue
        delta = (due - today).days
        if delta < 0:
            out["overdue"].append(item)
        elif delta == 0:
            out["today"].append(item)
        elif delta == 1:
            out["tomorrow"].append(item)
        elif 2 <= delta <= 7:
            out["this_week"].append(item)
        else:
            out["later"].append(item)
    for key in ("overdue", "today", "tomorrow", "this_week", "later"):
        out[key].sort(key=lambda i: (i.get("_due_date") or date.max, i.get("id", "")))
    out["done"].sort(key=lambda i: i.get("_sort_key") or today, reverse=True)
    return out


def _humanize(due: date | None, today: date) -> str:
    if due is None:
        return ""
    delta = (due - today).days
    if delta < 0:
        return f"{-delta}d overdue"
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta <= 7:
        return f"in {delta} days"
    return due.strftime("%b %d")


def _render_card(item: dict, today: date) -> str:
    title = html.escape(item.get("title") or "(untitled)")
    url = item.get("url") or ""
    source = item.get("source") or "other"
    source_label = SOURCE_LABELS.get(source, source)
    context = html.escape(item.get("context") or "")
    people = [html.escape(p) for p in (item.get("people") or [])]
    due = item.get("_due_date")
    due_str = _humanize(due, today)
    due_iso = due.isoformat() if due else ""
    is_done = item.get("status") == "done"
    done_at = item.get("done_at") or ""
    item_id = html.escape(item.get("id") or "")

    title_html = (
        f'<a href="{html.escape(url)}" target="_blank" rel="noopener" class="fu-title-link">{title}</a>'
        if url
        else f'<span class="fu-title-link">{title}</span>'
    )

    meta_bits = [f'<span class="fu-source fu-source--{html.escape(source)}">{html.escape(source_label)}</span>']
    if due_str and not is_done:
        meta_bits.append(f'<span class="fu-due" data-due="{due_iso}">{due_str}</span>')
    if is_done and done_at:
        meta_bits.append(f'<span class="fu-due fu-due--done">Done {html.escape(done_at)}</span>')
    if people:
        meta_bits.append(f'<span class="fu-people">{", ".join(people)}</span>')
    meta_html = "".join(meta_bits)

    context_html = f'<p class="fu-context">{context}</p>' if context else ""

    actions = []
    if not is_done:
        actions.append(
            f'<button type="button" class="fu-action fu-action--done" data-id="{item_id}" title="Copy shell command to mark this done">Mark done</button>'
        )
        actions.append(
            f'<button type="button" class="fu-action" data-id="{item_id}" data-days="1" title="Push this follow-up out by 1 day">+1d</button>'
        )
        actions.append(
            f'<button type="button" class="fu-action" data-id="{item_id}" data-days="3" title="Push this follow-up out by 3 days">+3d</button>'
        )
    else:
        actions.append(
            f'<button type="button" class="fu-action" data-id="{item_id}" data-days="1" title="Re-open this follow-up 1 day out">Re-open</button>'
        )
    actions_html = '<div class="fu-actions">' + "".join(actions) + "</div>"

    classes = ["fu-card"]
    if is_done:
        classes.append("fu-card--done")
    elif due is not None and (due - today).days < 0:
        classes.append("fu-card--overdue")

    id_footer = f'<span class="fu-id">{item_id}</span>' if item_id else ""

    return (
        f'<article class="{" ".join(classes)}" data-id="{item_id}">'
        f'  <header class="fu-head">{title_html}</header>'
        f'  <div class="fu-meta">{meta_html}</div>'
        f"  {context_html}"
        f'  <footer class="fu-foot">{id_footer}{actions_html}</footer>'
        f"</article>"
    )


def render_html(buckets: dict[str, list[dict]], today: date, total_pending: int, total_done_recent: int) -> str:
    columns_html = []
    for key, label in BUCKETS:
        items = buckets.get(key, [])
        cards_html = "".join(_render_card(i, today) for i in items) or '<p class="fu-empty">Nothing here.</p>'
        col_cls = f"fu-col fu-col--{key}"
        columns_html.append(
            f'<section class="{col_cls}">'
            f'  <header class="fu-col-head"><h2>{label}</h2><span class="fu-col-count">{len(items)}</span></header>'
            f'  <div class="fu-col-body">{cards_html}</div>'
            f"</section>"
        )
    columns = "\n".join(columns_html)
    today_label = today.strftime("%A %b %d")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Follow-ups — Backlog</title>
  <link rel="stylesheet" href="board_styles.css?v=home-dual-11">
  <link rel="stylesheet" href="follow_up_styles.css?v=1">
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
        <p class="fu-lead">{today_label} · <strong>{total_pending}</strong> pending · <strong>{total_done_recent}</strong> done in last {DONE_WINDOW_DAYS} days</p>
      </div>
      <button type="button" class="fu-add-btn" id="fu-add-open">+ New follow-up</button>
    </div>
  </header>

  <main class="fu-board">
    {columns}
  </main>

  <dialog id="fu-add-dialog" class="fu-dialog">
    <form method="dialog" class="fu-form" id="fu-add-form">
      <h2>New follow-up</h2>
      <p class="fu-form-hint">We generate a one-line shell command — copy and paste it into your terminal. Nothing is written to YAML from the browser.</p>
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
      <label>Follow up in
        <select name="days">
          <option value="1">1 day</option>
          <option value="2" selected>2 days</option>
          <option value="3">3 days</option>
          <option value="5">5 days (next week)</option>
          <option value="7">1 week</option>
          <option value="14">2 weeks</option>
        </select>
      </label>
      <output id="fu-add-preview" class="fu-preview" aria-live="polite"></output>
      <div class="fu-form-actions">
        <button type="button" id="fu-add-copy">Copy command</button>
        <button type="button" id="fu-add-close">Close</button>
      </div>
    </form>
  </dialog>

  <div id="fu-toast" class="fu-toast" role="status" aria-live="polite"></div>

  <script src="follow_ups.js?v=1" defer></script>
</body>
</html>
"""


def main() -> None:
    items = load_items()
    today = date.today()
    buckets = bucketize(items, today)
    total_pending = sum(
        len(buckets.get(k, []))
        for k in ("overdue", "today", "tomorrow", "this_week", "later")
    )
    total_done_recent = len(buckets.get("done", []))

    PAGE_FILE.write_text(render_html(buckets, today, total_pending, total_done_recent), encoding="utf-8")

    data_payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "counts": {
            "pending": total_pending,
            "done_recent": total_done_recent,
        },
        "buckets": {
            k: [
                {kk: vv for kk, vv in item.items() if not kk.startswith("_")}
                for item in buckets.get(k, [])
            ]
            for k, _ in BUCKETS
        },
    }
    DATA_FILE.write_text(json.dumps(data_payload, indent=2), encoding="utf-8")

    print(f"Wrote {PAGE_FILE}")
    print(f"Wrote {DATA_FILE}")
    print(f"  {total_pending} pending · {total_done_recent} done in last {DONE_WINDOW_DAYS}d")


if __name__ == "__main__":
    main()
