# Internship Desk

A CRM for my Winter 2027 stage search. It tracks openings, applications and their status.
It stops at the submit button: nothing is submitted or emailed automatically.

## Running it

```
docker compose up -d
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema.sql
cp .env.example .env.local        # then set DATABASE_URL
npm install
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
Weights live in `weights.json` and are untuned priors, not fitted to anything.
If location or timing is 0 the posting is skipped regardless of the total.
`npm run score:check` confirms identical text scores identically, and that a
weight change reorders two synthetic postings.

## Application package

On an application page, write a company fact with its source URL and click
**Build letter and checklist**. The letter is filled from the answer bank and
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
