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

## Export

`npm run export` writes `Internships.xlsx` from the database. The database is the source of
truth; the spreadsheet is a view of it.
