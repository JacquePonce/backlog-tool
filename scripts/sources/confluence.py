"""Confluence adapter.

Reads ``ingest/last_confluence_comments.json`` (shape in ``QUERY_PACKS.md`` §8) and
returns one board item per comment that still needs a reply from the user.

Inclusion rule:
  - ``mentions_me`` is true, OR
  - ``page_author_is_me`` is true AND ``has_my_reply_after`` is false.

Comments authored by the user are skipped.
"""

from __future__ import annotations

import json
from pathlib import Path


def _trim(text: str | None, n: int = 320) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t if len(t) <= n else t[: n - 3] + "..."


def _needs_reply(c: dict) -> bool:
    if c.get("comment_author_is_me"):
        return False
    if c.get("mentions_me"):
        return True
    if c.get("page_author_is_me") and not c.get("has_my_reply_after"):
        return True
    return False


def _comment_item(c: dict) -> dict | None:
    page_id = c.get("page_id") or ""
    comment_id = c.get("comment_id") or ""
    if not (page_id and comment_id):
        return None
    if not _needs_reply(c):
        return None
    page_title = c.get("page_title") or "Confluence page"
    page_url = c.get("page_url") or ""
    comment_url = c.get("url") or page_url
    author = c.get("comment_author") or "unknown"
    text = _trim(c.get("text"))
    return {
        "id": f"cfl-{page_id}-{comment_id}",
        "title": f"Confluence reply: {_trim(page_title, 60)} — {author}",
        "front": "other",
        "status": "backlog",
        "priority": "urgent",
        "people": [author] if author and author != "unknown" else [],
        "sources": [
            {"type": "confluence", "url": comment_url, "ref": f"{page_title} (comment {comment_id})"},
        ],
        "description": f"[Confluence · {page_title} · {author}]\n\n{text}",
    }


def load_items(ingest_dir: Path) -> list[dict]:
    path = ingest_dir / "last_confluence_comments.json"
    if not path.is_file():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    items: list[dict] = []
    for c in raw.get("comments") or []:
        item = _comment_item(c)
        if item is not None:
            items.append(item)
    return items
