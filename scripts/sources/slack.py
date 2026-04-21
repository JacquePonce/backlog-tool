"""Slack adapter.

Reads three MCP-staged JSON files and returns board items:

- ``ingest/last_slack_mentions.json`` — ``@mention`` hits inside channels whose
  name matches the token-boundary rule ``{troy, us, da, ccf}``.
- ``ingest/last_slack_dms.json`` — unread DM / MPIM threads involving the user.
- ``ingest/last_slack_saved.json`` — messages the user flagged via Slack's
  "Save for later" / bookmark feature (Slack search ``is:saved``). These are
  not filtered by the token-boundary rule because the user explicitly opted
  them in.

JSON shapes documented in ``ingest/QUERY_PACKS.md`` (section 2a).
"""

from __future__ import annotations

import json
from pathlib import Path

CHANNEL_TOKEN_ALLOWLIST: frozenset[str] = frozenset({"troy", "us", "da", "ccf"})


def channel_matches_token_rule(channel_name: str) -> bool:
    """True iff any hyphen-separated token of ``channel_name`` is in the allowlist."""
    tokens = {t for t in (channel_name or "").lower().split("-") if t}
    return bool(tokens & CHANNEL_TOKEN_ALLOWLIST)


def _trim(text: str | None, n: int = 280) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t if len(t) <= n else t[: n - 3] + "..."


def _mention_item(msg: dict) -> dict | None:
    channel_id = msg.get("channel_id") or ""
    channel_name = msg.get("channel_name") or ""
    ts = msg.get("ts") or ""
    if not (channel_id and ts):
        return None
    if channel_name and not channel_matches_token_rule(channel_name):
        return None
    snippet = _trim(msg.get("text_snippet") or msg.get("text"))
    permalink = msg.get("permalink") or ""
    author = msg.get("user_name") or msg.get("user") or "unknown"
    first_line = (msg.get("text") or "").splitlines()[0] if msg.get("text") else ""
    title_suffix = _trim(first_line, 80) or snippet or "Slack mention"
    return {
        "id": f"slack-{channel_id}-{ts}",
        "title": f"Slack #{channel_name}: {title_suffix}",
        "front": "other",
        "status": "backlog",
        "priority": "urgent",
        "people": [author] if author and author != "unknown" else [],
        "sources": [
            {"type": "slack", "url": permalink, "ref": f"#{channel_name} {ts}"},
        ],
        "description": f"[Slack · #{channel_name} · {author}]\n\n{snippet}",
    }


def _saved_item(msg: dict) -> dict | None:
    channel_id = msg.get("channel_id") or ""
    channel_name = msg.get("channel_name") or ""
    ts = msg.get("ts") or ""
    if not (channel_id and ts):
        return None
    snippet = _trim(msg.get("text_snippet") or msg.get("text"))
    permalink = msg.get("permalink") or ""
    author = msg.get("user_name") or msg.get("user") or "unknown"
    first_line = (msg.get("text") or "").splitlines()[0] if msg.get("text") else ""
    title_suffix = _trim(first_line, 80) or snippet or "Saved message"
    return {
        "id": f"slack-saved-{channel_id}-{ts}",
        "title": f"Slack saved #{channel_name}: {title_suffix}",
        "front": "other",
        "status": "backlog",
        "priority": "medium",
        "people": [author] if author and author != "unknown" else [],
        "sources": [
            {"type": "slack", "url": permalink, "ref": f"saved #{channel_name} {ts}"},
        ],
        "description": f"[Slack saved · #{channel_name} · {author}]\n\n{snippet}",
    }


def _dm_item(thread: dict) -> dict | None:
    channel_id = thread.get("channel_id") or ""
    thread_ts = thread.get("thread_ts") or thread.get("latest_ts") or ""
    if not (channel_id and thread_ts):
        return None
    if thread.get("last_author_is_me"):
        return None
    preview = _trim(thread.get("preview"))
    permalink = thread.get("permalink") or ""
    last_author = thread.get("last_author") or "unknown"
    participants = thread.get("participants") or []
    ctype = thread.get("channel_type") or "im"
    who = last_author if ctype == "im" else ", ".join(participants) or "group DM"
    title = f"Slack DM ({who}): {_trim(preview, 80) or 'unread thread'}"
    return {
        "id": f"slack-dm-{channel_id}-{thread_ts}",
        "title": title,
        "front": "other",
        "status": "backlog",
        "priority": "urgent",
        "people": [p for p in [last_author, *participants] if p and p != "unknown"],
        "sources": [
            {"type": "slack", "url": permalink, "ref": f"DM {thread_ts}"},
        ],
        "description": f"[Slack · {ctype} · {last_author}]\n\n{preview}",
    }


def load_items(ingest_dir: Path) -> list[dict]:
    items: list[dict] = []
    mentions_path = ingest_dir / "last_slack_mentions.json"
    if mentions_path.is_file():
        raw = json.loads(mentions_path.read_text(encoding="utf-8"))
        for msg in raw.get("messages") or []:
            item = _mention_item(msg)
            if item is not None:
                items.append(item)
    dms_path = ingest_dir / "last_slack_dms.json"
    if dms_path.is_file():
        raw = json.loads(dms_path.read_text(encoding="utf-8"))
        for thread in raw.get("threads") or []:
            item = _dm_item(thread)
            if item is not None:
                items.append(item)
    saved_path = ingest_dir / "last_slack_saved.json"
    if saved_path.is_file():
        raw = json.loads(saved_path.read_text(encoding="utf-8"))
        for msg in raw.get("messages") or []:
            item = _saved_item(msg)
            if item is not None:
                items.append(item)
    return items
