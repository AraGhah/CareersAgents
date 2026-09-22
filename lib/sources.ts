/** Which external search sources are actually configured — never fake results. */

export type SourceId = "ats" | "careers" | "ashby" | "linkedin" | "indeed";

export type SourceCapability = {
  id: SourceId;
  label: string;
  available: boolean;
  reason: string;
};

export function listSourceCapabilities(): SourceCapability[] {
  const linkedinToken =
    process.env.LINKEDIN_ACCESS_TOKEN?.trim() ||
    process.env.APIFY_TOKEN?.trim() ||
    process.env.APIFY_API_TOKEN?.trim();
  const linkedinActor = process.env.APIFY_LINKEDIN_JOBS_ACTOR?.trim();
  const indeedPublisher = process.env.INDEED_PUBLISHER_ID?.trim();

  return [
    {
      id: "ats",
      label: "ATS boards (Greenhouse / Lever / Workable / Ashby)",
      available: true,
      reason: "Public board JSON endpoints for seeded companies.",
    },
    {
      id: "careers",
      label: "Company careers pages",
      available: true,
      reason: "Used during dossier research to extract published contacts and facts.",
    },
    {
      id: "ashby",
      label: "Ashby job boards",
      available: true,
      reason: "Public posting-api job-board endpoint when ats=ashby + board_token.",
    },
    {
      id: "linkedin",
      label: "LinkedIn Jobs",
      available: Boolean(linkedinToken && linkedinActor),
      reason: linkedinToken && linkedinActor
        ? "Authorized via APIFY_TOKEN + APIFY_LINKEDIN_JOBS_ACTOR."
        : "Not configured. Set APIFY_TOKEN and APIFY_LINKEDIN_JOBS_ACTOR (or LINKEDIN_ACCESS_TOKEN) — no fake results.",
    },
    {
      id: "indeed",
      label: "Indeed",
      available: Boolean(indeedPublisher),
      reason: indeedPublisher
        ? "Authorized via INDEED_PUBLISHER_ID."
        : "Not configured. Set INDEED_PUBLISHER_ID for the official Publisher API — no fake results.",
    },
  ];
}

export function assistedModeDefault(): boolean {
  const raw = process.env.ASSISTED_MODE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/** Only when explicitly enabled — otherwise Approve creates a Gmail draft. */
export function gmailSendAllowed(): boolean {
  const raw = process.env.GMAIL_ALLOW_SEND?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
