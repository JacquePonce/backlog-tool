# Pulling tasks from Slack, Gemini notes, Drive, and more

The **browser board** only reads `board-data.json` (built from `items.yaml`). It **never** pushes changes to Jira or anywhere else.

To see Gemini meeting notes, Slack threads, and other sources **on the board**, add rows to the backlog through one of these paths:

## 1. `local_items.yaml` (manual / copy-paste)

Add a card with `sources` pointing at Slack permalinks, Google Doc URLs, etc. Then run:

```bash
# If you only changed local_items.yaml and want to merge with last Jira export:
.venv/bin/python scripts/refresh_from_jira.py
```

Or append directly to `items.yaml` if you are not using the Jira refresh script for that edit.

## 2. Google Docs that act like “Gemini notes”

Gemini often saves notes as **Google Docs** (e.g. titles containing “Notes by Gemini”). With MCP:

- `docs_find` with query `Gemini` or meeting title  
- `drive_search` with full-text or name filters  

Copy the doc link into `sources`:

```yaml
sources:
  - type: gdrive
    url: https://docs.google.com/document/d/...
    ref: Meeting notes 2026-04-09
```

Set `title` / `description` / `front` / `status` as needed, then `render_board.py`.

## 3. Slack

Use **Slack MCP** search (`slack_search_public_and_private`) for your name or topics. For each thread you care about, add an item with:

```yaml
sources:
  - type: slack
    url: https://nubank.slack.com/archives/CHANNEL/p...
    ref: "#channel — thread summary"
```

See also [`QUERY_PACKS.md`](QUERY_PACKS.md).

## 4. Glean

`search` + `read_document` for discovery; add distilled tasks to `local_items.yaml` with Confluence/Jira/Slack URLs in `sources`.

## 5. Jira (bulk)

`scripts/refresh_from_jira.py` merges `ingest/last_jira_currentUser.json` (from Atlassian MCP) with `local_items.yaml` → `items.yaml`.

---

**Summary:** Ingest = **read** from tools → **append** to YAML/JSON data → **regenerate** `board-data.json`. The **web UI** then lets you drag cards and edit text **only in the browser** (localStorage), without touching Jira.
