/** Which external search sources are actually configured — never fake results. */

export type SourceId = "ats" | "careers" | "ashby" | "linkedin" | "indeed";

export type SourceCapability = {
  id: SourceId;
  label: string;
  available: boolean;
  reason: string;
};

export function listSourceCapabilities(): SourceCapability[] {
  const apifyToken =
    process.env.LINKEDIN_ACCESS_TOKEN?.trim() ||
    process.env.APIFY_TOKEN?.trim() ||
    process.env.APIFY_API_TOKEN?.trim();
  const linkedinActor = process.env.APIFY_LINKEDIN_JOBS_ACTOR?.trim();
  const indeedActor = process.env.APIFY_INDEED_JOBS_ACTOR?.trim();

  return [
    {
      id: "ats",
      label: "Greenhouse, Lever, Workable",
      available: true,
      reason: "Offres publiques des entreprises enregistrées.",
    },
    {
      id: "careers",
      label: "Pages carrières",
      available: true,
      reason: "Lues pendant la recherche entreprise, pour les contacts et les faits publiés.",
    },
    {
      id: "ashby",
      label: "Ashby",
      available: true,
      reason: "Offres publiques des entreprises qui utilisent Ashby.",
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      available: Boolean(apifyToken && linkedinActor),
      reason:
        apifyToken && linkedinActor
          ? "Via ton acteur Apify. Annonces publiques seulement, sans connexion LinkedIn."
          : "Non configuré. Renseigne APIFY_TOKEN et APIFY_LINKEDIN_JOBS_ACTOR.",
    },
    {
      id: "indeed",
      label: "Indeed",
      available: Boolean(apifyToken && indeedActor),
      reason:
        apifyToken && indeedActor
          ? "Via ton acteur Apify. Annonces publiques seulement, sans connexion Indeed."
          : "Non configuré. Indeed n'a plus d'API publique, renseigne APIFY_TOKEN et APIFY_INDEED_JOBS_ACTOR.",
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
