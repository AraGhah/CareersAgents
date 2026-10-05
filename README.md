# Internship Desk

A CRM for my Winter 2027 stage search. It tracks openings, applications and their status.
Finding, matching, tracking, researching and drafting all run themselves (see "Automatic
mode"), and one button, **Postuler automatiquement**, applies to the N best offers for me (see
"Postuler automatiquement"). Nothing is emailed without a click. An online application form is submitted by the
desk only if you turn that on (`PORTAL_ALLOW_SUBMIT=true`), only after you approved every
answer, and only when every preflight check passes (see "Portal applications").

## Pipeline & Find Internships (V9)

Assisted Mode dashboard at `/pipeline`:

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v9.sql
npm run discover          # ATS boards + score vs active CV (no fake LinkedIn/Indeed)
```

Pipeline: Discovered → Qualified → Ready → Applied (shown as "Envoyé") → Follow-Up → Interview → Accepted/Rejected.

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

## Postuler automatiquement (V13)

The button on **Offres** and **Tracker** (and `/auto-apply`) asks "À combien de stages veux-tu postuler ?" and
then goes down the list from the best score to the worst until that many applications are done.

```
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v13.sql
npm run auto-apply -- --dry --count 5   # who would be picked, best first. Changes nothing.
npm run auto-apply -- --count 5         # the same as the button, in the terminal
npm run auto-apply:check                # database checks with fake Gmail: no email, no browser, deletes its own rows
```

- **Which postings.** Open, scored 60 or more (`AUTO_APPLY_MIN_SCORE`), not rejected for location/term/role,
  nothing of yours on them yet. Left out: an application already sent, one whose Gmail draft is waiting for you,
  one the desk cannot drive (`manual`: Workday-style account portals), a form blocked or waiting on you in the last
  7 days, and the twin of a role already applied to (same company, same role under another posting).
- **N means N applications.** A posting the desk can do nothing with is skipped with its reason and does not use
  up one of the N, so the batch keeps going down the ranking. It stops at N, at the end of the list (`3N + 10`
  postings looked at, at most 80), when you press **Arrêter**, or if Gmail stops answering.
- **Email (a published recruiter address).** The letter and email are built exactly as on the application page (one
  you already built or edited is kept), then the email goes into **Gmail as a draft with the CV and the cover letter
  attached**. It is never sent: you read it and press Send. The application becomes **Prêt** until then.
- **Online form (no published address).** Only with `PORTAL_ALLOW_SUBMIT=true`: the form is filled in a hidden
  browser and submitted if every preflight gate passes (see "Portal applications"), one at a time with
  `PORTAL_DELAY_SECONDS` between, and at most `PORTAL_DAILY_LIMIT` a day. A form spread over several pages is filled
  page by page (`schema-v14.sql`): "Next" is pressed only once the page is complete and nothing waits on you, and the
  final Submit only on the last page. A form that waits on you (a question only you can answer, a CAPTCHA, a page that
  refuses to go on) is marked **À finir** with what stopped it, the page it stopped on and how many fields are already
  filled, and the batch moves on. **Continuer à la main** reopens it in a visible browser, refills everything up to that
  page, and leaves the window to you; submitting there is recorded as soon as the portal confirms. Without the flag,
  forms are skipped and nothing is opened. A batch never creates employer-portal accounts.
- **No clicks for what your bank already says.** `PORTAL_AUTO_APPROVE_ANSWERS=true` lets written answers that pass
  every truth and style check go in without your approval (an answer with an invented fact, number, employer or tool
  is never approvable). `PORTAL_AUTO_CONFIRM_PERSONAL=true` fills personal questions from the red answer-bank entries
  (work authorization and sponsorship for Canada, required self-identification, salary, previous employment) with the
  same strict matching as the suggestions, and ticks a *required* box that only consents to the application itself
  (privacy notice for recruiting, "the information I gave is accurate"). Marketing, job alerts, talent pools,
  background or credit checks, third-party sharing, arbitration and non-competes are never ticked; optional
  self-identification is left blank. Language level comes from the CV ("French (fluent)" → *Fluent*, never *Native*),
  and the postal code from the CV header.
- **"Envoyé".** The application's status `applied` is shown as **Envoyé**. It is set when the portal confirms a form,
  and for an email as soon as the draft is found in Gmail's Sent folder: while `/auto-apply` is open it looks every
  45 seconds and when you come back to the tab; `npm run sync:inbox` (and `automate`, every 30 minutes) does the same,
  and also catches an email you sent without going through a draft. A draft you deleted is not marked sent.
- **Progress.** The work runs in its own process (`scripts/auto-apply.ts`, log in `applications/_auto-apply/`), so
  the page can be closed. `/auto-apply` shows each posting tried, in order, with its score, route, result and why.
  One batch at a time; a batch whose process died is closed after 15 minutes.
- **Gmail has to work.** The button asks Google, not just the token file, before it starts: an expired
  authorization (`invalid_grant`) means `npm run gmail:auth` once more.

**Criminal record and security questions.** These two are the only "personal" questions the desk answers without
a confirming click, because Ara told it directly: no criminal record, no security issues. They read the red answer-bank
entries `criminal_record_check` and `security_clearance` (values live in the database, like the other red ones), and
only while those still say "No ...". It answers only a plain yes/no choice, and only these shapes: *"Do you have a
criminal record?"* / *"Have you been convicted of ...?"* → No; *"Is there any reason / issue / concern that would
prevent a security clearance?"* → No; *"Are you able to obtain / pass a security clearance or background check?"* →
Yes. Everything near them stays yours: "willing to undergo a check" (a consent), "do you hold a clearance", a "clean
record" certificate, pending charges, a traffic offence, a negated question, an explain box, a single tick-box.

## Auto-apply v2 (V16)

Ideas taken from ApplyPilot, AIHawk (Auto_Jobs_Applier), career-ops and ApplyKit, held to the desk's rules (nothing
invented, nothing personal without you, no Submit without the preflight, no CAPTCHA solving, never LinkedIn/Indeed logins).

- **Finds the company's own posting** on Workday, SuccessFactors and SmartRecruiters through their public job search
  (`lib/apply/boards.ts`). Which system a company uses comes from `employers.json` (each entry checked against its API),
  from its other postings' links, and from its careers site. A LinkedIn/Indeed copy of a Cisco, Intact, Autodesk,
  Desjardins, CAE, Pratt & Whitney, Bombardier or Hydro-Québec role now becomes that company's own form.
- **The AI form agent** (`lib/apply/agent`) fills what the desk's own reader stops on: Workday's and SuccessFactors'
  wizards, first-step portals, custom widgets. Claude sees the page's controls as a numbered list and your facts, and
  acts through a few tools. It types only facts it was given, asks you for anything else, never types a password, and
  never presses the final Submit: it hands back to the same preflight and `submit.ts` as every other run.
  `npm run agent:check` drives it offline through a fixture wizard.
- **Answer memory**: a question the desk could not answer, once you answer it on the application page, is remembered
  (company name taken out) and reused on every later form. Listed, editable and forgettable on the Answers page.
- **Confirm once**: on the Answers page, "Confirmer et utiliser" for work authorization, sponsorship (and salary if you
  want) fills them on forms about Canada / your country of residence without a click. Self-identification stays blank.
  "Have you worked at <company> before?" is answered "No" when the company is nowhere in your CV.
- **Fit review** (`lib/match/fit-review.ts`): a cheap model grades each posting 1–5 against your profile (skills, level
  and enrolment rules, place, term, language) with red flags quoted from the posting. The batch skips a grade under
  `AUTO_APPLY_MIN_GRADE` (default 3) with the reason; shown on the job page.
- **Tailored CV** (`lib/cv-tailor.ts`): your real CV's content reordered for the posting (asked-for skills first, closest
  projects, most relevant experience); a reworded summary is kept only if every fact in it is yours. Built from the
  application page; sent instead of your CV only with `CV_TAILORED=true`.
- **Accounts in the batch** with `PORTAL_BATCH_ACCOUNTS=true` (same host allowlist; employer hosts in `employers.json`
  count as known). Account forms that also ask for your name, phone or country get them from your profile.
- **Form reading**: choices drawn as buttons (Ashby's Yes / No) and "select all" lists split over several names are read
  as one question each.

## LinkedIn Easy Apply (GodsScion bot)

The one place the desk uses your LinkedIn account. It drives [GodsScion/Auto_job_applier_linkedIn](https://github.com/GodsScion/Auto_job_applier_linkedIn)
(MIT, Python/Selenium), cloned into `tools/linkedin-bot/` (gitignored), in a visible Chrome window. LinkedIn's terms
forbid bots on an account and it can restrict yours: keep runs small.

```
npm run linkedin:setup           # clone (or update) the bot and install its Python packages in tools/linkedin-bot/.venv
npm run linkedin -- --dry        # fills every Easy Apply form up to Review, then discards it. Submits nothing.
npm run linkedin                 # applies, pausing before each Submit (Submit / Discard / Disable Pause)
npm run linkedin -- --no-pause   # applies without that pause
npm run linkedin:import          # records what it submitted: each posting becomes "Envoyé" in the tracker
```

- **Settings come from the desk** (`tools/linkedin-bot/user_config.json`, rewritten on every run): name, phone, links,
  work authorization and sponsorship from the answer bank; the CV is the active English one; postal code and most
  recent employer from its analysis. Searches internship postings around Montréal for the past month, Easy Apply only.
  Tune with the `LINKEDIN_*` variables in `.env.example`. `LINKEDIN_DESIRED_SALARY` is required: the bot types a
  number into salary questions.
- **What it never does**: answer a question it has no answer for (it stops for you, never `pause_at_failed_question
  = false`, which answers at random), use AI, or send a cover letter (a form requiring one stops for you). US
  self-identification questions get "Decline".
- **Sign-in**: you sign in yourself in the bot's window the first time; its profile (`C:\temp\auto-job-apply-profile`)
  keeps you signed in. `LINKEDIN_EMAIL` / `LINKEDIN_PASSWORD` make it type them instead.
- **No double applications**: before each run, the LinkedIn postings you already applied to from the desk are added to
  the bot's history (`all excels/all_applied_applications_history.csv`), which it skips.

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
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v6.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v8.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v9.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v10.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v11.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v12.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v13.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v14.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v15.sql
docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v16.sql
cp .env.example .env.local        # then set DATABASE_URL
npm install
npm run resumes:import
npm run dev
```

