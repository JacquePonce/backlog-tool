"""Jira adapter.

Reads ``ingest/last_jira_currentUser.json`` (``searchJiraIssuesUsingJql`` shape) and
returns board items. JQL is documented in ``ingest/QUERY_PACKS.md`` (section 3).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

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
    """Map Jira priority name to board priority tier. Default when unknown: urgent."""
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
            {"type": "jira", "url": f"{JIRA_BASE}/{key}", "ref": key},
        ],
    }
    meta_bits = [f"Jira · {st_name}"]
    if labels:
        meta_bits.append("labels: " + ", ".join(labels))
    meta_line = "[" + " · ".join(meta_bits) + "]"
    item["description"] = f"{meta_line}\n\n{desc}" if desc else meta_line
    if due:
        item["dates"] = {"due": due}
    return item


def jira_issue_included_in_backlog(issue: dict) -> bool:
    """Skip done issues on the generic ``other`` front — keeps the board focused on themed work."""
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


def load_items(ingest_dir: Path) -> tuple[list[dict], int]:
    """Return ``(items, skipped_other_done)`` from ``last_jira_currentUser.json``.

    Missing file returns ``([], 0)`` so the daily driver can tolerate partial runs.
    """
    path = ingest_dir / "last_jira_currentUser.json"
    if not path.is_file():
        return [], 0
    raw = json.loads(path.read_text(encoding="utf-8"))
    issues = raw.get("issues") or []
    kept = [i for i in issues if jira_issue_included_in_backlog(i)]
    skipped = len(issues) - len(kept)
    return [jira_issue_to_item(i) for i in kept], skipped
