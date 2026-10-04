import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

// Readonly + compose only. gmail.send is intentionally absent.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/** Desk owner's Gmail — used for OAuth context / From checks. */
export function getGmailUserEmail(): string {
  return (
    process.env.GMAIL_USER_EMAIL?.trim() ||
    "ara.ghahramanyan07@gmail.com"
  );
}

const TOKEN_PATH = path.join("cache", "gmail-token.json");

export type GmailTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is missing. Copy .env.example → .env.local and set the Gmail OAuth client values.`,
    );
  }
  return value;
}

export function createOAuthClient(redirectUriOverride?: string) {
  const clientId = requireEnv("GMAIL_CLIENT_ID");
  const clientSecret = requireEnv("GMAIL_CLIENT_SECRET");
  const redirectUri =
    redirectUriOverride ||
    process.env.GMAIL_REDIRECT_URI?.trim() ||
    "http://127.0.0.1:53682/oauth2callback";
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function loadTokens(): Promise<GmailTokens | null> {
  try {
    return JSON.parse(await readFile(TOKEN_PATH, "utf8")) as GmailTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: GmailTokens) {
  await mkdir(path.dirname(TOKEN_PATH), { recursive: true });
  // Readable by this user only (POSIX; on Windows the folder's own permissions apply).
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function getAuthorizedClient() {
  const client = createOAuthClient();
  const tokens = await loadTokens();
  if (!tokens?.refresh_token && !tokens?.access_token) {
    throw new Error("Gmail is not authorized yet. Run: npm run gmail:auth");
  }
  client.setCredentials(tokens);
  client.on("tokens", (fresh) => {
    const merged = { ...tokens, ...fresh };
    void saveTokens(merged);
  });
  return client;
}

export async function getGmail(): Promise<gmail_v1.Gmail> {
  const auth = await getAuthorizedClient();
  return google.gmail({ version: "v1", auth });
}

/**
 * One-time local OAuth. Opens a tiny HTTP listener for the redirect callback.
 *
 * Without an explicit GMAIL_REDIRECT_URI, this binds to port 0 (OS-assigned)
 * rather than a fixed port: Windows setups with Hyper-V/WSL2/Docker Desktop
 * carve out large, shifting TCP port-exclusion ranges, and a hardcoded port
 * that works today can start failing with EACCES tomorrow once one of those
 * ranges moves onto it. Google's "Desktop app" OAuth client type supports any
 * 127.0.0.1 loopback port without pre-registering it, so a dynamic port is
 * both simpler and immune to that class of failure.
 */
export async function runLocalAuth(): Promise<GmailTokens> {
  const explicitRedirectUri = process.env.GMAIL_REDIRECT_URI?.trim();
  const host = explicitRedirectUri ? new URL(explicitRedirectUri).hostname : "127.0.0.1";
  const listenHost = host === "localhost" ? "127.0.0.1" : host;
  const listenPort = explicitRedirectUri ? Number(new URL(explicitRedirectUri).port || 80) : 0;

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : listenPort;
  const redirectUri = explicitRedirectUri || `http://${listenHost}:${actualPort}/oauth2callback`;
  const callbackPath = new URL(redirectUri).pathname;

  const client = createOAuthClient(redirectUri);
  // Ties the callback to this sign-in: a code delivered by any other page (someone else's account) is refused.
  const state = randomBytes(24).toString("hex");
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });

  console.log("Open this URL, sign in, and approve readonly + compose:\n");
  console.log(authUrl);
  console.log("");

  const tokens = await new Promise<GmailTokens>((resolve, reject) => {
    server.on("request", async (req, res) => {
      try {
        if (!req.url?.startsWith(callbackPath)) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const incoming = new URL(req.url, redirectUri);
        const code = incoming.searchParams.get("code");
        const err = incoming.searchParams.get("error");
        if (incoming.searchParams.get("state") !== state) {
          // Not this sign-in's callback: answered and ignored, the listener keeps waiting for the real one.
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("This authorization does not belong to the sign-in started in the terminal.");
          return;
        }
        if (err) throw new Error(`OAuth error: ${err}`);
        if (!code) throw new Error("OAuth callback missing code");
        const result = await client.getToken(code);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("Authorized. You can close this tab and return to the terminal.");
        server.close();
        resolve(result.tokens);
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(e instanceof Error ? e.message : String(e));
        server.close();
        reject(e);
      }
    });
  });

  await saveTokens(tokens);
  return tokens;
}

export function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  const hit = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() || "";
}

export function extractEmailAddress(fromHeader: string): string | null {
  const angle = fromHeader.match(/<([^>]+)>/);
  const raw = (angle?.[1] ?? fromHeader).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw;
}

export function extractDomain(fromHeader: string): string | null {
  const email = extractEmailAddress(fromHeader);
  if (!email) return null;
  return email.split("@")[1] ?? null;
}

