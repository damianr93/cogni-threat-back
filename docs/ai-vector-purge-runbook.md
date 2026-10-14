# Runbook: purge the AI vector index

Use this once, after moving to the reduced embedding scope, to reclaim the disk
taken by vectors that the chat tools no longer need (all CVEs, ransomware
victims, Telegram messages). The purge empties `ai_context_vectors` and resets
the sync watermarks; the next ingestion re-embeds only what is still in scope.

Background: [ai-chat-tools.md](./ai-chat-tools.md).

## Quick path

1. Keep the reduced flags (defaults): `RAG_CVE_EMBED_MODE=kev`,
   `RAG_RANSOMWARE_VICTIM_EMBED_MODE=none`, `RAG_TELEGRAM_EMBED_MODE=none`.
2. `GET /ai/admin/vectors/purge/report` and confirm `wouldRefuse` is `null`.
3. `POST /ai/admin/vectors/purge` with `{"confirm": true}`.
4. Wait for the next ingestion (or `POST /ai/admin/sync`) and check
   `GET /ai/admin/sync/status`.

All endpoints require an ADMIN token. Examples use `$TOKEN` and
`http://localhost:3000`; adjust for your deployment.

## Irreversible

The purge `TRUNCATE`s the table. There is no undo. The only way back is to
re-embed (see [Rollback](#rollback--re-embed-more-sources)), which costs Ollama
time. This is a personal project, so no backup is required; take a
`pg_dump -t ai_context_vectors` first if you want one.

## 1. Measure

The report is read-only (it changes nothing, including the pause state).

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/ai/admin/vectors/purge/report
```

`data` contains:

| Field | Meaning |
|-------|---------|
| `sizes` | `totalBytes`, `tableBytes`, `toastBytes`, `indexBytes`, `avgEmbeddingBytes` of `ai_context_vectors` |
| `categories` | `[{ category, chunks, sources }]` per category (`ransomware`, `vuln-monitor`, `actors`, `telegram`) |
| `scope` | Effective `{ cve, victims, telegram }` after validating the env flags |
| `scopeReduced` | `true` when CVE is not `all` and victims and Telegram are `none` |
| `wouldRefuse` | `null` if a purge would run; `"scope_not_reduced"` if it would be refused |

Measure by category and relation size directly in SQL:

```sql
-- Chunks, distinct sources and embedding payload per category
SELECT category,
       COUNT(*)                          AS chunks,
       COUNT(DISTINCT source)            AS sources,
       pg_size_pretty(SUM(pg_column_size(embedding))) AS embedding_bytes,
       pg_size_pretty(SUM(pg_column_size(text)))      AS text_bytes
FROM ai_context_vectors
GROUP BY category
ORDER BY SUM(pg_column_size(embedding)) DESC;

-- Table, TOAST and indexes
SELECT pg_size_pretty(pg_total_relation_size('ai_context_vectors')) AS total,
       pg_size_pretty(pg_relation_size('ai_context_vectors'))       AS heap,
       pg_size_pretty(pg_indexes_size('ai_context_vectors'))        AS indexes,
       pg_size_pretty(pg_total_relation_size(
         (SELECT reltoastrelid FROM pg_class
          WHERE oid = 'ai_context_vectors'::regclass)))             AS toast;
```

Expect most of the space in `vuln-monitor` (non-KEV CVEs), `ransomware`
(victims) and `telegram`.

### Disk headroom

`TRUNCATE` frees the files immediately and needs no extra space for a copy, so
there is no need for headroom equal to the table size. Still keep some free
space: the transaction also writes WAL, and the later re-embed of groups, actors
and KEV CVEs writes new rows and rebuilds index entries.

## 2. Order of operations

1. **Set or keep the reduced flags first.** They are read from the process
   environment at the time of the call, so restart the app after changing
   them. If they are still `all`, the purge is refused.
2. **Run the report** and check `wouldRefuse: null`.
3. **Run the purge** with `confirm: true`.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"confirm": true}' \
  http://localhost:3000/ai/admin/vectors/purge
```

Success:

```json
{ "success": true,
  "data": { "status": "purged", "removedRows": 4,
            "beforeBytes": 188416, "afterBytes": 65536 } }
```

`status` is `noop` (and `removedRows` 0) when the table was already empty;
the sync states are still reset.

## 3. What the purge does

1. Validates `confirm`, the scope, and that no ingestion is running.
2. Pauses embedding sync manually (it is restored afterwards only if you had
   not already paused it yourself).
3. In one transaction: takes a purge advisory lock, sets
   `lock_timeout = 10s`, runs `TRUNCATE ai_context_vectors` (only if the table
   has rows), and `DELETE FROM ai_sync_states`. Any failure rolls everything
   back.
4. Resumes sync.

It never runs on startup or from a migration; it only runs when an admin
calls the endpoint.

### Next ingestion

With every watermark reset, the next scheduled run (or `POST /ai/admin/sync`)
re-embeds only the in-scope sources: **ransomware groups, threat actors and,
with `RAG_CVE_EMBED_MODE=kev`, KEV CVEs**. Victims and Telegram messages are
not re-embedded; the chat reaches them through SQL tools. Until that run
finishes, `semantic_search` returns little or nothing, while the structured
tools keep working.

## Refusals and errors

| HTTP | `code` | Cause | What to do |
|------|--------|-------|------------|
| 400 | `confirm_required` | Body lacks `"confirm": true` | Send `{"confirm": true}` |
| 409 | `scope_not_reduced` | Some flag is `all` (response includes `scope`) | Reduce the flags and restart; or pass `"force": true` to purge anyway |
| 409 | `ingestion_running` | An embedding run is in progress | Wait for it to finish (`GET /ai/admin/sync/status`) or pause sync, then retry |
| 409 | `purge_in_progress` | Another purge holds the advisory lock | Wait and retry |
| 401/403 | | Missing or non-ADMIN token | Use an ADMIN token |

A lock timeout (10 s) surfaces as a server error and rolls back; retry when
the table is not busy.

### `force`

`"force": true` skips only the `scope_not_reduced` check. With `all` flags the
next ingestion will immediately re-embed everything, so it is only useful to
reset the index deliberately (for example after changing `EMBEDDING_MODEL` or
`EMBEDDING_DIM`).

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"confirm": true, "force": true}' \
  http://localhost:3000/ai/admin/vectors/purge
```

## Rollback / re-embed more sources

The purge cannot be undone, but you can rebuild by re-embedding:

1. Set the flags back, for example `RAG_CVE_EMBED_MODE=all`,
   `RAG_RANSOMWARE_VICTIM_EMBED_MODE=all`, `RAG_TELEGRAM_EMBED_MODE=all`, and
   restart.
2. Run the sync: `curl -s -X POST -H "Authorization: Bearer $TOKEN"
   http://localhost:3000/ai/admin/sync`.
3. Watch progress: `GET /ai/admin/sync/status` (includes `index` counts per
   category).

Re-embedding everything is slow and reproduces the disk usage this runbook
removes, so prefer widening one flag at a time.

## Checklist

- [ ] Flags are reduced and the app was restarted.
- [ ] Report shows `wouldRefuse: null`.
- [ ] You accept the table cannot be restored without re-embedding.
- [ ] After the purge, `afterBytes` is smaller than `beforeBytes`.
- [ ] The next sync re-embedded groups, actors and KEV CVEs only.
