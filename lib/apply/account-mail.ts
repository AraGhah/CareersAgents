// An account on an employer portal usually has to be verified through a link (or a short code) mailed to the address it was
// created with. This reads the mailbox the desk is already connected to (Gmail, readonly) for exactly that one thing: a
// link or a code in a message that arrived after the account was created. It stores nothing from the message, and it
// accepts a link only when:
//   - the message arrived after the account was created (a minute of slack for clock drift),
//   - it reads like a verification message,
//   - the link goes to the portal's own site or to a known application system (Workday, iCIMS...), never anywhere else,
//   - and it is not an unsubscribe, privacy or terms link.
// A code is accepted only from a message that reads like verification and was sent by the portal's own site or a known
// application system (the sender's domain), never from any other mail that happens to hold digits.

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
  // Workday prints its activation link as bare text inside the HTML, with no <a> and no text part (abb.wd3, 2026-10-06).
  const htmlText = message.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  for (const m of htmlText.matchAll(/https?:\/\/[^\s<>"')]+/gi)) out.push({ url: m[0].replace(/[.,;]+$/, ""), text: "" });
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

const CODE_CUE = /\b(code|passcode|otp|pin)\b|code (de )?(v[ée]rification|confirmation|s[ée]curit[ée]|acc[eè]s)|mot de passe (à|a) usage unique/i;

function senderHost(from: string): string | null {
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).trim().toLowerCase().replace(/[>\s].*$/, "") : null;
}

/**
 * The one-time code in these messages (4 to 8 digits, or 6 to 8 letters and digits printed on their own), or null. Only a
 * fresh message that reads like a code message, from the portal's own domain or a known application system.
 */
export function pickVerificationCode(messages: MailMessage[], portalHost: string, sinceMs: number): string | null {
  const portal = registrable(portalHost);
  const fresh = messages.filter((m) => m.receivedMs >= sinceMs - 60_000).sort((a, b) => b.receivedMs - a.receivedMs);
  for (const message of fresh) {
    const sender = senderHost(message.from);
    if (!sender || !(registrable(sender) === portal || APPLICATION_SYSTEMS.test(sender))) continue;
    const html = message.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|td|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ");
    const text = [message.subject, message.text, html].join("\n").replace(/[ \t]+/g, " ");
    if (!CODE_CUE.test(text) && !VERIFY_CUE.test(message.subject)) continue;
    // The code printed right after the words that announce it, then a code standing alone on its own line.
    const near = text.match(
      /\b(?:code|passcode|otp|pin|usage unique)\b(?:\s+(?:de\s+|d['’])?(?:v[ée]rification|verification|confirmation|s[ée]curit[ée]|security|acc[eè]s|access))?[^\n0-9A-Za-z]{0,40}?(?:is|est)?[^\n0-9A-Za-z]{0,10}\b([0-9]{4,8}|(?=[A-Z0-9]*[0-9])[A-Z0-9]{6,8})\b/i,
    );
    if (near) return near[1];
    // A code printed on a line of its own: digits, or capitals and digits (never a plain word).
    const alone = text.split("\n").map((l) => l.trim()).find((l) => /^[0-9]{4,8}$/.test(l) || /^(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8}$/.test(l));
    if (alone) return alone;
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
 * Polls the mailbox for messages newer than `sinceMs` until `pick` finds what it wants, at most `timeoutMs` (90 s by
 * default). Bounded on purpose: a portal that never mails gives the run back, it does not hang it.
 */
async function pollMailbox<T>(pick: (messages: MailMessage[]) => Promise<T | null> | T | null, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<T | null> {
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
    const found = await pick([...seen.values()]);
    if (found !== null) return found;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 6000));
  }
  return null;
}

/**
 * Waits for the verification link of an account just created on `host`, polling the mailbox. Null when none arrives in time.
 * Only messages newer than `sinceMs` are looked at, and only their links are read.
 */
export async function gmailVerificationLink(host: string, sinceMs: number, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<string | null> {
  return pollMailbox(async (messages) => {
    const link = pickVerificationLink(messages, host, sinceMs);
    // A link from a mailbox is opened in the desk's browser: only one that leads to a public site.
    return link && (await isPublicUrl(link)) ? link : null;
  }, opts);
}

/** Waits for the one-time code the portal on `host` mailed after `sinceMs`. Null when none arrives in time. */
export async function gmailVerificationCode(host: string, sinceMs: number, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<string | null> {
  return pollMailbox((messages) => pickVerificationCode(messages, host, sinceMs), opts);
}
