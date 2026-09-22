import { pool } from "./db";
import { addVerifiedContact, listContactsForCompany } from "./queries";
import { extractPublishedEmails } from "./research";

export type HiringContactHint = {
  role: string;
  why: string;
  searchHint: string;
};

export const HIRING_ROLES: HiringContactHint[] = [
  {
    role: "Technical Recruiter",
    why: "Screens software / full-stack internship candidates.",
    searchHint: '"Technical Recruiter" OR "Tech Recruiter"',
  },
  {
    role: "Talent Acquisition",
    why: "Owns campus / internship pipelines.",
    searchHint: '"Talent Acquisition" OR "University Relations"',
  },
  {
    role: "Recruiter",
    why: "General recruiting contact for open roles.",
    searchHint: "Recruiter internship OR stage",
  },
  {
    role: "HR / People",
    why: "Often listed on careers pages for student programs.",
    searchHint: "HR OR \"People Operations\" careers",
  },
  {
    role: "Engineering Manager",
    why: "Decides whether an intern joins the team.",
    searchHint: '"Engineering Manager" OR "Software Development Manager"',
  },
  {
    role: "Internship Recruiter / Coordinator",
    why: "Runs co-op / stage programs when present.",
    searchHint: '"Internship Coordinator" OR "Internship Recruiter" OR stage',
  },
];

async function fetchPage(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "InternshipDesk/0.1 (+recruiter research)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 40) return null;
    return { url: res.url || url, text: text.slice(0, 20000) };
  } catch {
    return null;
  }
}

function careersCandidates(website: string | null): string[] {
  if (!website) return [];
  try {
    const base = website.includes("://") ? website : `https://${website}`;
    const u = new URL(base);
    return [
      base,
      new URL("/careers", u.origin).toString(),
      new URL("/careers/", u.origin).toString(),
      new URL("/about", u.origin).toString(),
      new URL("/company/careers", u.origin).toString(),
      new URL("/en/careers", u.origin).toString(),
      new URL("/fr/carrieres", u.origin).toString(),
    ];
  } catch {
    return [];
  }
}

export async function researchHiringContacts(opts: {
  companyId: string;
  companyName: string;
  website: string | null;
}): Promise<{
  added: number;
  contacts: Awaited<ReturnType<typeof listContactsForCompany>>;
  hints: HiringContactHint[];
  pagesScanned: string[];
}> {
  const pagesScanned: string[] = [];
  let added = 0;

  for (const url of [...new Set(careersCandidates(opts.website))].slice(0, 5)) {
    const page = await fetchPage(url);
    if (!page) continue;
    pagesScanned.push(page.url);
    const found = extractPublishedEmails(page.text, page.url);
    for (const hit of found) {
      try {
        await addVerifiedContact({
          companyId: opts.companyId,
          name: null,
          role: hit.role,
          email: hit.email,
          sourceUrl: hit.source_url,
        });
        added += 1;
      } catch {
        /* duplicate / invalid */
      }
    }
  }

  const contacts = await listContactsForCompany(opts.companyId);
  const hints = HIRING_ROLES.map((h) => ({
    ...h,
    searchHint: `${opts.companyName} ${h.searchHint}`,
  }));

  return { added, contacts, hints, pagesScanned };
}

export function pickBestContact(
  contacts: Array<{
    id: string;
    name: string | null;
    role: string | null;
    email: string | null;
    source_url: string;
    verified: boolean;
  }>,
) {
  const withEmail = contacts.filter((c) => c.email && c.source_url);
  if (!withEmail.length) return null;
  const scored = [...withEmail].sort((a, b) => {
    const score = (c: (typeof withEmail)[0]) => {
      let s = 0;
      if (c.verified) s += 5;
      if (/career|talent|recruit|hr|jobs|stage|intern/i.test(`${c.role ?? ""} ${c.email}`)) s += 3;
      if (/engineer|manager|technical/i.test(c.role ?? "")) s += 2;
      return s;
    };
    return score(b) - score(a);
  });
  return scored[0] ?? null;
}

export async function logWorkflow(
  applicationId: string,
  stage: string,
  ok: boolean,
  detail?: string,
) {
  await pool.query(
    `INSERT INTO workflow_runs (application_id, stage, ok, detail) VALUES ($1, $2, $3, $4)`,
    [applicationId, stage, ok, detail ?? null],
  );
}
