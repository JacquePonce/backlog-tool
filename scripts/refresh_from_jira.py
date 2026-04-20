#!/usr/bin/env python3
"""Merge local_items.yaml with ingest/last_jira_currentUser.json → items.yaml, then render BOARD.md."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

BACKLOG_DIR = Path(__file__).resolve().parent.parent
LOCAL_FILE = BACKLOG_DIR / "local_items.yaml"
JIRA_EXPORT = BACKLOG_DIR / "ingest" / "last_jira_currentUser.json"
ITEMS_FILE = BACKLOG_DIR / "items.yaml"
RENDER_SCRIPT = BACKLOG_DIR / "scripts" / "render_board.py"

JIRA_BASE = "https://nubank.atlassian.net/browse"


def map_jira_status(name: str, category_key: str) -> str:
    n = (name or "").strip().lower()
    if n == "blocked":
        return "blocked"
    if n in ("canceled", "cancelled"):
        return "canceled"
    if n in ("done", "closed", "complete", "resolved"):
        return "done"
    if n in ("in review", "review"):
        return "in_review"
    if n in ("selected for development", "select for development"):
        return "selected_for_development"
    if n == "in progress":
        return "in_progress"
    if category_key == "done":
        return "done"
    if category_key == "indeterminate":
        return "in_progress"
    return "backlog"


def map_jira_priority_field(priority_obj: dict | None) -> str:
    """Map Jira priority name to board priority tier. Default when unknown: urgent (override in UI)."""
    name = ((priority_obj or {}).get("name") or "").strip().lower()
    if not name:
        return "urgent"
    if any(x in name for x in ("highest", "blocker", "critical", "severe")):
        return "critical"
    if "high" in name or name == "p1":
        return "urgent"
    if "next" in name or "soon" in name:
        return "next_steps"
    if name == "medium" or name.startswith("medium "):
        return "medium"
    if any(x in name for x in ("lowest", "low", "trivial")):
        return "backlog"
    return "urgent"


def infer_front(labels: list[str]) -> str:
    L = {x.lower() for x in (labels or [])}
    if any("fraud" in x for x in L):
        return "fraud"
    if L & {"troy-cc-beta-tester", "troy-cc-staging-tests", "beta-testing"}:
        return "beta_testing"
    if L & {"troy-cc-beta", "troy-cc-alpha"}:
        return "release_beta"
    if L & {"sponsor-bank", "blocked-da", "destination-architecture", "da-task-force"}:
        return "sponsor_lead_bank"
    return "other"


def trim_desc(text: str | None, max_len: int = 480) -> str | None:
    if not text:
        return None
    t = str(text).strip()
    if not t:
        return None
    t = re.sub(r"\s+", " ", t)
    if len(t) > max_len:
        return t[: max_len - 3] + "..."
    return t


def jira_issue_to_item(issue: dict) -> dict:
    key = issue["key"]
    fields = issue["fields"]
    summary = fields.get("summary") or key
    status = fields.get("status") or {}
    st_name = status.get("name") or ""
    cat_key = (status.get("statusCategory") or {}).get("key") or ""
    labels = fields.get("labels") or []
    assignee = fields.get("assignee") or {}
    people = []
    if assignee.get("displayName"):
        people.append(assignee["displayName"])
    due = fields.get("duedate")
    desc = trim_desc(fields.get("description"))
    priority_tier = map_jira_priority_field(fields.get("priority"))

    item: dict = {
        "id": f"jira-{key}",
        "title": f"[{key}] {summary}",
        "front": infer_front(labels),
        "status": map_jira_status(st_name, cat_key),
        "priority": priority_tier,
        "people": people,
        "sources": [
            {
                "type": "jira",
                "url": f"{JIRA_BASE}/{key}",
                "ref": key,
            }
        ],
    }
    meta_bits = [f"Jira · {st_name}"]
    if labels:
        meta_bits.append("labels: " + ", ".join(labels))
    meta_line = "[" + " · ".join(meta_bits) + "]"
    if desc:
        item["description"] = f"{meta_line}\n\n{desc}"
    else:
        item["description"] = meta_line
    if due:
        item["dates"] = {"due": due}
    return item


def jira_issue_included_in_backlog(issue: dict) -> bool:
    """Skip done issues on the generic *other* front — keeps the board focused on themed work."""
    fields = issue.get("fields") or {}
    labels = fields.get("labels") or []
    front = infer_front(labels)
    status = fields.get("status") or {}
    st_name = status.get("name") or ""
    cat_key = (status.get("statusCategory") or {}).get("key") or ""
    mapped = map_jira_status(st_name, cat_key)
    if front == "other" and mapped == "done":
        return False
    return True


def local_item_included_in_backlog(item: dict) -> bool:
    if item.get("front") == "other" and item.get("status") == "done":
        return False
    return True


def main() -> None:
    if not JIRA_EXPORT.is_file():
        print(f"Missing {JIRA_EXPORT}", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(JIRA_EXPORT.read_text(encoding="utf-8"))
    issues = raw.get("issues") or []
    jira_kept = [i for i in issues if jira_issue_included_in_backlog(i)]
    jira_items = [jira_issue_to_item(i) for i in jira_kept]
    jira_skipped = len(issues) - len(jira_kept)

    local_items: list = []
    if LOCAL_FILE.is_file():
        loc = yaml.safe_load(LOCAL_FILE.read_text(encoding="utf-8")) or {}
        local_items = loc.get("items") or []
    local_before = len(local_items)
    local_items = [x for x in local_items if local_item_included_in_backlog(x)]
    local_skipped = local_before - len(local_items)

    out = {
        "version": 1,
        "items": local_items + jira_items,
    }

    header = """# Personal / program backlog — system of record for Kanban + fronts.
# Jira rows are regenerated by scripts/refresh_from_jira.py (ids: jira-KEY).
# Local-only rows live in local_items.yaml.
# Regenerate BOARD.md: .venv/bin/python scripts/render_board.py

"""

    ITEMS_FILE.write_text(
        header + yaml.dump(out, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )
    skip_note = []
    if jira_skipped:
        skip_note.append(f"{jira_skipped} Jira skipped (other+done)")
    if local_skipped:
        skip_note.append(f"{local_skipped} local skipped (other+done)")
    extra = ("; " + ", ".join(skip_note)) if skip_note else ""
    print(f"Wrote {len(local_items)} local + {len(jira_items)} Jira → {ITEMS_FILE}{extra}")

    subprocess.run([sys.executable, str(RENDER_SCRIPT)], check=True)


if __name__ == "__main__":
    main()
