// An account on an employer portal usually has to be verified through a link mailed to the address it was created with.
// This reads the mailbox the desk is already connected to (Gmail, readonly) for exactly that one thing: a link in a message
// that arrived after the account was created. It stores nothing from the message, and it accepts a link only when:
//   - the message arrived after the account was created (a minute of slack for clock drift),
//   - it reads like a verification message,
//   - the link goes to the portal's own site or to a known application system (Workday, iCIMS...), never anywhere else,
//   - and it is not an unsubscribe, privacy or terms link.

import { getGmail } from "../gmail";
import { isPublicUrl } from "../net-guard";
import { APPLICATION_SYSTEMS } from "./account-config";

export type MailMessage = { from: string; subject: string; receivedMs: number; text: string; html: string };

const VERIFY_CUE = /verif|confirm|activat|validat|v[ée]rifi|confirmer|activer|valider|registration|inscription/i;
const VERIFY_LINK = /verif|confirm|activat|validat|token|registration|register|account|activer|valider|inscription/i;
const NOT_A_LINK = /unsubscribe|d[ée]sabonn|privacy|confidentialit|terms|conditions|preferences|help|support|\.(?:png|jpe?g|gif|svg|css|js|ico)(?:\?|$)/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Second-level labels under which a country code registers names ("acme.co.uk", "acme.qc.ca", "acme.com.au"). */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "gouv", "ac", "edu", "ltd", "plc", "qc", "on", "bc", "ab", "mb", "ns", "nb"]);

/**
 * "autodesk.wd1.myworkdayjobs.com" → "myworkdayjobs.com", "careers.acme.co.uk" → "acme.co.uk": the name the site was
 * registered under. The last two labels alone would make every *.co.uk site the same one.
 */
export function registrable(host: string): string {
  const labels = host.split(".");
  const twoLetterTld = labels.at(-1)?.length === 2;
  const keep = labels.length >= 3 && twoLetterTld && SECOND_LEVEL.has(labels.at(-2) ?? "") ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function linksIn(message: MailMessage): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  for (const m of message.html.matchAll(/<a\b[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ url: m[1].replace(/&amp;/g, "&"), text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  for (const m of message.text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) out.push({ url: m[0].replace(/[.,;]+$/, ""), text: "" });
  return out;
}

/**
 * The verification link in these messages, or null. `portalHost` is the portal the account was made on; `sinceMs` is when
 * the account was created.
 */
export function pickVerificationLink(messages: MailMessage[], portalHost: string, sinceMs: number): string | null {
  const portal = registrable(portalHost);
  const fresh = messages.filter((m) => m.receivedMs >= sinceMs - 60_000).sort((a, b) => b.receivedMs - a.receivedMs);
  for (const message of fresh) {
    if (!VERIFY_CUE.test(`${message.subject} ${message.text.slice(0, 600)} ${message.html.replace(/<[^>]+>/g, " ").slice(0, 600)}`)) continue;
    for (const link of linksIn(message)) {
      const host = hostOf(link.url);
      if (!host || !/^https?:/i.test(link.url) || NOT_A_LINK.test(link.url)) continue;
      const ownSite = registrable(host) === portal || APPLICATION_SYSTEMS.test(host);
      if (!ownSite) continue;
      if (VERIFY_LINK.test(link.url) || VERIFY_CUE.test(link.text)) return link.url;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

type Part = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Part[] | null };

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function collect(part: Part | undefined, into: { text: string; html: string }) {
  if (!part) return;
  if (part.body?.data && part.mimeType === "text/plain") into.text += decode(part.body.data);
  if (part.body?.data && part.mimeType === "text/html") into.html += decode(part.body.data);
  for (const p of part.parts ?? []) collect(p, into);
}

/**
 * Waits for the verification link of an account just created on `host`, polling the mailbox. Null when none arrives in time.
 * Only messages newer than `sinceMs` are looked at, and only their links are read.
 */
export async function gmailVerificationLink(host: string, sinceMs: number, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<string | null> {
  const gmail = await getGmail();
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const seen = new Map<string, MailMessage>();
  while (Date.now() < deadline) {
    const { data } = await gmail.users.messages.list({ userId: "me", q: "newer_than:1d", maxResults: 10 });
    for (const { id } of data.messages ?? []) {
      if (!id || seen.has(id)) continue;
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const receivedMs = Number(res.data.internalDate ?? 0);
      const headers = res.data.payload?.headers ?? [];
      const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
      const body = { text: "", html: "" };
      collect(res.data.payload as Part | undefined, body);
      seen.set(id, { from: header("from"), subject: header("subject"), receivedMs, ...body });
    }
    const link = pickVerificationLink([...seen.values()], host, sinceMs);
    // A link from a mailbox is opened in the desk's browser: only one that leads to a public site.
    if (link && (await isPublicUrl(link))) return link;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 6000));
  }
  return null;
}
