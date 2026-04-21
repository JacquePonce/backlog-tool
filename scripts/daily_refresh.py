#!/usr/bin/env python3
"""Daily multi-source backlog refresh.

Pipeline:

1. Load board items from 5 sources (each source reads pre-staged JSON from ``ingest/``):
   - ``sources.jira``          -> ``ingest/last_jira_currentUser.json``
   - ``sources.slack``         -> ``ingest/last_slack_mentions.json`` + ``last_slack_dms.json``
   - ``sources.gcal_gemini``   -> ``ingest/last_gcal_events.json`` + ``last_gemini_docs.json``
   - ``sources.confluence``    -> ``ingest/last_confluence_comments.json``
2. Merge with ``local_items.yaml`` (user-maintained rows).
3. Apply ``local_overrides.yaml`` (status / note / snooze per stable id).
4. Write ``items.yaml`` and run ``scripts/render_board.py``.
5. Bump ``ingest/sync_state.yaml`` with the current UTC timestamp.

MCP calls live in the agent runbook ``ingest/DAILY_REFRESH.md`` -- this script does
NOT talk to Jira / Slack / Google / Confluence. Run after the agent has written
the ``ingest/last_*.json`` files (or ``make daily`` after ``daily backlog refresh``).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

BACKLOG_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent

sys.path.insert(0, str(SCRIPTS_DIR))
from sources import confluence as confluence_source  # noqa: E402
from sources import gcal_gemini as gcal_source  # noqa: E402
from sources import jira as jira_source  # noqa: E402
from sources import slack as slack_source  # noqa: E402

INGEST_DIR = BACKLOG_DIR / "ingest"
LOCAL_FILE = BACKLOG_DIR / "local_items.yaml"
OVERRIDES_FILE = BACKLOG_DIR / "local_overrides.yaml"
STATE_FILE = INGEST_DIR / "sync_state.yaml"
ITEMS_FILE = BACKLOG_DIR / "items.yaml"
RENDER_SCRIPT = SCRIPTS_DIR / "render_board.py"

OVERRIDE_ALLOWED_FIELDS = {"status", "snooze_until", "note", "front", "priority"}


def _load_yaml(path: Path) -> dict:
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _local_item_included(item: dict) -> bool:
    return not (item.get("front") == "other" and item.get("status") == "done")


def apply_overrides(items: list[dict], overrides: dict[str, dict]) -> int:
    if not overrides:
        return 0
    touched = 0
    today = date.today()
    for item in items:
        ov = overrides.get(item.get("id")) or {}
        if not ov:
            continue
        if ov.get("status") == "snoozed":
            snooze = ov.get("snooze_until")
            if snooze:
                try:
                    snooze_dt = snooze if isinstance(snooze, date) else date.fromisoformat(str(snooze))
                except ValueError:
                    snooze_dt = None
                if snooze_dt and today >= snooze_dt:
                    continue
            item["status"] = "backlog"
            if ov.get("note"):
                item["description"] = f"{item.get('description','')}\n\n[override] {ov['note']}".strip()
            touched += 1
            continue
        for field in OVERRIDE_ALLOWED_FIELDS:
            if field in ov and field not in ("snooze_until",):
                if field == "note":
                    item["description"] = f"{item.get('description','')}\n\n[override] {ov['note']}".strip()
                else:
                    item[field] = ov[field]
        touched += 1
    return touched


def dedupe_keep_first(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        k = item.get("id")
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(item)
    return out


def collect_source_items(source_modules: list[str]) -> tuple[list[dict], dict[str, int]]:
    counts: dict[str, int] = {}
    all_items: list[dict] = []
    if "jira" in source_modules:
        jira_items, jira_skipped = jira_source.load_items(INGEST_DIR)
        all_items.extend(jira_items)
        counts["jira"] = len(jira_items)
        if jira_skipped:
            counts["jira_skipped"] = jira_skipped
    if "slack" in source_modules:
        slack_items = slack_source.load_items(INGEST_DIR)
        all_items.extend(slack_items)
        counts["slack"] = len(slack_items)
    if "gcal_gemini" in source_modules:
        gcal_items = gcal_source.load_items(INGEST_DIR)
        all_items.extend(gcal_items)
        counts["gcal_gemini"] = len(gcal_items)
    if "confluence" in source_modules:
        cfl_items = confluence_source.load_items(INGEST_DIR)
        all_items.extend(cfl_items)
        counts["confluence"] = len(cfl_items)
    return all_items, counts


def load_local_items() -> tuple[list[dict], int]:
    local_items: list[dict] = []
    if LOCAL_FILE.is_file():
        loc = yaml.safe_load(LOCAL_FILE.read_text(encoding="utf-8")) or {}
        local_items = loc.get("items") or []
    before = len(local_items)
    local_items = [x for x in local_items if _local_item_included(x)]
    return local_items, before - len(local_items)


def write_items(items: list[dict]) -> None:
    header = """# Personal / program backlog -- system of record for Kanban + fronts.
