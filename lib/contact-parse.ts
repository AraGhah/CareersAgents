// The parts of finding a company's application email that need neither the network nor the
// database: pulling addresses out of a page, deciding which ones are worth writing to, and
// recognising whether a page belongs to the company. lib/contact-discovery.ts does the fetching.
//
// The rule from the README still holds: an address is only ever one that a page publishes.
// Nothing here builds an address from a pattern.

/** Where a job is hosted is not where the company is: these are application systems and job boards. */
const ATS_HOST =
  /(?:^|\.)(?:myworkdayjobs|workday|greenhouse|lever|icims|smartrecruiters|taleo|oraclecloud|successfactors|jobvite|bamboohr|ashbyhq|indeed|linkedin|glassdoor|workable|recruitee|teamtailor|breezy|jazz|applytojob|paylocity|ultipro|dayforce|adp|cornerstoneondemand|jobs\.lever|rippling|hirebridge|talentlyft|njoyn|clearcompany|apply\.workable|jobboom|workopolis|emploiquebec|guichetemplois|monster|ziprecruiter|simplyhired|careerbuilder|google|facebook|apify)\./i;

export function isAtsHost(host: string): boolean {
  return ATS_HOST.test(`${host.toLowerCase()}.`) || ATS_HOST.test(`.${host.toLowerCase()}.`);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The company's own site as found in a job posting URL, or null when the posting lives on an ATS or job board. */
export function companySiteFromPosting(postingUrl: string | null): string | null {
  if (!postingUrl) return null;
  const host = hostOf(postingUrl);
  if (!host || isAtsHost(host)) return null;
  // careers.genetec.com -> genetec.com: drop one leading label when three or more remain.
  const parts = host.split(".");
  const root = parts.length > 2 && !/^(co|com|org|net|gov|qc|on|bc|ab)$/.test(parts[parts.length - 2]) ? parts.slice(-2) : parts.slice(-3);
  return `https://${root.join(".")}`;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAME_NOISE = new Set([
  "inc", "ltd", "ltee", "llc", "corp", "corporation", "co", "company", "canada", "canadian", "group", "groupe",
  "the", "and", "of", "et", "de", "du", "la", "le", "les", "international", "limited",
  // What a company does is not what identifies it: "Matrox Graphics" is matrox.
  "graphics", "technologies", "technology", "systems", "solutions", "software", "services", "financial",
  "insurance", "assurance",
]);

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The words of a company name that identify it: "Hydro Québec" -> hydro, quebec; "BDO Canada" -> bdo. */
export function companyTokens(name: string): string[] {
  const first = name.split(/\s[|/]\s|\s-\s/)[0] ?? name;
  const words = normalize(first)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((w) => !NAME_NOISE.has(w));
  return (meaningful.length ? meaningful : words).slice(0, 3);
}

/** Domains worth trying for a company whose website we do not know, most likely first. */
export function nameDomainCandidates(name: string): string[] {
  const tokens = companyTokens(name);
  if (tokens.length === 0) return [];
  const variants = [...new Set([tokens.join(""), tokens[0], tokens.join("-")])].filter((v) => v.length >= 3);
  const tlds = /canad|qu[eé]bec|montr[eé]al/i.test(name) ? ["ca", "com"] : ["com", "ca"];
  const out: string[] = [];
  for (const tld of tlds) for (const v of variants) out.push(`https://${v}.${tld}`);
  return out;
}

function pageTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  return normalize(`${title} ${site}`.replace(/&amp;/g, "&"));
}

/**
 * Does this page belong to the company? Its first identifying word has to be in the page title (or the
 * site name), or appear repeatedly at the top of the page. Guessing a domain from a name is only safe
 * with this check: pomerleau.com might be someone else.
 */
export function pageMatchesCompany(html: string, companyName: string): boolean {
  const primary = companyTokens(companyName)[0];
  if (!primary || primary.length < 2) return false;
  if (pageTitle(html).includes(primary)) return true;
  const head = normalize(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")).slice(0, 6000);
  return head.split(primary).length - 1 >= 3;
}

/**
 * A guessed domain can belong to another brand (giro.com is not GIRO, the Montréal software company; a
 * page titled "Flare" can sit on snagged.com). So the address the page finally lands on has to carry the
 * company's name, and the pages read have to show a Québec connection: a .ca domain, or Québec, Montréal or
 * another Québec city on one of them (these are internships in Montréal and Laval).
 */
export function hostCarriesName(finalUrl: string, companyName: string): boolean {
  const tokens = companyTokens(companyName);
  const host = hostOf(finalUrl)?.replace(/[^a-z0-9]/g, "");
  // Every identifying word has to be in the domain: hydro.com is not Hydro Québec (hydroquebec.com).
  return Boolean(host && tokens.length && tokens.every((t) => host.includes(t)));
}

export function looksQuebecois(html: string, finalUrl: string): boolean {
  if (/\.ca$/.test(hostOf(finalUrl) ?? "")) return true;
  const text = normalize(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " "));
  return /\b(quebec|montreal|laval|gatineau|sherbrooke|longueuil|dorval|saint-laurent|trois-rivieres|levis)\b/.test(text);
}

/**
 * Do the pages read, taken together, look like a company this application could be for? True when one
 * points to Québec, mentions Canada, or is largely about software and technology (the roles are software
 * internships). A namesake from another world (a cycling-helmet brand at giro.com) shows none of these.
 */
export function corroboratesCompany(pages: Array<{ url: string; html: string }>): boolean {
  if (pages.some((p) => looksQuebecois(p.html, p.url))) return true;
  const text = normalize(
    pages.map((p) => p.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")).join(" "),
  );
  if (/\bcanad/.test(text)) return true;
  return (text.match(/\b(?:software|logiciel|engineer|ingenieur|technology|technologie)/g) ?? []).length >= 5;
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

/** Cloudflare hides addresses as `data-cfemail="<hex>"`: the first byte is the key, the rest is XORed with it. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{6,}$/i.test(hex) || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out.toLowerCase() : null;
}

const NOT_AN_ADDRESS_TLD = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|woff2?|ttf|eot|pdf|html?)$/i;
const NOISE_DOMAIN =
  /(?:example\.|domain\.|email\.com|sentry|wixpress|cloudflare|googleusercontent|w3\.org|schema\.org|yourcompany|yourdomain|test\.com|sample\.|placeholder|mydomain|username|\.local$)/i;
const NOISE_LOCAL =
  /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|hostmaster|abuse|privacy|legal|dpo|security|webmaster|unsubscribe|press|media|presse|medias|investor\w*|ir|accessibility|accessibilite|copyright|compliance|whistle\w*|ethics|etique|sentry|billing|invoices?|factur\w*|accounts?payable|ap|sales|ventes|marketing|newsletter|notifications?|alerts?|communications?|comms|help|helpdesk|support|services?|customer\w*|feedback|complaints?|donations?|events?|alumni|webinars?|cpe|shipping|orders?|returns?|partners?|partnerships?|vendors?|suppliers?|procurement|purchasing)$/i;

export function isUsableEmail(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain || !domain.includes(".")) return false;
  if (NOT_AN_ADDRESS_TLD.test(domain) || NOISE_DOMAIN.test(domain) || NOISE_LOCAL.test(local)) return false;
  return local.length <= 64 && /^[a-z0-9]/.test(local);
}

/**
 * Text around an address that says it is not where an application goes: accessibility and accommodation
 * requests (job postings are full of them), privacy, fraud and press contacts.
 */
const NOT_FOR_APPLICATIONS =
  /accommodat|accessib|disabilit|special assistance|accommodement|handicap|besoins? (?:particuliers|sp[eé]cifiques)|privacy|confidentialit|unsubscribe|d[eé]sabonn|whistle|lanceur d.alerte|report (?:a )?(?:concern|violation)|fraud|scam|phishing|media inquir|press inquir|investor/i;

/**
 * Every address a page publishes, except those printed in a context that says they are for something
 * else: mailto links, Cloudflare-protected ones, and plain text.
 */
export function extractEmails(html: string): string[] {
  const decoded = html
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#0*64;|&#x0*40;|&commat;|%40/gi, "@")
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, ".")
    // Bring addresses that live in attributes into the text, so they can be read with their surroundings.
    .replace(/<[^>]*data-cfemail=["']([0-9a-f]+)["'][^>]*>/gi, (_, hex: string) => ` ${decodeCfEmail(hex) ?? ""} `)
    .replace(/<a\b[^>]*href=["']mailto:([^"'?&]+)[^>]*>/gi, (_, addr: string) => {
      try {
        return ` ${decodeURIComponent(addr)} `;
      } catch {
        return ` ${addr} `;
      }
    })
    .replace(/mailto:([^"'<>\s?&]+)/gi, (_, addr: string) => {
      try {
        return ` ${decodeURIComponent(addr)} `;
      } catch {
        return ` ${addr} `;
      }
    });
  // Block-level tags end a thought; inline ones (links, bold) do not, so "…send your request to <a>x@y.com</a>"
  // keeps its sentence.
  const plain = decoded
    .replace(/<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(?:p|div|li|ul|ol|br|h[1-6]|section|article|tr|td|th|table|header|footer|nav|main|blockquote)\b[^>]*>/gi, " ¶ ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const found = new Set<string>();
  for (const m of plain.matchAll(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) {
    const at = m.index ?? 0;
    // The address's own sentence: back to the last block break or full stop, forward to the next.
    const before = plain.slice(Math.max(0, at - 320), at);
    const start = Math.max(before.lastIndexOf("¶"), ...[...before.matchAll(/[.!?]\s/g)].map((x) => x.index ?? -1)) + 1;
    const after = plain.slice(at + m[0].length, at + m[0].length + 160);
    const stop = after.search(/¶|[.!?]\s/);
    const sentence = `${before.slice(start)} ${m[0]} ${after.slice(0, stop === -1 ? after.length : stop)}`;
    if (NOT_FOR_APPLICATIONS.test(sentence)) continue;
    found.add(m[0].toLowerCase());
  }
  for (const email of extractJsonLdEmails(html)) found.add(email);
  return [...found].filter(isUsableEmail);
}

/**
 * Addresses a site publishes as structured data (schema.org JSON-LD, in a script the visible-text pass
 * skips), leaving out contact points for customers, sales, support and press.
 */
export function extractJsonLdEmails(html: string): string[] {
  const out: string[] = [];
  const NOT_FOR_HIRING = /customer|sales|support|press|media|billing|sponsor|client|ventes|presse/;
  const walk = (node: unknown, inherited: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, inherited));
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj.contactType ? normalize(String(obj.contactType)) : inherited;
    if (typeof obj.email === "string" && !NOT_FOR_HIRING.test(type)) {
      out.push(obj.email.replace(/^mailto:/i, "").trim().toLowerCase());
    }
    for (const value of Object.values(obj)) walk(value, type);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]), "");
    } catch {
      /* not valid JSON */
    }
  }
  return out;
}

/** Where a tiny "Redirection" page sends the browser (<meta http-equiv="refresh">), as an absolute URL. */
export function metaRefreshTarget(html: string, baseUrl: string): string | null {
  const tag = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i)?.[0] ?? "";
  const target = tag.match(/url=\s*['"]?([^'"\s>]+)/i)?.[1];
  if (!target) return null;
  try {
    return new URL(target, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * A page whose content is drawn by JavaScript after it loads: plenty of markup, almost no words. The
 * addresses on it exist only in a real browser.
 */
export function looksLikeJsShell(html: string): boolean {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return html.length > 15000 && text.length < 800;
}

/**
 * The domain alone can vouch for a multi-word name: hydroquebec.com carries both words of "Hydro Québec",
 * which the page title ("Redirection") need not. One-word names still need the title; hydro.com does not
 * vouch for anything.
 */
export function strongHostMatch(finalUrl: string, companyName: string): boolean {
  return companyTokens(companyName).length >= 2 && hostCarriesName(finalUrl, companyName);
}

export type ContactKind = "recruiting" | "generic" | "other";

const RECRUITING_LOCAL =
  /(?:^|[._-])(?:careers?|carri[eè]res?|jobs?|emplois?|recrut\w*|recruit\w*|talent\w*|hr|rh|people|humaine?s?|ressources|staffing|hiring|stages?|interns?|internships?|students?|etudiants?|campus|university|graduates?|early|apply|postuler|candidatures?)(?:[._-]|\d|$)/i;
const GENERIC_LOCAL =
  /^(?:info|infos|contact|contacts|hello|bonjour|hi|general|inquir\w*|admin|office|team|equipe|reception)$/i;

export function contactKind(email: string): ContactKind {
  const local = email.toLowerCase().split("@")[0] ?? "";
  if (RECRUITING_LOCAL.test(local)) return "recruiting";
  if (GENERIC_LOCAL.test(local)) return "generic";
  return "other";
}

/** Is the address the company's own? Its domain matches the site, or carries the company's name. */
export function isCompanyAddress(email: string, companyName: string, siteHost: string | null): boolean {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (siteHost) {
    const site = siteHost.replace(/^www\./, "");
    if (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)) return true;
  }
  const primary = companyTokens(companyName)[0];
  return Boolean(primary && primary.length >= 3 && domain.replace(/[^a-z0-9]/g, "").includes(primary));
}

export type FoundEmail = { email: string; kind: ContactKind; sourceUrl: string; score: number };

/**
 * A general inbox (info@, contact@) is a weak fallback and only worth offering when it is plainly the
 * company's own: on its exact domain (info@hr.ibm.com is IBM Croatia), on a page about contacting or
 * working for the company (not a product page: Intact's info@intact.net sat on an insurance page), and
 * not one of a directory of offices (several info@ addresses on one page).
 */
function isTrustworthyGeneral(email: string, page: { url: string; emails: string[] }, siteHost: string | null): boolean {
  const domain = email.split("@")[1] ?? "";
  if (!siteHost || domain !== siteHost.replace(/^www\./, "")) return false;
  if (!/contact|nous-joindre|joindre|carri|career|jobs|emploi|recrut|join|about|a-propos|company|entreprise|qui-sommes/i.test(new URL(page.url).pathname)) return false;
  return page.emails.filter((e) => contactKind(e) === "generic").length <= 2;
}

/**
 * The addresses worth offering, best first. A careers or recruiting inbox is what an application goes
 * to; a general inbox is a weaker fallback with stricter conditions. Personal and departmental addresses
 * are left out.
 */
export function rankFoundEmails(
  pages: Array<{ url: string; emails: string[] }>,
  companyName: string,
  siteHost: string | null,
  max = 4,
): FoundEmail[] {
  const best = new Map<string, FoundEmail>();
  for (const page of pages) {
    const careersPage = /career|carri|jobs|emploi|recrut|talent|student|intern|stage|campus/i.test(page.url);
    for (const email of page.emails) {
      if (!isCompanyAddress(email, companyName, siteHost)) continue;
      const kind = contactKind(email);
      // A named person or an odd department is not where an application goes.
      if (kind === "other") continue;
      if (kind === "generic" && !isTrustworthyGeneral(email, page, siteHost)) continue;
      const score = (kind === "recruiting" ? 10 : 3) + (careersPage ? 1 : 0);
      const known = best.get(email);
      if (!known || score > known.score) best.set(email, { email, kind, sourceUrl: page.url, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Pages to look at
// ---------------------------------------------------------------------------

/** Paths where companies usually publish a careers or contact address. */
export const CANDIDATE_PATHS = [
  "/contact",
  "/contact-us",
  "/contactez-nous",
  "/nous-joindre",
  "/careers",
  "/carrieres",
  "/jobs",
  "/join-us",
  "/about",
  "/en/careers",
  "/fr/carrieres",
  "/company/careers",
  "/students",
  "/campus",
  "/early-careers",
  "/stages",
];

const WORTH_FOLLOWING = /career|carri|jobs?\b|emploi|recrut|contact|nous-joindre|student|etudiant|intern|stage|campus|talent|join|work-with|travailler|ressources-humaines|human-resources/i;

/** Same-site links on a page that lead to careers or contact pages. */
export function linkTargets(html: string, baseUrl: string, max = 6): string[] {
  const baseHost = hostOf(baseUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const label = normalize(m[2].replace(/<[^>]+>/g, " "));
    if (/^(?:mailto:|tel:|javascript:)/i.test(href) || /\.(?:pdf|png|jpe?g|svg|zip|docx?)$/i.test(href)) continue;
    if (!WORTH_FOLLOWING.test(normalize(href)) && !WORTH_FOLLOWING.test(label)) continue;
    try {
      const url = new URL(href, baseUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== baseHost && !host.endsWith(`.${baseHost}`)) continue;
      url.hash = "";
      out.add(url.toString());
    } catch {
      /* not a URL */
    }
    if (out.size >= max) break;
  }
  return [...out];
}
