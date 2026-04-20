# Ingest query packs

Use these strings when searching Jira (JQL/Glean), Slack, Gmail, Drive, or Glean.  
**Identity** (always include one variant per sweep):

- `Jacqueline Ponce`
- `Jacque Ponce`
- `jacqueline.ponce@nubank.com.br` (Gmail `from:` / `to:`, Calendar attendee, Jira user picker)

---

## 1. Glean `search` (short keywords)

| Pack | Query | Optional filter |
|------|--------|-----------------|
| Identity | `Jacqueline Ponce` | — |
| Beta + you | `Ponce troy-cc-beta` | `app: jira` or `app: slack` |
| Sponsor bank | `sponsor-bank` | `app: jira` |
| DA blockers | `blocked-da` | `app: jira` |
| Fraud | `fraud DA` | `app: jira` |
| Data | `dashboard CC US` | `app: gdrive` or `app: confluence` |

After search, call `read_document` on top URLs when snippets are not enough.

---

## 2. Slack (`slack_search_public_and_private`)

Use modifiers; keep queries small.

| Pack | Example query |
|------|----------------|
| Mention you | `Jacqueline Ponce` or `Jacque Ponce` |
| Beta program | `troy-cc-beta` |
| Sponsor | `"sponsor bank"` |
| Fraud track | `fraud in:#us-credit-strategy` (adjust channel) |
| Files | `content_types=files` + `type:documents` + keyword |

Store **permalink** from each hit in `items[].sources[]`.

---

## 3. Jira (when Atlassian MCP authenticated)

Suggested JQL patterns (adapt to your account ID):

```text
assignee = currentUser() ORDER BY updated DESC
```

```text
text ~ "Jacqueline Ponce" OR text ~ "Jacque Ponce" ORDER BY updated DESC
```

```text
labels in (troy-cc-beta, sponsor-bank, blocked-da, DA-task-force) ORDER BY updated DESC
```

Map Jira status → local `status`:

| Jira category | items.yaml `status` |
|---------------|---------------------|
| To Do, Backlog, Selected for Development, Discovery | `backlog` |
| In Progress, In Review | `in_progress` |
| Blocked | `blocked` |
| Done, Closed, Cancelled (if truly complete) | `done` |

---

## 4. Google Drive (`drive_search`)

| Pack | Example query |
|------|----------------|
| Notes / Gemini | `fullText contains 'troy' and mimeType = 'application/vnd.google-apps.document'` |
| Title | `name contains 'Troy'` |
| Shared | `sharedWithMe = true` + keyword |

---

## 5. Gmail (`gmail_search`)

| Pack | Example query |
|------|----------------|
| To you | `to:jacqueline.ponce@nubank.com.br newer_than:14d` |
| Beta | `troy-cc-beta newer_than:30d` |

---

## 6. Calendar (`calendar_listEvents`)

Use primary calendar id from `calendar_list`. Filter events where summary/description contains your topics or you are attendee — often easier to review in UI and add rows manually to `items.yaml`.

---

## Per-front keyword map

See [`../fronts.yaml`](../fronts.yaml) `ingest_keywords` on each front. When an external hit matches keywords for a front, set `items[].front` to that slug (or `other` if ambiguous).
