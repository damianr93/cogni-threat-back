# AI chat: tools over RAG

The AI chat answers data questions by calling read-only SQL tools instead of
only embedding everything and retrieving similar text. Exact questions
("critical KEV CVEs this week", "LockBit victims in the US") are answered from
the database; the vector index is kept small and used only for meaning-based
search. If the model cannot call tools, the chat degrades automatically and
tells the user.

Code lives in `src/modules/ai-chat/`; env defaults in `libs/config/src/envs.ts`.

## Quick path

1. Use a local Ollama model that supports tools (see
   [Check model support](#check-whether-an-ollama-model-supports-tools)).
2. Leave `RAG_CHAT_MODE` unset (default `tools`).
3. Open `GET /ai/health` and confirm `chatVia: "tools"` and
   `toolCalling: "supported"`.
4. Ask a question; the `POST /ai/ask` response carries `meta.via: "tools"`.

Reclaiming disk from the old, larger vector index:
[ai-vector-purge-runbook.md](./ai-vector-purge-runbook.md).

## Chat modes

| `RAG_CHAT_MODE` | Behaviour |
|-----------------|-----------|
| `tools` (default) | Model calls tools in a loop until it answers. Fallback chain applies. |
| `retrieve` | Legacy path: embed the question, pgvector similarity search, one generate call. No tools, no `meta` in the response. |

An invalid value logs a warning and resolves to `tools`. The mode is read from
the process environment (`AiConfigService`).

### Tool loop (tools mode)

`ChatOrchestrator` sends the conversation plus tool schemas to Ollama
`/api/chat` (`stream: false`, `temperature` = `RAG_CHAT_TEMPERATURE`,
`num_ctx` = `RAG_CHAT_NUM_CTX`). The model may request tools; results are fed
back as tool messages. The loop ends when the model answers in text.

- `RAG_CHAT_MAX_TOOL_STEPS` (default `3`): maximum tool calls per turn. When
  the budget (or the context budget) runs out, one last call **without tools**
  forces a closing answer from what was gathered. If that is empty the reply is
  a fixed "could not generate an answer" message.
- Only the last 6 history messages are sent.
- Tool errors never throw into the loop: unknown tool, invalid args, timeout or
  failure all become `{ "error": ... }` the model can read.
- The whole turn runs inside the interactive priority, so embedding sync
  yields until the answer is produced.

## Tools

All tools are read-only. `limit` is 1-25 (default 10) unless noted. Every
result is capped in characters (see [Context budget](#context-budget)) and
list results are trimmed item by item with a truncation marker.

| Tool | Purpose | Key args | Timeout |
|------|---------|----------|---------|
| `search_cves` | Filtered CVE search; an exact CVE id matches directly. Returns total plus up to `limit` rows. | `query`, `severity` (LOW/MEDIUM/HIGH/CRITICAL), `isKev`, `minCvss` (0-10), `minEpss` (0-1), `product`, `since` (YYYY-MM-DD), `sort` (published/modified/cvss/epss), `limit` | 5 s |
| `get_cve` | Full detail of one CVE: CVSS, EPSS, KEV data, products, references. | `cveId` (e.g. `CVE-2024-3400`) | none |
| `cve_stats` | Global totals: all CVEs, KEV, modified in last 24 h, per severity. | none | 5 s |
| `search_ransomware_victims` | Victims by group, country, industry, name or date. Total plus newest `limit`. | `group`, `country` (ISO-2), `industry`, `query`, `since`, `limit` | 5 s |
| `get_ransomware_group` | Group profile: dates, TTPs, exploited CVEs, victim count, 5 latest victims. Matches name, then alias. | `name` | 5 s |
| `search_actors` | Threat actors by name/alias/country, with milestones. | `query`, `country`, `limit` | 5 s |
| `search_telegram_messages` | Keyword search over monitored Telegram messages. | `query` (websearch syntax), `keywords` (max 10, any may match), `channel`, `since`, `until`, `limit` (needs `query`, `keywords` or `channel`) | 8 s per attempt |
| `semantic_search` | Meaning-based search over the embedded index (groups, actors, KEV CVEs). Use when no structured tool fits. | `query` (max 300 chars), `categories` (`ransomware`, `vuln-monitor`, `actors`), `k` (1-10, default 6) | Ollama embedding call |

Notes:

- `search_cves` with `product` only looks at the 500 most recently modified
  CVEs and says so in a `note` field.
- Timeouts are Postgres `statement_timeout` set per transaction
  (`SET LOCAL`, so it never leaks to other queries). A timeout returns an
  `error` result to the model, not an exception.
- `semantic_search` honours the UI category and source filters.
- Telegram search runs full-text search first; see
  [Telegram search](#telegram-search).

## What is embedded vs queried

Groups and actors are always embedded. The three high-volume sources are
gated by env flags, read only from the process environment (no admin-panel
override). An unrecognised value logs one warning and falls back to the
**safest reduced** mode.

| Flag | Values | Default | Effect |
|------|--------|---------|--------|
| `RAG_CVE_EMBED_MODE` | `kev` / `none` / `all` | `kev` | Embed only KEV CVEs / none / all CVEs |
| `RAG_RANSOMWARE_VICTIM_EMBED_MODE` | `none` / `all` | `none` | Embed no victims / all victims |
| `RAG_TELEGRAM_EMBED_MODE` | `none` / `all` | `none` | Embed no messages / all messages |

Non-embedded data is reached through the SQL tools above. A scope is "reduced"
when CVE is not `all` and victims and Telegram are both `none` (the defaults).

Widening a flag (for example `kev` to `all`) resumes from the last `all` run
and fills the gap on the next ingestion. Narrowing a flag does **not** remove
existing vectors; use the purge runbook for that.

## Context budget

`RAG_CHAT_NUM_CTX` (default `8192`) is sent to Ollama as `num_ctx` and is also
the budget the code plans against. Tokens are estimated as 3 chars per token.

| Rule | Value |
|------|-------|
| Reserved for the answer | 1024 tokens |
| Minimum room to attempt another tool round | 900 tokens |
| Per-tool result cap | 600 to 2500 chars, 60 % of spare room, shrinks as the turn grows |
| Trim order | oldest history, then oldest tool results (replaced by `{"omitted":"context_budget"}`), then forced tool-less closure, then question cut to `RAG_QUERY_MAX_CHARS` (default 3500) |

The system prompt and tool schemas are never trimmed. If they alone do not
fit `num_ctx`, the turn fails with a configuration error that names
`RAG_CHAT_NUM_CTX`. This error is **not** degraded to the fallback chain: it
is an operator problem. Raise `RAG_CHAT_NUM_CTX` (admin panel or env) if it
appears; larger values cost more VRAM and latency.

## Fallback chain

```
tools  ->  router  ->  retrieve
```

Each step after the first marks the answer as degraded.

1. **Capability check.** `ModelCapabilityService` calls Ollama
   `POST /api/show` (5 s timeout) and looks for `tools` in `capabilities`.
   Result is cached per `ollamaUrl|model`: 10 min when known, 60 s when
   `unknown`. `unknown` (Ollama down, no `capabilities` field) means "try
   tools". An Ollama HTTP 400 about tools at chat time is marked
   `unsupported` for 10 min.
2. **Router** (`ChatRouter`) runs when the model is `unsupported`, returned no
   tool call for a recognisable data question, or the loop failed. Code detects
   intents deterministically (CVE ids, Telegram, ransomware, actors, KEV words;
   at most 3 calls, otherwise `semantic_search`), runs the same tools, and
   asks the model once, without tools, to answer from the results. No usable
   data gives a fixed "no data found" reply. If every tool failed, the router
   throws and the chain continues.
3. **Retrieve.** Legacy embed-and-generate path.

A sources-selected turn (see [Sidebar sources](#sidebar-sources)) that gets a
direct answer without any tool call is accepted, not treated as a failure.

### Degraded notice and `meta`

Degraded answers get a Spanish notice appended (and persisted with the
message): `> **Modo degradado:** ...` naming the model or the error class.

`POST /ai/ask` adds `data.meta` in tools mode (omitted in retrieve mode):

| Field | Meaning |
|-------|---------|
| `via` | `tools`, `router` or `retrieve` |
| `degraded` | `false` only for `via: tools` |
| `reason` | Only when degraded: `model_without_tools`, `no_tool_calls`, `orchestrator_error` |
| `tools` | Names of tools used (absent for `retrieve`) |

## `GET /ai/health`

Public. Fields under `data`:

| Field | Meaning |
|-------|---------|
| `status`, `llm`, `rag` | `ok`, `ollama`, `pgvector` |
| `ollamaUrl`, `model`, `embeddingModel` | Effective runtime config |
| `chatMode` | `tools` or `retrieve` |
| `toolCalling` | `supported`, `unsupported` or `unknown`. Always `unknown` in retrieve mode (the `/api/show` probe is skipped) |
| `chatVia` | Path a question will take: `tools`, `router` (model unsupported) or `retrieve` |
| `maxToolSteps`, `numCtx` | Effective values |

## Check whether an Ollama model supports tools

```bash
ollama show <model>
```

Look for `tools` under `Capabilities`. The backend does the same through
`/api/show`. If the section lists only `completion`, the chat will use the
router (`chatVia: "router"`). Change the model from the admin panel or `MODEL`.

## Sidebar sources

`GET /ai/context/sources` (`page`, `limit`, `search`, `category`) feeds the
source picker. The list is vector sources first, then SQL extras for data that
is no longer embedded, in this order:

| Extra | When | Notes |
|-------|------|-------|
| Telegram channels | Telegram mode `none` | One entry per channel (`GROUP BY channelName`) |
| CVEs | `search` given (any CVE mode) | Id search via trigram index; exact, prefix and KEV ranked first |
| Victims | Victims mode `none` and `search` given | Name `ILIKE` |

Each SQL source is capped at 50 rows and runs under a 2 s statement timeout;
a failure or timeout drops only that source. CVEs and victims that already have
vectors are deduped. Stale vectors whose source prefix is gated to `none`
(`vuln-monitor:cve:`, `ransomware:victim:`, `telegram:`) are excluded from the
vector part of the list. Page size is capped at 50.
`search` input is `LIKE`-escaped.

Selected sources are prefetched before the model runs: up to 5 sources, text
from the vector store (3 chunks) or from `get_cve`, the victim record, or
`search_telegram_messages` (5 messages for a channel). The block goes in front
of the question as `CONTEXTO (fuentes seleccionadas por el usuario):` and is
sized to half the spare context after the answer reserve and one tool round.
A failed prefetch leaves the question unchanged.

## Telegram search

`search_telegram_messages` uses PostgreSQL full-text search with two
configurations, `simple` and `spanish`, each backed by its own GIN expression
index. Zero hits or an FTS error fall back to an escaped trigram `ILIKE` (up
to 8 tokens). Each attempt has its own 8 s timeout; `total` is counted up to
1000. Responses include `usedFallback`.

## Search indexes, bootstrap and migrations

Prisma cannot declare expression indexes, so three layers protect them:

| Layer | What |
|-------|------|
| Migration `20260925120000_telegram_search` | Creates `pg_trgm`, `telegram_msg_fts_simple_idx`, `telegram_msg_fts_spanish_idx`, `telegram_msg_content_trgm_idx`, `vuln_cves_id_trgm_idx` (all `IF NOT EXISTS`) |
| `SearchIndexBootstrap` | On boot, re-runs the two FTS `CREATE INDEX IF NOT EXISTS` statements. A failure only logs a warning; Telegram search then uses trigram |
| `prisma/migrations-guard.spec.ts` | Unit test failing if any migration after `20260708163042_risk_operations` drops `ai_context_vectors` or a `telegram_msg_fts_*` index |

### Prisma `migrate dev` caveat

`ai_context_vectors` is created at runtime (pgvector, outside
`schema.prisma`), so `prisma migrate dev` sees it as drift and **proposes
dropping it** (and possibly the expression indexes). **Never accept that
migration.** Hand-edit or discard the generated SQL; the guard test will fail
if a drop slips into `prisma/migrations/`. Use `db:migrate:deploy` in
deployed environments.

## Checklist

- [ ] `GET /ai/health` shows `chatVia: "tools"`.
- [ ] A KEV or victim question returns `meta.tools` with SQL tools.
- [ ] Embed flags are at their reduced defaults unless you need `all`.
- [ ] No pending Prisma migration drops `ai_context_vectors`.
