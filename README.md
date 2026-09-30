# Internship Desk

A CRM for my Winter 2027 stage search. It tracks openings, applications and their status.
Finding, matching, tracking, researching and drafting all run themselves (see "Automatic
mode"). Nothing is emailed without a click. An online application form is submitted by the
desk only if you turn that on (`PORTAL_ALLOW_SUBMIT=true`), only after you approved every
answer, and only when every preflight check passes (see "Portal applications").

## Pipeline & Find Internships (V9)

Assisted Mode dashboard at `/pipeline`:

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v9.sql
npm run discover          # ATS boards + score vs active CV (no fake LinkedIn/Indeed)
```

Pipeline: Discovered → Qualified → Ready → Applied → Follow-Up → Interview → Accepted/Rejected.

Every job that qualifies (score ≥ 70, not gated) is auto-tracked **and** auto-prepared: company
dossier researched, a real published contact found on the company's own site, a personalized
email drafted. Nothing is sent — that's still **Approuver**, on purpose (see "Automatic mode"
below). "Chercher des stages" runs this end to end; so does `npm run automate` on a schedule.

LinkedIn and Indeed each stay **disabled** until you set your own Apify actor for that one
(`APIFY_TOKEN` + `APIFY_LINKEDIN_JOBS_ACTOR` / `APIFY_INDEED_JOBS_ACTOR`) — pick actors that
read public listings with no login/cookies on either platform, so there's no account of yours
to put at risk. Indeed's own official Publisher API was retired in 2023 and stays dead
regardless of any credential; the Apify route is the only way Indeed sourcing works today. The
UI reports the real state of both instead of inventing results.

On an application: **Préparer** re-runs company + recruiter research and rebuilds the
personalized email by hand, for anything auto-prepare missed or you want to redo. **Approuver**
creates a Gmail draft for `ara.ghahramanyan07@gmail.com` (send-yourself). Optional
`GMAIL_ALLOW_SEND=true` + re-auth with `gmail.send` enables approve-and-send — still one click,
still never automatic.

## Automatic mode

Everything up to *send* can run unattended. `npm run automate` starts one long-lived process:

```
npm run automate
```

- **Discover, every 4h** — new postings from the ATS boards (and LinkedIn, if configured),
  scored against your active CV, auto-tracked, auto-researched, contact found, email drafted.
- **Inbox sync, every 30 min** — matches Gmail replies to applications, updates status, cancels
  follow-ups on a reply.
- **Follow-ups, daily at 08:00** — drafts the day-7 / day-14 nudge for anything still open.

It runs each once immediately on startup, then on schedule. Leave it running in a terminal (or
under `pm2` / a Windows Scheduled Task / systemd if you want it to survive a reboot). Open the
app whenever you like — approvals are the only thing waiting for you; nothing sends or submits
itself. Stop it with Ctrl+C.

Prefer the individual loops instead: `discover:loop` (4h), `sync:inbox:loop` (30 min), and
`followups` run once daily via your own scheduler — `automate` is just all three in one place.

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
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v10.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v11.sql
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

## Internship categories & CVs per category (V10)

`/resumes` can hold more than one CV per language now: tag an upload with a category
(Software Developer, Software Engineer, Full-Stack Developer, Back-End Developer) and it stays
active alongside your other active CVs — one active resume per (language, category) slot, plus
an optional untagged "general" CV used as the fallback. When a job is found, the category is
detected from its title/description and the matching CV is attached automatically; category
correctness wins over language, language wins over nothing. `/pipeline` has a "Catégorie ciblée"
selector that biases the jobs list and default search — it never hides other categories.
`lib/priority-companies.ts` lists major employers (banks, aerospace, telecom) that get
highlighted in the jobs list when the regular LinkedIn/Indeed search surfaces them; they're seeded
into `companies` as declared targets (`npm run seed:companies`) but aren't fetched directly, since
none run the ATS boards this app queries.

## Discovery

`npm run discover` reads Greenhouse, Lever and Workable JSON boards for companies
that have a `board_token`, plus LinkedIn and Indeed via Apify if configured. Workday stays manual.
Raw responses sit in `cache/discover/` for three hours so a rerun is free.
`npm run discover:loop` repeats that every four hours; `npm run automate` runs this
alongside inbox sync and follow-ups in one process (see "Automatic mode" above).

### Filters — three layers, three places to tune

1. **What gets searched.** `APIFY_LINKEDIN_SEARCH_QUERY` / `APIFY_INDEED_SEARCH_QUERY` in
   `.env.local` accept a comma-separated list — `"software engineering intern, backend intern,
   full stack intern"` — and the actor runs once per term, merged and deduped. Location is
   `APIFY_*_SEARCH_LOCATION`. Full control over an actor's own fields (remote-only, date
   posted, experience level, ...): set `APIFY_*_JOBS_INPUT` to the exact JSON that actor
   expects instead.