**Who can reach it.** The desk has no accounts: `npm run dev` and `npm start` listen on 127.0.0.1 only, and
`proxy.ts` answers only requests addressed to this machine (localhost, 127.0.0.1, ::1), refusing other Host
names (DNS rebinding) and cross-site form posts. To open it from another device, set `DESK_ALLOWED_HOSTS` to
the name you use, set `DESK_ACCESS_TOKEN` to a long random value, start Next with `-H 0.0.0.0`, and open
`/?token=<value>` once in each browser.

Every command in this README that looks like `name:check` is an npm script, so it is run as
`npm run name:check` (typed alone, PowerShell says the term is not recognized). The database
container has to be up first (Docker Desktop running) for anything that reads Postgres:
`followups:check`, `score:check`, `package:check`, `mcp:check`, `discover`, `automate`.

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

**One application per role per company.** Indeed and LinkedIn list the same posting under
different ids, and a company re-posts, so the same role can arrive several times. Auto-track
keeps the first one and leaves the others as plain jobs (`twinKey` in `lib/apply/dedupe.ts`,
the same matcher the portal duplicate check uses: punctuation, word order, the season and
"intern / stage / co-op" are ignored). If you already applied to a role, its copies are never
tracked. For copies tracked before that existed:

```
npm run applications:dedupe            # dry run: lists each role, what it keeps and what it would remove
npm run applications:dedupe -- --apply # removes the extras, writes them to cache/dedupe-<time>.json
```

