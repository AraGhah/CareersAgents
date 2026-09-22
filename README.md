# Internship Desk

A CRM for my Winter 2027 stage search. It tracks openings, applications and their status.
It stops at the submit button: nothing is submitted or emailed automatically.

## Pipeline & Find Internships (V9)

Assisted Mode dashboard at `/pipeline`:

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v9.sql
npm run discover          # ATS boards + score vs active CV (no fake LinkedIn/Indeed)
```

Pipeline: Discovered → Qualified → Ready → Applied → Follow-Up → Interview → Accepted/Rejected.

LinkedIn / Indeed stay **disabled** until you set authorized credentials
(`APIFY_TOKEN` + `APIFY_LINKEDIN_JOBS_ACTOR`, or `INDEED_PUBLISHER_ID`). The UI shows that
clearly instead of inventing results.

On an application: **Préparer** runs company + recruiter research and builds a personalized
email with the correct EN/FR CV. **Approuver** creates a Gmail draft for
`ara.ghahramanyan07@gmail.com` (send-yourself). Optional `GMAIL_ALLOW_SEND=true` + re-auth
with `gmail.send` enables approve-and-send.

Demo recording (server must be running):

```
npm run dev
npm run demo:record   # writes demos/internship-desk-demo.webm at 1080p
```

## Running it

```
docker compose up -d
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v8.sql
cp .env.example .env.local        # then set DATABASE_URL
npm install
npm run resumes:import
npm run dev
```

## Seeds

The answer bank, the projects and the target companies are written by hand in `seed/`.
Rerunning a seed never overwrites text that is already in the database.

```
npm run seed:answers
npm run seed:projects
npm run seed:companies
npm run seed:contacts
```

## Discovery

`npm run discover` reads Greenhouse, Lever and Workable JSON boards for companies
that have a `board_token`. Workday stays manual. Raw responses sit in `cache/discover/`
for three hours so a rerun is free. `npm run discover:loop` repeats that every four hours.

## Scoring

`npm run score` writes five 0–1 components into `job_scores` from the posting text.
Weights live in `weights.json` (skills 40%, location 20%, timing 20%, language 10%, level 10%).
If location or timing is 0 the posting is skipped regardless of the total.
Job detail pages show English and French score explanations.
`npm run score:check` confirms identical text scores identically, and that a
weight change reorders two synthetic postings.

## Application package

On an application page, write a company fact with its source URL and click
**Build letter, email and checklist**. You get a short outreach email (120 words max),
a cover letter, PDF, and checklist. The letter is filled from the answer bank and
the projects whose `highlight_for` overlaps the posting. Green answers paste as
is; yellow ones you reword; red ones you type yourself. PDFs land in
`applications/{company}-{role}/`. The checklist is mechanical: company name,
role title, noun check, resume path on disk, link HTTP status, one application
row per job. `npm run package:check` builds one package and verifies a
corrupted company name fails the checklist.

## Desk server (stdio)

One process, not eight. `npm run mcp` starts `mcp/server.ts` over stdio.

Read tools: `jobs_ranked`, `application_status`, `applications_by_state`,
`company_profile`, `answer_lookup`, `followups_due`, `search_jobs`.

Write tools (reversible only): `set_application_status`, `add_note`.
Nothing that submits a form or sends mail is exposed.

Claude Desktop config example (adjust the path):

```json
{
  "mcpServers": {
    "internship-desk": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "C:/path/to/CareersAgents"
    }
  }
}
```

`npm run mcp:check` lists the nine tools and checks that every `jobs_ranked` row exists in Postgres.

## Inbox and follow-ups

Apply the V6 schema once:

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v6.sql
npm run seed:contacts
```

Gmail scopes are **readonly + compose only** — `gmail.send` is never requested.

```
# set GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env.local
npm run gmail:auth
npm run sync:inbox          # or sync:inbox:loop every 30 minutes
npm run followups:dry       # then followups to create drafts
```

Moving an application to `submitted` inserts follow-ups at day 7 and day 14.
An inbound reply cancels pending follow-ups. Drafts only go to addresses already
in `contacts` with a real `source_url`. You press send in Gmail yourself.
`npm run followups:check` verifies the day-5 inbound → day-7 cancel path offline.

## Browser assist

Deliberately incomplete. Playwright opens the posting in a **headed** window, fills
green answers, pre-fills yellow ones (highlighted), leaves red fields empty, and
**never clicks Submit**.

```
npm run assist:check
npx tsx scripts/assist-apply.ts --application <uuid>
```

Target companies (`is_target`) are refused unless you pass `--i-know`. Prefer filling
those by hand. After you submit in the browser, set the status to `submitted` in the app.

## Export

`npm run export` writes `Stages_2027.xlsx` (colonnes du suivi de candidatures, liste
déroulante Statut) and `Internships.xlsx` (short English view). The database is the
source of truth; the spreadsheets are views of it.

## Build guide status (V1–V7)

| Version | Status |
|---------|--------|
| V1 Tracker + answer bank | Done |
| V2 Discovery (Greenhouse / Lever / Workable) | Done |
| V3 Scoring | Done |
| V4 Application package | Done (+ outreach email draft) |
| V5 MCP server | Done |
| V6 Inbox + follow-ups (Gmail drafts only) | Done (needs your OAuth + real volume) |
| V7 Browser assist (Playwright, no Submit) | Done |
| V8 Resumes + Dossier research + Gmail outreach drafts | Done |

## Eight-agent workflow: what is coded vs what stays in chat

| Agent | In the desk | Still manual / chat |
|-------|-------------|---------------------|
| 1 Chercheur | `discover`, add job, web search in Cursor | Workday postings, dedup across sources |
| 2 Analyste | `score`, UI bands, FR explanations | Final judgment on edge cases |
| 3 Dossier entreprise | Company fact + URL on application page | Full 10-line dossier with dated news |
| 4 Contact | `contacts` table + seed | Finding recruiter on each new company |
| 5 Rédacteur | Letter + PDF + **outreach-email.{lang}.txt** | Read every FR letter before sending |
| 6 Formulaires | `assist-apply`, answer bank on application page | Red / sensitive questions |
| 7 Excel | `npm run export` → `Stages_2027.xlsx` | Hand-enter rows you sent before the desk existed |
| 8 Relances | `followups`, `process-followups`, Gmail drafts | You click Send in Gmail |

## Remaining to complete (recommended order)

1. **Source files (Step 1)** — Add CV PDF (FR + EN) and a single `seed/profile.ts` or markdown profil outside git if you prefer; keep red answers (`work_authorization`, etc.) empty in the bank until you type them yourself.
2. **Backfill tracker** — Export Excel, add past applications by hand, or insert via SQL; re-export so Agent 7 matches reality.
3. **Gmail** — Run `gmail:auth` once; use `sync:inbox:loop` after ~15 submissions.
4. **Daily routine (Step 9)** — `followups:dry` then read drafts; update status when replies arrive.
5. **Optional code later** — Workday discover helper; import Excel → DB; company dossier table; interview prep button (posting + letter + projects, no auto-send).
6. **Do not build yet** — Auto-submit, auto-send mail, LinkedIn scraping, eight separate MCP servers (explicitly cut in the build guide).
