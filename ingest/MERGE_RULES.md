# Merge rules — ingest → `items.yaml`

Goals: add new work from MCPs **without** deleting or overwriting careful local edits.

## 1. Never delete on sync

- Rows that exist only in `items.yaml` (no matching external id) **must remain**.
- Ingest may **append** new items or **update** items that are explicitly linked.

## 2. Matching keys (in priority order)

1. **`sources[].ref`** equals Jira key (`MRC-1234`), Slack `thread_ts` + channel, or stable doc id.
2. **`sources[].url`** exact match (normalize trailing slashes).
3. **Fuzzy title**: same normalized title (lowercase, collapse spaces) AND same `front` — treat as duplicate candidate, not auto-merge.

## 3. On duplicate candidate

- If two items match by rule (2) or (3): **do not merge automatically**; keep one row and add a second `sources` entry to the survivor, or leave a `description` note linking the duplicate.

## 4. Updates allowed from external sources

When a match is found by rule (1) or (2):

| Field | Policy |
|-------|--------|
| `status` | Update **only if** user asked for “sync status from Jira” or equivalent; otherwise leave local status. |
| `title` | Prefer Jira/Slack title on **first** import only; later, do not overwrite if local title was edited (no trivial diff). |
| `description` | Append a dated “Ingest note: …” block rather than replacing. |
| `people` | Union lists (dedupe by email or name). |
| `dates.due` | Set from Jira due date **only when** field was empty locally. |
| `sources` | Always allow adding a new `sources` entry. |

## 5. New items from ingest

- Generate `id` as `ingest-{type}-{short-hash}` or `jira-MRC-1234` if unique.
- Set `front` from keyword match to [`fronts.yaml`](../fronts.yaml); if unclear, `other`.
- Default `status`: `backlog` unless source explicitly blocked/done.

## 6. Privacy

- Do not paste full message bodies into `items.yaml` if they contain secrets; use summary + Slack/Jira link in `sources`.
