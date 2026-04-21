"""Google Calendar + Gemini transcription adapter.

Reads two MCP-staged JSON files and returns board items, one per detected
action item assigned to the user (EN or PT).

- ``ingest/last_gcal_events.json`` — event + ``notes_doc_url`` per attended event.
- ``ingest/last_gemini_docs.json`` — pre-extracted ``action_items`` per doc.

JSON shapes documented in ``ingest/QUERY_PACKS.md`` (section 7).

If the agent couldn't pre-extract action items, this adapter also falls back to
parsing raw ``text`` under action-item headings present in the staged doc.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ACTION_HEADERS = (
    "action items",
    "next steps",
    "follow-ups",
    "follow ups",
    "todo",
    "próximos passos",
    "proximos passos",
    "ações",
    "acoes",
    "ação",
    "acao",
    "pendências",
    "pendencias",
    "follow-up",
    "a fazer",
)

NAME_HINTS = (
    "jacqueline",
    "jacque",
    "jacqueline ponce",
    "@jacqueline.ponce",
)


def _trim(text: str | None, n: int = 280) -> str:
    t = (text or "").strip().replace("\n", " ")
    return t if len(t) <= n else t[: n - 3] + "..."


def _is_for_me(text: str, assignee_hint: str | None) -> bool:
    low = (text or "").lower()
    if assignee_hint and any(h in assignee_hint.lower() for h in NAME_HINTS):
        return True
    return any(h in low for h in NAME_HINTS)


def _looks_like_header(line: str) -> str | None:
    stripped = line.strip().lower().rstrip(":").strip("#").strip()
    for h in ACTION_HEADERS:
        if stripped == h or stripped.startswith(h):
            return h
    return None


def _extract_from_raw_text(raw: str) -> list[dict]:
    """Best-effort fallback: bullets under an ACTION_HEADERS section that name the user."""
    if not raw:
        return []
    lines = raw.splitlines()
    out: list[dict] = []
    in_section = False
    for line in lines:
        header = _looks_like_header(line)
        if header:
            in_section = True
            continue
        if not in_section:
            continue
        if not line.strip():
            continue
        if line.startswith("#"):
            in_section = False
            continue
        bullet = re.match(r"\s*[-*\u2022\d+.)]+\s*(.+)", line)
        text = (bullet.group(1) if bullet else line).strip()
        if text and _is_for_me(text, None):
            out.append({"text": text, "assignee_hint": None, "language": None})
    return out


def _event_meta(events: list[dict]) -> dict[str, dict]:
    return {e.get("id"): e for e in events if e.get("id")}


def load_items(ingest_dir: Path) -> list[dict]:
    events_path = ingest_dir / "last_gcal_events.json"
    docs_path = ingest_dir / "last_gemini_docs.json"
    events: list[dict] = []
    docs: list[dict] = []
    if events_path.is_file():
        events = (json.loads(events_path.read_text(encoding="utf-8")) or {}).get("events") or []
    if docs_path.is_file():
        docs = (json.loads(docs_path.read_text(encoding="utf-8")) or {}).get("docs") or []

    meta = _event_meta(events)
    items: list[dict] = []
    for doc in docs:
        event_id = doc.get("event_id") or ""
        doc_url = doc.get("url") or ""
        doc_title = doc.get("title") or "Gemini notes"
        event = meta.get(event_id, {})
        summary = event.get("summary") or doc_title
        start = event.get("start") or ""

        action_items = list(doc.get("action_items") or [])
        if not action_items and doc.get("raw_text"):
            action_items = _extract_from_raw_text(doc["raw_text"])

        for idx, ai in enumerate(action_items):
            text = (ai.get("text") or "").strip()
            if not text:
                continue
            if not _is_for_me(text, ai.get("assignee_hint")):
                continue
            snippet = _trim(text)
            stable_idx = str(idx)
            if not event_id:
                h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
                stable_idx = h
            items.append(
                {
                    "id": f"gmeet-{event_id or 'nodoc'}-{stable_idx}",
                    "title": f"Meeting FUP: {_trim(summary, 60)} — {_trim(text, 80)}",
                    "front": "other",
                    "status": "backlog",
                    "priority": "next_steps",
                    "people": ["Jacqueline Ponce"],
                    "sources": [
                        {"type": "gdrive", "url": doc_url, "ref": f"Gemini notes · {doc_title}"},
                    ],
                    "description": f"[Gemini · {summary} · {start}]\n\n{snippet}",
                    **({"dates": {"due": start[:10]}} if start and len(start) >= 10 else {}),
                }
            )
    return items
