# MCP smoke tests — personal backlog tool

**Last run:** 2026-04-13 (America/Sao_Paulo)  
**Purpose:** Verify connectivity for ingesting tasks from Google Workspace, Jira (Atlassian), Slack, Glean, and related servers.

## Summary

| Server | Result | Notes |
|--------|--------|--------|
| `user-google-workspace` | **PASS** | `time_getCurrentDate`, `drive_search`, `gmail_search`, `calendar_list`, `calendar_listEvents`, `docs_find` all returned data. |
| `user-atlassian` | **BLOCKED** | `mcp_auth` was skipped in session; complete OAuth in Cursor → MCP → Atlassian to expose Jira tools. |
| `user-slack` | **PARTIAL** | `channels_list` returned header-only CSV (no channel rows in this run); may be token scope or empty workspace slice — retry after confirming Slack app permissions. |
| `plugin-slack-slack` | **PASS** | `slack_search_public_and_private` returned messages with permalinks (e.g. `troy-cc-beta`). |
| `user-glean_default` | **PASS** | `search` with `app: jira` returned Jira documents with URLs and snippets (large JSON payload). |
| `user-asana` | **BLOCKED** | MCP server reports error in Cursor; fix in Cursor Settings before relying on it. |
| `user-google-workspace` Sheets tools | **READ-ONLY** | Only `sheets_get*` tools exist — not a write target for the board via MCP. |
| Google Keep / Notes | **N/A** | No Keep MCP. Use `drive_search` + Google Docs (including “Notes by Gemini” meeting docs via `docs_find` / `docs_getText`). |
| Gemini | **N/A** | No Gemini MCP in this Cursor project; Gemini content may appear as Google Docs (see `docs_find` results). |
| Cursor / Claude | **N/A** | Host environment; “test” = run an agent workflow that edits `backlog/items.yaml` and regenerates `BOARD.md`. |
| `user-nu-mcp` / ISA / Data | **OPTIONAL** | Not required for v1 backlog; load modules when linking data tickets. |

---

## Detailed checklist

### 1. user-google-workspace

| Tool | Arguments (minimal) | Result |
|------|---------------------|--------|
| `time_getCurrentDate` | `{}` | OK — UTC/local date + timezone |
| `drive_search` | `query`, `pageSize: 3` | OK — files returned |
| `gmail_search` | `query: "in:inbox"`, `maxResults: 1` | OK — message ids returned |
| `calendar_list` | `{}` | OK — calendar list including primary email |
| `calendar_listEvents` | `calendarId: <primary email>`, `timeMin` / `timeMax` | OK — events in range |
| `docs_find` | `query: "notes"`, `pageSize: 2` | OK — Docs including Gemini meeting notes |

### 2. user-atlassian (Jira)

| Tool | Arguments | Result |
|------|-----------|--------|
| `mcp_auth` | `{}` | **Skipped** — user must authenticate in Cursor to unlock Jira tools |

**Next step:** After auth, re-run with the smallest Jira read your org allows (e.g. issue search or `getIssue`).

### 3. user-slack

| Tool | Arguments | Result |
|------|-----------|--------|
| `channels_list` | `channel_types: "public_channel"`, `limit: 5` | **Partial** — CSV header only, no data rows in this run |

### 4. plugin-slack-slack

| Tool | Arguments | Result |
|------|-----------|--------|
| `slack_search_public_and_private` | `query: "troy-cc-beta"`, `limit: 2`, `include_context: false` | OK — threads with permalinks |

Prefer **one** Slack stack for routine search to avoid duplicate notifications if sending messages.

### 5. user-glean_default

| Tool | Arguments | Result |
|------|-----------|--------|
| `search` | `query: "troy-cc-beta"`, `app: "jira"` | OK — Jira hits with `url`, `title`, `snippets` |

For ingestion, follow with `read_document` on selected URLs when full text is needed.

### 6. user-asana

| Check | Result |
|-------|--------|
| Server status | Error — do not use for board v1 |

---

## Gaps and workarounds

1. **Jira:** Authenticate Atlassian MCP; use Glean `app: jira` until Jira tools are live.
2. **Asana:** Repair MCP or remove until stable.
3. **user-slack `channels_list`:** If still empty, rely on `plugin-slack-slack` search and known channel IDs.
4. **Editable board:** Canonical store is [`items.yaml`](items.yaml) in this repo; MCPs feed **sources** and discovery, not the sole write layer.
