# Internship Desk

An AI-powered platform concept that helps students find and manage internship applications end to end: discover roles, match them to the right CV, generate a cover letter and email, prepare a Gmail draft with attachments, and track follow-ups.

This project is a set of interactive prototypes (Design Components — self-contained `.dc.html` files) rather than a deployed product.

## Files

**Landing pages**
- `Internship Desk v4.dc.html` — current landing page. Clean, professional light UI (Inter font, blue accent, white cards).
- `Internship Desk v3.dc.html` — dark, animated, motion-heavy design (scroll-tied product demo, pinned "how it works" section, cursor-reactive cards).
- `Internship Desk v2.dc.html` — warm-paper/newspaper-style design (serif headlines, ruled tables, ink + accent color).
- `Internship Desk.dc.html` — original landing page, plain light UI.

**App prototype**
- `Internship Desk App v4.dc.html` — working prototype, in progress restyle to match the v4 professional look (sidebar and page headers done; job list, CV cards, compose panel, tracker and follow-up cards still carry the v2 newspaper styling).
- `Internship Desk App v2.dc.html` — working prototype matching the v2 newspaper look. Screens: Discover, CV library, Compose, Tracker, Follow-ups.
- `Internship Desk App.dc.html` — same prototype, original light UI.

Landing pages link to their matching app version via "Open the desk."

Open any `.dc.html` file directly in a browser to view/interact with it. Landing pages link to the app via "Open the desk."

## Features in the app prototype

- **Discover** — sample job postings ranked by match score against the user's CVs; filter by remote/match strength; select a job to see its required stack and per-CV match breakdown.
- **CV library** — example CVs (Backend & Systems, Machine Learning, Product/Frontend) with skills and usage stats.
- **Compose** — pick a job, CV, and tone; generates a real cover letter and email via Claude, grounded in the CV and job description; everything is editable; "Create Gmail draft" simulates saving a draft with both PDFs attached.
- **Tracker** — kanban-style board (Saved → Drafted → Applied → Interview → Offer → Closed) with manual stage controls.
- **Follow-ups** — surfaces applications with no reply after 7 days or interviews needing a thank-you, and drafts that message with AI.

## Notes / limitations

- All job listings, the student profile, and CVs are placeholder/sample data.
- No real Gmail integration — "Create Gmail draft" only updates the in-app tracker, it does not create an actual Gmail draft.
- Cover letter and email generation calls Claude live from the browser; other content is static/simulated.
