#!/usr/bin/env python3
"""Follow-up tracker CLI.

Usage:

    # add a new follow-up (follow up in 3 days from today)
    python scripts/add_followup.py add \\
        --title "Reply to Davi re: Staging issues" \\
        --url "https://nubank.slack.com/archives/..." \\
        --days 3 \\
        [--context "waiting on PR review"] \\
        [--source slack|jira|confluence|doc|other] \\
        [--people "Davi Melazo, Viotti"]

    # mark follow-up as done
    python scripts/add_followup.py done --id fu-20260422-001

    # push the follow-up out N more days (re-schedule)
    python scripts/add_followup.py push --id fu-20260422-001 --days 2

    # list pending follow-ups (terminal view)
    python scripts/add_followup.py list

Source of truth lives in ``follow_ups.yaml``. The render step is separate
(``scripts/render_followups.py``) so you can edit the YAML directly and
re-render without touching this CLI.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

try:
    import yaml
except ImportError:
    print("Install PyYAML: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

BACKLOG_DIR = Path(__file__).resolve().parent.parent
FOLLOWUPS_FILE = BACKLOG_DIR / "follow_ups.yaml"

VALID_SOURCES = {"slack", "jira", "confluence", "doc", "other"}


def load_yaml() -> dict:
    if not FOLLOWUPS_FILE.is_file():
        return {"version": 1, "items": []}
    data = yaml.safe_load(FOLLOWUPS_FILE.read_text(encoding="utf-8")) or {}
    data.setdefault("version", 1)
    data.setdefault("items", [])
    if data["items"] is None:
        data["items"] = []
    return data


def save_yaml(data: dict) -> None:
    header = (
        "# Follow-up tracker -- threads / asks you need to circle back on in a few days.\n"
        "# Managed by scripts/add_followup.py (see `make followup`).\n\n"
    )
    FOLLOWUPS_FILE.write_text(
        header + yaml.dump(data, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )


def infer_source_from_url(url: str) -> str:
    if not url:
        return "other"
    host = (urlparse(url).hostname or "").lower()
    if "slack.com" in host:
        return "slack"
    if "atlassian.net" in host:
        return "confluence" if "/wiki/" in url else "jira"
    if "docs.google.com" in host or "drive.google.com" in host:
        return "doc"
    return "other"


def next_id(items: list[dict], today: date) -> str:
    prefix = f"fu-{today.strftime('%Y%m%d')}-"
    used = [i.get("id", "") for i in items if i.get("id", "").startswith(prefix)]
    nums = []
    for u in used:
        tail = u.rsplit("-", 1)[-1]
        if tail.isdigit():
            nums.append(int(tail))
    n = (max(nums) + 1) if nums else 1
    return f"{prefix}{n:03d}"


def parse_people(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def cmd_add(args: argparse.Namespace) -> None:
    data = load_yaml()
    today = date.today()
    source = args.source or infer_source_from_url(args.url or "")
    if source not in VALID_SOURCES:
        print(f"Unknown --source '{source}'. Use one of: {sorted(VALID_SOURCES)}", file=sys.stderr)
        sys.exit(2)
    if args.days < 0:
        print("--days must be >= 0", file=sys.stderr)
        sys.exit(2)
    due = today + timedelta(days=args.days)
    item = {
        "id": next_id(data["items"], today),
        "title": args.title.strip(),
        "url": (args.url or "").strip(),
        "context": (args.context or "").strip(),
        "source": source,
        "created_at": today.isoformat(),
        "follow_up_on": due.isoformat(),
        "status": "pending",
        "people": parse_people(args.people),
    }
    data["items"].append(item)
    save_yaml(data)
    print(f"Added {item['id']} -- due {due.isoformat()} ({_humanize_days(args.days)})")


def cmd_done(args: argparse.Namespace) -> None:
    data = load_yaml()
    for item in data["items"]:
        if item.get("id") == args.id:
            item["status"] = "done"
            item["done_at"] = date.today().isoformat()
            save_yaml(data)
            print(f"Marked {args.id} as done")
            return
    print(f"No follow-up with id {args.id!r}", file=sys.stderr)
    sys.exit(1)


def cmd_push(args: argparse.Namespace) -> None:
    data = load_yaml()
    for item in data["items"]:
        if item.get("id") == args.id:
            try:
                base = date.fromisoformat(item.get("follow_up_on", date.today().isoformat()))
            except ValueError:
                base = date.today()
            if base < date.today():
                base = date.today()
            new_due = base + timedelta(days=args.days)
            item["follow_up_on"] = new_due.isoformat()
            item["status"] = "pending"
            item.pop("done_at", None)
            save_yaml(data)
            print(f"{args.id} pushed -> {new_due.isoformat()}")
            return
    print(f"No follow-up with id {args.id!r}", file=sys.stderr)
    sys.exit(1)


def cmd_list(_args: argparse.Namespace) -> None:
    data = load_yaml()
    today = date.today()
    pending = [i for i in data["items"] if i.get("status") != "done"]
    pending.sort(key=lambda i: i.get("follow_up_on") or "9999-12-31")
    if not pending:
        print("(no pending follow-ups)")
        return
    for i in pending:
        due_str = i.get("follow_up_on") or "-"
        try:
            delta = (date.fromisoformat(due_str) - today).days
            rel = _humanize_days(delta)
        except ValueError:
            rel = ""
        line = f"  {i['id']}  {due_str}  [{i.get('source','other')}]  {i.get('title','').strip()}"
        if rel:
            line += f"   ({rel})"
        print(line)


def _humanize_days(delta: int) -> str:
    if delta == 0:
        return "today"
    if delta == 1:
        return "in 1 day"
    if delta < 0:
        return f"{-delta}d overdue"
    return f"in {delta} days"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="Add a new follow-up item")
    a.add_argument("--title", required=True)
    a.add_argument("--url", default="")
    a.add_argument("--days", type=int, default=2, help="Days from today until follow-up (default: 2)")
    a.add_argument("--context", default="")
    a.add_argument("--source", default=None, choices=sorted(VALID_SOURCES))
    a.add_argument("--people", default="", help="Comma-separated names")
    a.set_defaults(func=cmd_add)

    d = sub.add_parser("done", help="Mark a follow-up as done")
    d.add_argument("--id", required=True)
    d.set_defaults(func=cmd_done)

    u = sub.add_parser("push", help="Push follow-up out by N days (re-open if done)")
    u.add_argument("--id", required=True)
    u.add_argument("--days", type=int, default=1)
    u.set_defaults(func=cmd_push)

    l = sub.add_parser("list", help="Print pending follow-ups sorted by due date")
    l.set_defaults(func=cmd_list)

    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
