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

## Export

`npm run export` writes `Internships.xlsx` from the database. The database is the source of
truth; the spreadsheet is a view of it.
