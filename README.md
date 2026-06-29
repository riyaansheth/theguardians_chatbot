# THE GUARDIAN — real estate chatbot

A broker chatbot for The Guardians, embeddable on any page via one script tag.
Single Express server: embeddable widget + chat API + data import + admin, all
from one app.

The bot never invents property data. Flow control and matching are deterministic
code; the LLM only (a) extracts structured preferences from a message and
(b) phrases replies grounded **only** in data the server hands it.

## Stack

- Node 20+ (ES modules), Express
- Postgres + pgvector (cosine retrieval for PDF chunks)
- OpenAI: `gpt-4o-mini` (chat/extraction), `text-embedding-3-small` (1536-dim)
- Vanilla JS widget rendered in a Shadow DOM

## Prerequisites

- Node 20+
- Docker (for local Postgres + pgvector), or any Postgres 16 with the `vector` extension

## Quick start (clean clone)

```bash
cp .env.example .env          # then edit values (see below)
docker compose up -d          # starts Postgres+pgvector on localhost:5433
npm install
npm run migrate               # creates schema + loads 10 seed properties
npm run dev                   # http://localhost:3000
```

Health check:

```bash
curl localhost:3000/          # {"status":"ok","name":"THE GUARDIAN"}
```

Run the unit tests (pure matching/scoring logic, no DB or network):

```bash
npm test
```

## Environment variables (`.env`)

| Var | Required | Notes |
|---|---|---|
| `PORT` | no | defaults to 3000 |
| `ALLOWED_ORIGINS` | no | comma-separated origins allowed to call `/api/*` from the browser, e.g. `https://theguardiansindia.com` |
| `DATABASE_URL` | **yes** | Postgres connection string (local default targets port 5433) |
| `OPENAI_API_KEY` | **yes** | a real `sk-...` key enables LLM extraction + phrasing |
| `OPENAI_CHAT_MODEL` | no | defaults to `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | no | defaults to `text-embedding-3-small` |
| `ADMIN_USER` | no | defaults to `admin` |
| `ADMIN_PASSWORD` | **yes** | gates `/admin` and write endpoints |

No secrets live in source. `.env` is gitignored; `.env.example` is committed.

> **Offline / no-key mode.** If `OPENAI_API_KEY` is a placeholder, the server
> still runs end-to-end using a deterministic fallback: a rule-based slot
> extractor and templated phrasing, plus hash-based embeddings. This is for
> local testing only — set a real key for production-quality extraction and
> phrasing. The fallback is bypassed automatically when a real key is present.

## Endpoints

- `GET /` — health JSON
- `POST /api/chat` — `{ sessionId, message, pageUrl }` → `{ reply, mode, recommendations, leadScore, leadTier }`
- `GET /api/properties` — list the catalogue (read-only, open)
- `POST /api/import` — upload `.xlsx` / `.csv` / `.pdf` (**basic-auth required**)
- `GET /admin` — admin panel (**basic-auth required**); also `/admin/import`, `/admin/properties`, `/admin/leads`, `/admin/sessions`, `/admin/sessions/:id/messages`
- `GET /widget.js`, `GET /widget.css` — the embeddable widget

## Embedding the widget

Add these two lines to any page (point the URLs at your deployed bot domain):

```html
<script>
  window.TheGuardianBotConfig = { apiUrl: "https://your-bot-domain/api/chat", botName: "THE GUARDIAN" };
</script>
<script src="https://your-bot-domain/widget.js"></script>
```

The widget renders inside a Shadow DOM, so host-site CSS cannot affect it (and
vice-versa). Add the host page's origin to `ALLOWED_ORIGINS`.

Local isolation demo: open `http://localhost:3000/test-host.html` — a fake client
site with deliberately hostile CSS; the widget renders unaffected.

## Importing data

Excel/CSV columns are auto-detected via a synonym map (e.g. `Project Name`,
`Builder`, `Config`, `Budget`, `Possession`, `RERA`). Unmapped columns are kept
in each property's `raw_data`. Re-importing upserts on
`(project_name, micro_location)`. PDF brochures are chunked, embedded, and
fuzzy-linked to a property by detected project name.

```bash
curl -u admin:yourpass -F "file=@properties.xlsx" http://localhost:3000/api/import
curl -u admin:yourpass -F "file=@brochure.pdf"     http://localhost:3000/api/import
```

## Deployment

Deploy to **Render** or **Railway** (long-lived Express process):

1. Provision a Postgres instance with pgvector (Render Postgres, Railway, or Supabase).
2. Set the env vars above (`DATABASE_URL`, `OPENAI_API_KEY`, `ADMIN_PASSWORD`, `ALLOWED_ORIGINS`).
3. Run `npm run migrate` once against the prod DB (omit `seed.sql` for real data, or keep it for a demo).
4. Start with `npm start`.

**Vercel (serverless) is not supported.** This app needs a persistent Postgres
pool, handles multipart file uploads to a temp dir, and runs import/embedding
jobs that don't fit a cold-start/serverless budget. Use a long-lived host.

Uploaded files are written to the OS temp dir, parsed immediately, persisted to
the DB, then deleted — never rely on uploaded files surviving (disks are
ephemeral on Render/Railway).

## Security notes

- Admin uses HTTP Basic Auth (`express-basic-auth`) — minimal, **not** production-grade SSO. Put it behind HTTPS and consider a stronger gate for real deployments.
- `helmet` sets security headers; CORS is restricted to `ALLOWED_ORIGINS` (no blanket `*`).
- `xlsx` (SheetJS) carries an npm advisory with no registry fix; uploads are admin-gated (trusted input), which mitigates exposure. Swap to the SheetJS CDN build if you need the patched version.