2. **What counts as relevant.** Every result from every source — ATS boards, LinkedIn, Indeed
   — passes through `filters.json`: `internshipTerms` (title must contain one), `roleTerms`
   (title or description must contain one, unless it's already an internship title), and
   `excludeTerms` (title match here kills it outright, even if everything else matched —
   this is where "senior", "staff", "director" live, so a senior post never sneaks in on a
   strong skills match). Edit the arrays directly; no restart needed beyond the next run.
3. **What gets auto-tracked.** `filters.json`'s `autoTrackMinPercent` (default 70) is the score
   cutoff from the weights below. Raise it to auto-track fewer, more certain matches; lower it
   to catch more borderline ones for you to review by hand on `/pipeline`.

## Scoring

`npm run score` writes five 0–1 components into `job_scores` from the posting text.
Weights live in `weights.json` (skills 40%, location 20%, timing 20%, language 10%, level 10%).
If location or timing is 0 the posting is skipped regardless of the total.
Job detail pages show English and French score explanations.
`npm run score:check` confirms identical text scores identically, and that a
weight change reorders two synthetic postings.

## Application package

An application page has three steps, and everything else is folded under
**Plus d'options**:

1. **Préparer**: one click on *Générer la lettre et l'email* first looks the company
   up on its own public pages (its website, the address applications go to, what it
   does), then builds a short application email, a one-page cover letter as a PDF, and
   a checklist. *Personnaliser* (optional) takes a true fact about the company, its
   source link, and the language.
2. **Relire**: the checklist result in plain words, the email, and the letter.
3. **Envoyer**: the recipient is filled in from what step 1 found, with the page it
   was read from so it can be checked; other addresses found are one click away.
   *Créer le brouillon Gmail (CV et lettre joints)* puts the email in your Gmail as a
   draft with the CV and the cover letter already attached, through the Gmail API
   (only the `gmail.compose` permission: it can make drafts and cannot send anything).
   Pressing it again after regenerating replaces that draft instead of adding a second.
   You open the draft in Gmail, read it, and press Send yourself. *J'ai envoyé la
   candidature* then schedules the follow-ups.

   Gmail is connected once with `npm run gmail:auth`. Until then, or if you prefer,
   *Ouvrir dans Gmail* and *Ouvrir dans l'app de messagerie* open a message without
   attachments, and the two PDFs are one click away as downloads.

**Finding the address.** Only an address a company's own page publishes is ever
offered, and its source page is stored with it; none is built from a pattern. The
search resolves the website (the one on record, then the job posting's site, then a
domain guessed from the name that must pass checks: the page has to show the company's
name, the domain has to carry all of it, and the pages read have to show a Québec,
Canada or software connection, so `giro.com` (helmets) never stands in for GIRO),
reads the home, careers and contact pages and the links between them, and keeps
careers and recruiting inboxes first and general ones after. Addresses printed for
accessibility, accommodation, privacy or press requests are dropped: job postings are
full of them and they are not where an application goes. Most large employers publish
no application address at all and take applications through a form. The page says so
and links to the posting instead of offering a wrong address.
`npm run contacts:find` shows what it finds for every company you have an unsent
application with (add `--apply` to store it); `npm run contact:check` tests the rules.

**Every application email follows one template**, Ara's own SAP example, word for
word (`scripts/letter-check.ts` fails if the SAP email drifts from it): who I am and
when I am available; the exact role and its focus; my hands-on experience and one
main project; the attached CV and letter and the links; an invitation to talk; the
signature with labelled LinkedIn, GitHub and Portfolio lines. The template is never
shortened to fit a length, so a very long job title can push it a little past 200
words. The subject is `Application - [exact role title] - Ara Ghahramanyan`
(`Candidature - ...` for a French posting). Follow-up emails use the same greeting
and signature. The letter is header, opening, match, proof, company fit, closing,
in the wording of the cover letter template.

A posting that reads as French (its title or text) gets both in French, worded
without gendered forms, and the French CV. A bilingual title with as many English
words as French stays English. The language can be changed under *Personnaliser*.

Everything is filled from data you wrote, never invented: the answer bank
(contact block, availability), the projects whose `highlight_for` overlaps the
posting, and `lib/project-facts.ts`, which holds the first-person wording for each
project in English and French. When you add a project to `seed/project-data.ts`,
add its entry there too; without one, the letter falls back to a plain list of
tools and the checklist flags it. Only a company fact that you typed, or that
passes a quality filter (not the "X is hiring for Y" placeholder, not scraped page
navigation, right language), goes into the "company fit" paragraph. Otherwise that
paragraph talks about the role and the checklist says so. Files land in
`applications/{company}-{role}-{id}/`, one folder per application.

The checklist is mechanical: company name, role title, noun check, resume path on
disk, no leftover `[brackets]`, one page, email length, verified company fact,
proof project has facts, link HTTP status, one application row per job.
`npm run letter:check` (no database) checks both templates against the guide in
English and French; `npm run package:check` builds one package and verifies a
corrupted company name fails the checklist.

**After changing a template**, `npm run packages:rebuild` shows what would be redone
for every application that has not been sent; add `--apply` to do it. It backs up
`applications/` first, keeps a company fact you typed, leaves sent applications and
hand-edited files alone, and refreshes stored outreach drafts that are not in Gmail yet.

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

## Portal applications (V11)

For a posting with no published recruiter or HR address, the application goes through the
company's own online form. `prepareOutreachWorkflow` routes it (`applications.channel`:
`email` / `portal` / `manual`), and the rest lives in `lib/apply/`, one concern per module:

| Module | Job |
|---|---|
| `platforms/` | Greenhouse, Lever, Workable, Ashby + generic: form URL, form root, submit selectors, confirmation |
| `browser/extract.ts` | reads every question off the live form (labels, required, options, limits); opens custom dropdowns first |
| `classify.ts` | label → intent; legal, sensitive and demographic rules run first |
| `candidate.ts` / `resolve.ts` | one grounded profile from the answer bank, CV and projects → deterministic values |
| `options.ts` | maps a value onto the form's own option; a tie is "no match", never the first option |
| `resume-select.ts` / `cover-letter.ts` | the CV by category then language, with the reason; the letter reused or built, checked against company/role/language |
| `answers/` | written answers: prompts, style profile, humanize lint, grounding check |
| `browser/fill.ts` | writes with real input events and reads every value back |
| `browser/guards.ts` | CAPTCHA (never solved or evaded), login walls, the form's own errors |
| `dedupe.ts` / `preflight.ts` / `submit.ts` | duplicate check (twice), the pre-submit gate, the only code that presses Submit |
| `store.ts` / `runner.ts` | `portal_runs`, `portal_fields`, `portal_errors`, `writing_samples`; the orchestration |

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v11.sql
npm run portal -- --application <uuid>                # plan: read the form, draft answers (headless)
npm run portal -- --application <uuid> --mode review  # fill in a visible browser, you press Submit
npm run portal -- --application <uuid> --mode submit  # fill, validate, submit if every gate passes
npm run portal -- --queue plan                        # plan every portal application without a plan
npm run portal -- --route                             # set email / portal / manual on older applications (no browser)
npm run portal:backfill-urls -- --apply               # store company form links from cached Indeed/LinkedIn results
npm run portal:check                                  # offline: fixture forms, no DB, no network
```

**Where the form is.** An Indeed or LinkedIn listing is not the form: their own apply flow needs
your account. Discovery now keeps the posting's link to the company's own form (`jobs.apply_url`,
Indeed's "apply on company site"); for a LinkedIn posting, whose actor gives no such link, the
same role at the same company on another source (the Indeed copy, a Greenhouse board) lends its
form. Only when neither exists does the application go to `manual`.

**What the desk drives, and what it hands to you.** Single-page forms: Greenhouse, Lever,
Workable, Ashby, and generic company forms (JazzHR, BambooHR, Teamtailor and similar). On the way
it closes cookie banners with the least consent offered ("Reject all" before "Accept"), clicks
past chat widgets, and follows an "Apply" that opens a new tab. It stops, marks the application
`manual`, and says why, on: account portals (Workday, SuccessFactors, iCIMS, Taleo, UltiPro
sign-in), a privacy / data-consent step before the form, multi-step wizards, a page with no CV
upload (the first step of a multi-step portal, such as ADP), and closed postings ("Job not
found", a redirect to `/closed`), which are also marked closed so they leave the queue. A CAPTCHA
does not stop the plan: the form is still read and filled, and the submit waits for you to
solve it in the open window.

The application page has the same three buttons under **Postuler par le formulaire en ligne**,
and `/portal` lists every attempt: company, role, form URL, date, CV and letter used, written
answers, state, and errors.

**Plan, then execute.** A plan run reads the form without filling it and decides every field:
*resolved* from your data, *drafted* (a written answer waiting for your approval), *à toi*
(yours to answer), or *left blank* (optional, nothing true to put there). You approve or rewrite
drafts on the application page; the execute run keeps those approvals field by field. Anything
that appears only after filling (an "If yes, explain" question) is planned on the spot and, if
it needs you, blocks the submit.

**Never filled by the desk:** work authorization, sponsorship, legal declarations, consent and
privacy terms, date of birth and other sensitive data, salary, voluntary self-identification,
previous employment, referrals, and anything unrecognized that is required. A value the data
does not fully support (a full date when you only wrote "January 2027") is a suggestion you
confirm, not a silent fill.

**Written answers** are drafted by Claude (`ANTHROPIC_API_KEY`, `ANTHROPIC_ANSWER_MODEL`, default
`claude-opus-5-5`), one question at a time with your material, the posting and the company
notes, in your voice: the prompt carries style notes and your closest real answers. Then two
mechanical checks run, and a failed draft gets one revision with the failures as feedback:
- *humanize*: no stock phrasing ("passionate about", "leverage", "I am writing to express"…),
  no mention of AI or of how it was written, no placeholders, no bullets, varied openers and
  rhythm, a length that fits the question and the field's limit;
- *grounding*: every number, proper noun and technology must be in your material, the posting
  or the company notes; a tool only the posting mentions is flagged so it is never claimed.

Still failing, or the model reports it lacks the information → it is yours, with no guess.
Without an API key, a question the bank answers in your own words (strengths, weakness,
teamwork, project, career goal) reuses that text for your approval; the rest is yours.

**Your style profile** grows from `writing_samples`: every answer you approve is stored, and a
rewritten one counts most. The yellow bank answers seed it. Later drafts read the closest ones.

**Preflight before submit:** not a duplicate (re-checked), required fields filled on the live
page, every value reads back, nothing pending, the form takes a CV at all (a page without one is
a first step, never a whole application), the right CV on disk and attached, the letter
names this company and role in the posting's language, drafted answers grounded, no
placeholder, no CAPTCHA challenge, no validation error. Then two permissions: not an
`is_target` company (those are always submitted by hand) and `PORTAL_ALLOW_SUBMIT=true`.
One red item and the browser stays filled for you instead. After Submit, only a confirmation
page it can read counts as submitted; an unconfirmed click is recorded as blocked and never
retried. `PORTAL_DAILY_LIMIT` (10) caps automatic submissions per day, and a queue waits
`PORTAL_DELAY_SECONDS` (90) between applications.

**Duplicates:** an application past "ready", a submitted portal run, a sent email, the same role
at the same company under another posting, or the same canonical posting URL (`/apply` and
tracking parameters stripped).

**Not driven:** LinkedIn and Indeed's own apply flows, Workday, Taleo, iCIMS, SuccessFactors:
they need your account. Those applications are marked `manual`.

`npm run automate` plans new portal applications after each discovery (`PORTAL_AUTO_PLAN=false`
turns it off) and, only with `PORTAL_ALLOW_SUBMIT=true`, executes plans you finished approving.

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
| V11 Portal applications (plan → approve → fill → preflight → gated submit) | Done (needs schema-v11 + your approvals) |

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
6. **Do not build yet** — Auto-send mail, LinkedIn scraping, eight separate MCP servers (explicitly cut in the build guide). Auto-submit exists for portal forms only (V11): off by default and behind the preflight.
