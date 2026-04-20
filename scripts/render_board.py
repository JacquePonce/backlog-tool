#!/usr/bin/env python3
"""Render BOARD.md, BOARD.html, board.html (interactive shell), and board-data.json from items.yaml."""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Install PyYAML: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

BACKLOG_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
ITEMS_FILE = BACKLOG_DIR / "items.yaml"
BOARD_FILE = BACKLOG_DIR / "BOARD.md"
BOARD_HTML = BACKLOG_DIR / "BOARD.html"
BOARD_PAGE = BACKLOG_DIR / "board.html"
BOARD_DATA = BACKLOG_DIR / "board-data.json"
BOARD_SHELL = SCRIPTS_DIR / "BOARD_shell.html"
FRONTS_FILE = BACKLOG_DIR / "fronts.yaml"

STATUS_ORDER = [
    "backlog",
    "selected_for_development",
    "in_progress",
    "in_review",
    "blocked",
    "done",
    "canceled",
]
STATUS_LABELS = {
    "backlog": "Backlog",
    "selected_for_development": "Selected for development",
    "in_progress": "In progress",
    "in_review": "In review",
    "blocked": "Blocked",
    "done": "Done",
    "canceled": "Canceled",
}


def load_items() -> list[dict]:
    raw = yaml.safe_load(ITEMS_FILE.read_text(encoding="utf-8"))
    if not raw or "items" not in raw:
        return []
    return raw["items"]


def load_fronts_meta() -> list[dict]:
    """Slug + label for filter UI (from fronts.yaml)."""
    if not FRONTS_FILE.is_file():
        return []
    raw = yaml.safe_load(FRONTS_FILE.read_text(encoding="utf-8")) or {}
    out = []
    for row in raw.get("fronts") or []:
        if isinstance(row, dict) and row.get("slug"):
            out.append({"slug": row["slug"], "label": row.get("label") or row["slug"]})
    return out


PRIORITY_SLUGS = frozenset({"critical", "urgent", "medium", "backlog", "next_steps"})


def json_safe_items(items: list[dict]) -> list[dict]:
    """Deep-copy items for JSON: YAML date/datetime → ISO strings; default priority tier."""

    def norm(v):
        if isinstance(v, (datetime, date)):
            return v.isoformat()
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items()}
        if isinstance(v, list):
            return [norm(x) for x in v]
        return v

    out = []
    for i in items:
        d = norm(dict(i))
        p = d.get("priority")
        if p not in PRIORITY_SLUGS:
            d["priority"] = "urgent"
        out.append(d)
    return out


def fmt_item(item: dict) -> str:
    lines = [
        f"#### {item.get('title', '(no title)')}",
        "",
        f"- **id:** `{item.get('id', '')}`",
        f"- **front:** `{item.get('front', '')}`",
    ]
    pr = item.get("priority")
    if pr:
        lines.append(f"- **priority:** `{pr}`")
    desc = item.get("description")
    if desc:
        d = str(desc).strip()
        if "\n" in d:
            lines.append("- **description:**")
            for part in d.split("\n"):
                lines.append(f"  {part}")
        else:
            lines.append(f"- **description:** {d}")
    people = item.get("people") or []
    if people:
        lines.append(f"- **people:** {', '.join(str(p) for p in people)}")
    dod = item.get("definition_of_done")
    if dod:
        lines.append(f"- **definition of done:** {str(dod).strip()}")
    dates = item.get("dates") or {}
    if dates:
        parts = [f"{k}: {v}" for k, v in dates.items() if v]
        if parts:
            lines.append(f"- **dates:** {', '.join(parts)}")
    sources = item.get("sources") or []
    for s in sources:
        url = s.get("url") or ""
        ref = s.get("ref") or ""
        typ = s.get("type", "other")
        if url:
            lines.append(f"- **source ({typ}):** [{ref or url}]({url})")
        elif ref:
            lines.append(f"- **source ({typ}):** {ref}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    items = load_items()
    by_status: dict[str, list[dict]] = {s: [] for s in STATUS_ORDER}
    for item in items:
        st = item.get("status", "backlog")
        if st not in by_status:
            st = "backlog"
        by_status[st].append(item)

    out = [
        "# Backlog board",
        "",
        "Generated from [`items.yaml`](items.yaml). Hub: [`index.html`](index.html). Interactive board: [`board.html`](board.html) (same as `BOARD.html`) + `board-data.json`. Run:",
        "",
        "```bash",
        "python scripts/render_board.py",
        "```",
        "",
        "---",
        "",
    ]

    for st in STATUS_ORDER:
        label = STATUS_LABELS[st]
        out.append(f"## {label}")
        out.append("")
        bucket = by_status[st]
        if not bucket:
            out.append("_No items._")
            out.append("")
            continue
        for item in bucket:
            out.append(fmt_item(item))

    BOARD_FILE.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": json_safe_items(items),
        "fronts": load_fronts_meta(),
    }
    BOARD_DATA.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if not BOARD_SHELL.is_file():
        print(f"Missing shell template {BOARD_SHELL}", file=sys.stderr)
        sys.exit(1)
    shell_html = BOARD_SHELL.read_text(encoding="utf-8")
    BOARD_HTML.write_text(shell_html, encoding="utf-8")
    BOARD_PAGE.write_text(shell_html, encoding="utf-8")

    print(f"Wrote {BOARD_FILE}")
    print(f"Wrote {BOARD_DATA}")
    print(f"Wrote {BOARD_HTML}")
    print(f"Wrote {BOARD_PAGE}")


if __name__ == "__main__":
    main()
