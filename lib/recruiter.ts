import { pool } from "./db";
import { contactKind } from "./contact-parse";
import { discoverCompanyContacts, saveDiscovery } from "./contact-discovery";
import { listContactsForCompany } from "./queries";

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

export async function researchHiringContacts(opts: {
  companyId: string;
  companyName: string;
  website: string | null;
  /** The job posting: it can name an address, and it can lead to the company's own site. */
  postingUrl?: string | null;
}): Promise<{
  added: number;
  contacts: Awaited<ReturnType<typeof listContactsForCompany>>;
  hints: HiringContactHint[];
  pagesScanned: string[];
}> {
  const discovery = await discoverCompanyContacts({
    companyName: opts.companyName,
    website: opts.website,
    postingUrl: opts.postingUrl ?? null,
  });
  const added = await saveDiscovery(opts.companyId, opts.website, discovery);

  const contacts = await listContactsForCompany(opts.companyId);
  const hints = HIRING_ROLES.map((h) => ({
    ...h,
    searchHint: `${opts.companyName} ${h.searchHint}`,
  }));

  return { added, contacts, hints, pagesScanned: discovery.pagesScanned };
}

type RankableContact = {
  id: string;
  name: string | null;
  role: string | null;
  email: string | null;
  source_url: string;
  verified: boolean;
};

/** Contacts with an address, best first: a careers or recruiting inbox, then a general one. */
export function rankContacts<T extends RankableContact>(contacts: T[]): T[] {
  const withEmail = contacts.filter((c) => c.email && c.source_url);
  return [...withEmail].sort((a, b) => {
    const score = (c: (typeof withEmail)[0]) => {
      let s = 0;
      if (c.verified) s += 5;
      // A careers or recruiting inbox is where an application goes; a general inbox is a fallback.
      const kind = contactKind(c.email ?? "");
      if (kind === "recruiting") s += 6;
      else if (kind === "generic") s += 1;
      if (/career|talent|recruit|hr|jobs|stage|intern/i.test(c.role ?? "")) s += 2;
      if (/engineer|manager|technical/i.test(c.role ?? "")) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
}

export function pickBestContact<T extends RankableContact>(contacts: T[]): T | null {
  return rankContacts(contacts)[0] ?? null;
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