# Regenerated by scripts/daily_refresh.py (multi-source) or scripts/refresh_from_jira.py (Jira only).
# Local-only rows live in local_items.yaml. User overrides live in local_overrides.yaml.

"""
    out = {"version": 1, "items": items}
    ITEMS_FILE.write_text(
        header + yaml.dump(out, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )


def bump_sync_state(source_modules: list[str]) -> None:
    state = _load_yaml(STATE_FILE)
    state.setdefault("version", 1)
    sources = state.setdefault("sources", {})
    now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    source_to_keys = {
        "jira": ["jira"],
        "slack": ["slack_mentions", "slack_dms"],
        "gcal_gemini": ["gcal_gemini"],
        "confluence": ["confluence"],
    }
    for mod in source_modules:
        for key in source_to_keys.get(mod, []):
            sources.setdefault(key, {})["last_run"] = now_iso
    STATE_FILE.write_text(
        yaml.dump(state, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--only",
        default="jira,slack,gcal_gemini,confluence",
        help="Comma-separated source modules to include (default: all).",
    )
    p.add_argument(
        "--no-render",
        action="store_true",
        help="Skip running scripts/render_board.py at the end.",
    )
    p.add_argument(
        "--no-bump-state",
        action="store_true",
        help="Do not update ingest/sync_state.yaml (useful for dry runs).",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    modules = [m.strip() for m in args.only.split(",") if m.strip()]

    source_items, counts = collect_source_items(modules)
    local_items, local_skipped = load_local_items()

    all_items = local_items + source_items
    before_dedupe = len(all_items)
    all_items = dedupe_keep_first(all_items)
    dedupe_drops = before_dedupe - len(all_items)

    overrides = (_load_yaml(OVERRIDES_FILE) or {}).get("overrides") or {}
    override_touched = apply_overrides(all_items, overrides)

    write_items(all_items)

    summary_parts = [f"{len(local_items)} local"]
    for key in ("jira", "slack", "gcal_gemini", "confluence"):
        if key in counts:
            summary_parts.append(f"{counts[key]} {key}")
    extras = []
    if counts.get("jira_skipped"):
        extras.append(f"{counts['jira_skipped']} Jira skipped (other+done)")
    if local_skipped:
        extras.append(f"{local_skipped} local skipped (other+done)")
    if dedupe_drops:
        extras.append(f"{dedupe_drops} duplicate ids dropped")
    if override_touched:
        extras.append(f"{override_touched} overrides applied")
    extra = ("; " + ", ".join(extras)) if extras else ""
    print(f"Wrote {' + '.join(summary_parts)} -> {ITEMS_FILE}{extra}")

    if not args.no_render:
        subprocess.run([sys.executable, str(RENDER_SCRIPT)], check=True)

    if not args.no_bump_state:
        bump_sync_state(modules)


if __name__ == "__main__":
    main()