Only applications with nothing of yours on them are removed: an email you approved, put in Gmail
or sent, a fill or submit portal run, an answer you approved, a reply or a follow-up all protect
one. Files under `applications/` are left where they are.

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

## Scoring: how a posting is matched to your CV

`npm run score` compares every posting with your **active CVs** (English and French) and stores seven
0–1 components in `job_scores`. The percent is their weighted sum (`weights.json`), so what is stored
reproduces the number exactly; the job page shows the same reasoning, criterion by criterion, with a
one-decimal percent, the points each criterion adds, and a reliability level.

| Criterion | Weight | What it looks at |
|---|---|---|
| Compétences (skills) | 30% | The technologies the posting names (160 in `skills.json`), each weighted by how much it asks for it: in the title 1.2, a requirement 1, a responsibility 0.8, mentioned 0.7, *nice to have* or "is a plus" 0.35, "familiarity with" 0.6. Against your CV: a technology **used in a project or job** counts 1, **listed with a level** ("Python (beginner)" 0.55, "C# (intermediate)" 0.9, "Rust (learning)" 0.4), plain listed 0.8. A technology you do not have but a related one stands in for gets partial credit (Vue asked, React known: 0.5 × React's credit; MySQL ↔ PostgreSQL; Java ↔ C#; AWS ↔ Azure...). |
| Pratiques et domaines | 10% | Practices the posting names (testing, agile, authentication, cloud, microservices, AI...) against what the CV text describes. |
| Adéquation du poste | 20% | What kind of role the title is: software developer 1, AI / cloud / mobile 0.7–0.75, QA 0.4, analyst 0.3, **anything outside software is 0 and skipped** (mechanical, tax, instructional design...). |
| Niveau et admissibilité | 10% | An internship, not a senior role; and the study it asks for: a master's or doctorate 0.15×, university enrolment with no mention of college 0.65× (you are in a DEC). |
| Période | 10% | The internship's term: a season **with its year** ("Winter 2027"), or a start month beside an internship word. A terrace "open in summer" or "Spring Boot" is not a term. 0 for another term. |
| Lieu | 15% | The posting's own place: Montréal 1, the South Shore 0.9, elsewhere in Québec 0.4, remote 1, elsewhere 0. |
| Langues | 5% | 0 when another language is required. |

Location, term or role at 0 **skips** the posting whatever its total (it stays listed, marked skipped,
with the reason). What a posting does not say is **neutral (0.5)**, never a guess: a posting with no
text cannot score like a verified match, and a single technology named in a title is one data point
that barely moves the skills score (the share earned is smoothed toward neutral by one imaginary
neutral observation). The job page says when a posting has no description (low reliability).

**No cybersecurity.** A cybersecurity role is never wanted: discovery does not store one (the title
filter in `filters.json`, which now matches accented words such as "cybersécurité" that `\b` could not),
scoring gives the role 0 and skips it (a *Security Office*, "Cyber as a Service", a title about security
whose description is about security work), while a software role at a security company is not affected.
`npm run applications:prune` lists the applications you already have for cybersecurity and non-software
roles (dry run; `-- --apply` removes the unsent ones with nothing of yours on them; `-- --all` adds
wrong-term and wrong-place ones). Applications already sent are never touched, only reported.

**It reads the posting's text, so the text has to be there.** LinkedIn's Apify actor returns no
description unless it opens every listing, and the desk used to ask it not to; it now asks it to
(`APIFY_SCRAPE_DETAILS=false` turns that off: faster and cheaper, but LinkedIn postings then match on
their title alone). Indeed's descriptions arrive nested (`description.text`) and used to be dropped; they
are read now. For postings already stored without text: `npm run descriptions:backfill` (dry run;
`-- --apply`) recovers the ones already in `cache/discover/` and copies the text of the same role on
another source (Indeed's text for a LinkedIn posting), free. `npm run score` does the same copy first.

**Filtering and ordering by score.** The **Offres** list has a *Score minimum* select (default: 60 and
over; 50, 70, 75, 80, 85, 90 and over; *Tous les scores*) and an order select: best score first (the
default), worst first, most recent first, company A to Z, or *avec email d'abord* (the earlier order:
jobs whose company has a known email first). An explicit minimum also applies to skipped jobs when
*Rejetées* is ticked. Skipped and unscored jobs always come after the scored ones. The **Tracker** has
the same two controls for your applications (default: every score, grouped by status then best score; or
best first / worst first), applied to the board and to the table, with "x sur y" shown. Both are in the
URL (`/?min=80&sort=best`, `/pipeline?min=70`), so a filtered view can be bookmarked; a value that is not
one of the choices is ignored.

`npm run score:check` (no database) confirms identical text scores identically and that a weight change
reorders two postings; `npm run match:check` (no database) holds the rules above, each with the case
that once broke it; `npm run jobs:check` (needs the database) runs the real list query and confirms the
minimum score and every order hold on your own postings.

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
your account. Discovery keeps the posting's link to the company's own form (`jobs.apply_url`,
Indeed's "apply on company site"). A LinkedIn actor gives no such link, so the form is looked for,
in order:

1. the same role at the same company on another source (the Indeed copy, a Greenhouse board);
2. **the company's own careers site** (`lib/apply/careers.ts`): its home, careers pages and what
   they link to are read once and remembered per company for two weeks (`cache/careers/`); a
   Greenhouse, Lever, Ashby or Workable board found there is read through the platform's public
   API, and the careers pages' own links are searched too. A match is kept on the job
   (`jobs.apply_url`) and the application goes through that form like any other portal one.
   The match is strict: the same role once "intern / stagiaire / co-op" and the season are set
   aside, an internship (never the full-time job of the same name), the same term and year when
   both name one, a place in Québec or Canada, and one clear winner (two equal candidates are "not
   found", never the first). `CAREERS_LOOKUP=false` turns it off.
3. your own paste: on a blocked application, **J'ai le lien de l'offre sur le site de l'entreprise**
   takes the company's posting (a LinkedIn or Indeed link is refused) and reads the form from there.

Only when none of these finds it does the application go to `manual`, with what was looked at and
the company's careers page in the reason, so the last step is one click. Most large employers send
candidates to an account portal (Workday, iCIMS, SuccessFactors...): those are found and linked
but stay yours.

```
npm run careers:find                     # dry run over every LinkedIn/Indeed-only application: what it finds, changes nothing
npm run careers:find -- --apply          # keep the postings found and re-route (then: npm run portal -- --queue plan)
npm run careers:find -- --only cohere    # one company (--fresh reads its site again)
npm run careers:check                    # offline: board spotting and role matching
```

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

**Suggested, then confirmed by you.** Twelve of those questions (work authorization, sponsorship,
salary, previous employment, and the self-identification ones: gender, ethnicity, disability,
Indigenous, visible minority, veteran, Hispanic/Latino, LGBTQ+) read a red entry of your answer bank
(`work_authorization`, `sponsorship_required`, `salary_expectation`, `previous_employment`, `gender`,
`ethnicity`, `disability`, `indigenous`, `visible_minority`, `veteran`, `hispanic_latino`, `lgbtq`).
The plan shows it pre-selected under **À toi** with one *Valider* click; the submit stays blocked until
you click, so nothing personal reaches a form without you. The values are typed into the database
(the `/answers` page), never into `seed/answers.ts`, so they stay out of git. A suggestion is made
only when it is safe: "authorized to work in the United States?" is not answered from a Canadian
citizenship, "citizen of another country" and "do you require a work permit" are different
questions, a single tick-box is never suggested (its own text may be the negative), and a choice
is mapped onto the form's own option: a tie, or "prefer not to answer", is never picked. With
nothing stored, a required question is yours and an optional voluntary one is left blank.

**Written answers** are drafted by Claude (`ANTHROPIC_API_KEY`), one question at a time with your
material, the posting and the company
notes, in your voice: the prompt carries style notes and your closest real answers. Then two
mechanical checks run, and a failed draft gets one revision with the failures as feedback:
- *humanize*: no stock phrasing ("passionate about", "leverage", "I am writing to express"…),
  no mention of AI or of how it was written, no placeholders, no bullets, varied openers and
  rhythm, a length that fits the question and the field's limit;
- *grounding*: every number, proper noun and technology must be in your material, the posting
  or the company notes; a tool only the posting mentions is flagged so it is never claimed.

**Which Claude model (`lib/claude.ts`).** The model is chosen by how hard the task is, so the strong
one is paid for only where it changes the outcome:

| Task | Starts on | Moves to the strong model when |
|---|---|---|
| Company-specific answers ("why us", "good fit", "why this role"), about you, a challenge, a technical question, any answer over 200 words | **Sonnet 5.5**, high effort | its own draft fails the checks: one revision, still Sonnet 5.5 |
| Strengths, weakness, teamwork, career goal, a project, any short answer | **Haiku 4.5** (a fraction of the tokens and cost) | the draft fails the checks, the model says the material lacks something, or its confidence is low: redone once by Sonnet 5.5 with what went wrong |
| Company research (a summary and one fact from a few pages) | **Haiku 4.5** | it returns no fact a letter can use and the heuristic has none either |

Each drafted answer says which model wrote it ("Drafted by Haiku 4.5 …"), and a plan run ends with a
line of what each model was asked ("Claude: Haiku 4.5 ×4 (3.1k in, 1.2k out) · Sonnet 5.5 ×2 …").
Haiku takes no effort setting, so none is sent to it; a model that turns out to reject one is
retried without. Settings in `.env.local`: `ANTHROPIC_MODEL_HARD`, `ANTHROPIC_MODEL_EASY`,
`ANTHROPIC_EFFORT` (the strong model's; default `high`). One model for everything: set
`ANTHROPIC_MODEL_EASY` to the same value as `ANTHROPIC_MODEL_HARD`. `ANTHROPIC_ANSWER_MODEL` /
`ANTHROPIC_RESEARCH_MODEL` pin a whole use to one model.

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

**Not driven:** LinkedIn and Indeed's own apply flows (Easy Apply): they need your own LinkedIn or
Indeed account, and LinkedIn's terms forbid automating its apply flow, which would put your LinkedIn
account at risk and need your login stored here; the desk applies on the company's own site instead
(see "Where the form is"). An employer's own account portal (Workday, Taleo, iCIMS, SuccessFactors)
is marked `manual` unless you start a run for that one application with an account configured, see
"Employer portal accounts" below. Multi-step wizards (Workday's) always stay yours.

**Employer portal accounts.** When a portal asks for an account on its own site, a run **you start for
one application** (the *Lire le formulaire* button, or `npm run portal -- --application <uuid>`) signs
in to it, or creates it first, with the account in `.env.local`:

```
PORTAL_CREATE_ACCOUNTS=true
PORTAL_ACCOUNT_EMAIL=you@example.com
PORTAL_ACCOUNT_PASSWORD="a password used nowhere else"
```

- **Where the password lives.** `.env.local` only (gitignored). It is typed into a password field and
  read nowhere else: never logged, never saved (no table, file or plan; `portal_accounts` has no password
  column), and masked from every run log and saved error. Use a password you use nowhere else: every
  portal it creates an account on then holds a copy of it.
- **Where it is typed.** Only over https, on a known application system (Workday, iCIMS, Taleo,
  SuccessFactors, SmartRecruiters...) or a host you list in `PORTAL_ACCOUNT_HOSTS` (comma-separated,
  subdomains included). Postings come from scraped listings, and one password serves every portal: a
  look-alike sign-in page on any other host is stopped with its name, and receives nothing.
- **When.** Never from `--queue` or `automate`, so a discovery run cannot open accounts in your name.
  `--no-accounts` turns it off for one run.
- **What it does on the account page:** signs in when it knows an account exists on that portal, else goes
  to the sign-up form, types the email and the password (twice), ticks the terms box that creating the
  account requires (job-alert and newsletter boxes stay off) and presses Create Account. If the portal says
  the account exists it signs in instead. If it asks to verify the email, it reads the link from your Gmail
  (readonly, only a message that arrived after the account was created, only a link to the portal's own site
  or a known application system, stored nowhere) and opens it; with no Gmail connected it tells you which
  email to verify and to run it again.
- **What it stops on, and says why:** a CAPTCHA (never solved), a form that wants more than an email and a
  password (a name, a phone number: it invents nothing), a password the portal refuses, a wrong password on
  an account it already holds. None of the application's own consents, declarations or questions is touched.
- **Then the application.** A single-page form after the sign-in goes through the usual plan → approve → fill
  → gated submit. Workday's application is a multi-step wizard: the desk signs you in, recognises it and
  leaves it to you, never planning its first step as if it were the whole form.
- **Where they are.** `/portal` lists every portal the desk has an account on (host, email, state).
  `schema-v12.sql` creates that table. `npm run account:check` (no database, no real site) tests all of
  this on local pages; `assist:check` holds that every click in the account code goes through one function
  that refuses unless the account is configured. The Workday automation ids it uses are taken from how Workday
  is built and have not been checked against a live tenant.

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

## Build guide status (V1–V13)

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
| V9 Pipeline dashboard + automatic mode | Done |
| V10 Categories + one CV per (language, category) | Done |
| V11 Portal applications (plan → approve → fill → preflight → gated submit) | Done (needs schema-v11 + your approvals) |
| V13 Postuler automatiquement (N best offers: Gmail drafts, gated form submit, "Envoyé" on send) | Done (needs schema-v13 + a working `gmail:auth`) |

## Eight-agent workflow: what is coded vs what stays in chat

| Agent | In the desk | Still manual / chat |
|-------|-------------|---------------------|
| 1 Chercheur | `discover`, add job, web search in Cursor | Workday postings, dedup across sources |
| 2 Analyste | `score`, UI bands, FR explanations | Final judgment on edge cases |
| 3 Dossier entreprise | Company fact + URL on application page | Full 10-line dossier with dated news |
| 4 Contact | `contacts` table + seed + a search of the company's own public pages (`contacts:find`) | Companies that publish no address take a form (portal) or are manual |
| 5 Rédacteur | Letter + PDF + **outreach-email.{lang}.txt** | Read every FR letter before sending |
| 6 Formulaires | `assist-apply`, answer bank on application page | Red / sensitive questions |
| 7 Excel | `npm run export` → `Stages_2027.xlsx` | Hand-enter rows you sent before the desk existed |
| 8 Relances | `followups`, `process-followups`, Gmail drafts | You click Send in Gmail |

## Remaining to complete (recommended order)

The code for V1–V11 is built. What is left is on your side:

1. **Clean up copies tracked before the duplicate guard** — `npm run applications:dedupe`, read the list, then add `-- --apply`.
2. **Backfill tracker** — Export Excel, add past applications by hand, or insert via SQL; re-export so Agent 7 matches reality.
3. **Portal answers** — `ANTHROPIC_API_KEY` is what drafts written form answers; approve or rewrite the drafts on each application (`/portal`). Turn on `PORTAL_ALLOW_SUBMIT=true` only once you trust that flow.
4. **Daily routine** — `followups:dry` then read drafts; update status when replies arrive (`sync:inbox:loop` does the matching). Gmail is connected with `gmail:auth` (once).
5. **Keep red answers empty** — `work_authorization` and the rest of the sensitive bank stay empty until you type them yourself.
6. **Optional code later** — Workday discover helper; import Excel → DB; company dossier table; interview prep button (posting + letter + projects, no auto-send).
7. **Do not build yet** — Auto-send mail, LinkedIn scraping, eight separate MCP servers (explicitly cut in the build guide). Auto-submit exists for portal forms only (V11): off by default and behind the preflight.