export function websiteHost(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website.includes("://") ? website : `https://${website}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function domainsMatch(senderDomain: string, companyHost: string): boolean {
  const a = senderDomain.toLowerCase().replace(/^www\./, "");
  const b = companyHost.toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export type GmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

/**
 * A header value on one line. A line break inside one (a job title scraped with a newline in it) would end the header
 * and start another, such as a Bcc nobody asked for; control characters go the same way.
 */
export function oneLineHeader(value: string): string {
  return value.replace(/[\r\n\t\v\f\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * RFC 2822 header fields are US-ASCII by default — the message's
 * `charset="UTF-8"` declaration only covers the body, never headers. An
 * unencoded em dash or accented character in the Subject line renders as
 * mojibake in most clients unless it's wrapped as an RFC 2047 encoded-word.
 */
function encodeHeaderValue(raw: string): string {
  const value = oneLineHeader(raw);
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** A recipient: one plain address, never a header line of its own. */
function recipientHeader(to: string): string {
  const value = oneLineHeader(to);
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(value)) throw new Error(`Invalid recipient address: ${value.slice(0, 80)}`);
  return value;
}

function wrapBase64(value: string): string {
  return value.replace(/(.{76})/g, "$1\r\n");
}

/**
 * The message as RFC 2822 text. A draft does not need a recipient (Gmail lets you fill it in), so `to`
 * is optional; an attachment's filename is encoded as an RFC 2047 word when it is not plain ASCII.
 */
export function buildRawMessage(opts: {
  to?: string;
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
}): string {
  const attachments = opts.attachments ?? [];
  const headers = [
    ...(opts.to ? [`To: ${recipientHeader(opts.to)}`] : []),
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    "MIME-Version: 1.0",
  ];

  if (attachments.length === 0) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      opts.body,
    ].join("\r\n");
  }

  const boundary = `----=_InternshipDesk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.body,
    "",
  ];
  for (const att of attachments) {
    // Plain-ASCII name for old clients, and the real one (accents included) as an RFC 2231 parameter.
    const name = oneLineHeader(att.filename);
    const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "'") || "attachment";
    const utf8 = `UTF-8''${encodeURIComponent(name)}`;
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(att.contentType) ? att.contentType : "application/octet-stream";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${contentType}; name="${ascii}"; name*=${utf8}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${ascii}"; filename*=${utf8}`,
      "",
      wrapBase64(att.content.toString("base64")),
      "",
    );
  }
  parts.push(`--${boundary}--`);

  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

function encodeForGmail(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createDraft(opts: {
  to?: string;
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
}): Promise<string> {
  const gmail = await getGmail();
  const encoded = encodeForGmail(buildRawMessage(opts));

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encoded } },
  });
  const id = draft.data.id;
  if (!id) throw new Error("Gmail draft create returned no id");
  return id;
}

/** True once `npm run gmail:auth` has stored a token. Says nothing about whether it is still accepted. */
export async function gmailIsConnected(): Promise<boolean> {
  const tokens = await loadTokens();
  return Boolean(tokens?.refresh_token || tokens?.access_token);
}

/**
 * Asks Google whose mailbox the stored token opens. gmailIsConnected() only says a token file exists; this says
 * whether Google still accepts it (a refresh token that was revoked or expired answers "invalid_grant").
 */
export async function gmailWorks(): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const gmail = await getGmail();
    await gmail.users.getProfile({ userId: "me" });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Google refused the stored authorization itself (revoked, expired, wrong client): only `npm run gmail:auth` fixes it. */
export function isAuthRejection(message: string): boolean {
  return /not authorized|invalid_grant|unauthorized_client|No refresh token|invalid_client|insufficient (authentication|permission)/i.test(
    message,
  );
}

/** "off": never connected. "reconnect": a token is stored but Google no longer accepts it. "ok": usable (or not provably broken). */
export type GmailStatus = "off" | "reconnect" | "ok";

let statusCache: { key: string; at: number; value: GmailStatus } | null = null;

/**
 * What the page should believe about Gmail. gmailIsConnected() only sees that a token file exists, so a revoked
 * token still read as "connected" and the draft button failed only after a click. This asks Google, but only counts
 * a rejection of the authorization itself as broken: a network blip says "ok" and the click shows the real error.
 * Remembered for a minute per stored refresh token, so a fresh `gmail:auth` is picked up at once.
 */
export async function gmailStatus(): Promise<GmailStatus> {
  const tokens = await loadTokens();
  const key = tokens?.refresh_token || tokens?.access_token;
  if (!key) return "off";
  if (statusCache && statusCache.key === key && Date.now() - statusCache.at < 60_000) return statusCache.value;

  const check = await gmailWorks();
  const value: GmailStatus = check.ok || !isAuthRejection(check.reason) ? "ok" : "reconnect";
  statusCache = { key, at: Date.now(), value };
  return value;
}

export function isNotFound(err: unknown): boolean {
  const e = err as { code?: number | string; response?: { status?: number } };
  return e?.code === 404 || e?.code === "404" || e?.response?.status === 404;
}

/**
 * Creates the draft, or replaces the one already made for this application (drafts.update swaps the whole
 * message, attachments included), so pressing the button again after regenerating refreshes the same draft
 * instead of piling up copies. If that draft was since deleted or sent in Gmail, a new one is created.
 * Needs only the gmail.compose scope; nothing is ever sent.
 */
export async function saveDraft(opts: {
  to?: string;
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
  draftId?: string | null;
}): Promise<{ draftId: string; messageId: string | null; updated: boolean }> {
  const gmail = await getGmail();
  const raw = encodeForGmail(buildRawMessage(opts));

  if (opts.draftId) {
    try {
      const res = await gmail.users.drafts.update({
        userId: "me",
        id: opts.draftId,
        requestBody: { id: opts.draftId, message: { raw } },
      });
      return { draftId: res.data.id ?? opts.draftId, messageId: res.data.message?.id ?? null, updated: true };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  const created = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  if (!created.data.id) throw new Error("Gmail draft create returned no id");
  return { draftId: created.data.id, messageId: created.data.message?.id ?? null, updated: false };
}

export async function deleteDraft(draftId: string): Promise<void> {
  const gmail = await getGmail();
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}

/** Explicit send — only used after user approval when GMAIL_ALLOW_SEND=true. */
export async function sendMail(opts: {
  to: string;
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
}): Promise<string> {
  const gmail = await getGmail();
  const encoded = encodeForGmail(buildRawMessage(opts));

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
  const id = sent.data.id;
  if (!id) throw new Error("Gmail send returned no id");
  return id;
}
