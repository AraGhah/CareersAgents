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

export function createOAuthClient() {
  const clientId = requireEnv("GMAIL_CLIENT_ID");
  const clientSecret = requireEnv("GMAIL_CLIENT_SECRET");
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI?.trim() || "http://127.0.0.1:53682/oauth2callback";
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
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf8");
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

/** One-time local OAuth. Opens a tiny HTTP listener on the redirect URI port. */
export async function runLocalAuth(): Promise<GmailTokens> {
  const client = createOAuthClient();
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI?.trim() || "http://127.0.0.1:53682/oauth2callback";
  const url = new URL(redirectUri);
  const port = Number(url.port || 80);

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });

  console.log("Open this URL, sign in, and approve readonly + compose:\n");
  console.log(authUrl);
  console.log("");

  const tokens = await new Promise<GmailTokens>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith(url.pathname)) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const incoming = new URL(req.url, redirectUri);
        const code = incoming.searchParams.get("code");
        const err = incoming.searchParams.get("error");
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
    server.listen(port, url.hostname === "localhost" ? "127.0.0.1" : url.hostname);
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

export async function createDraft(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<string> {
  const gmail = await getGmail();
  const raw = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encoded } },
  });
  const id = draft.data.id;
  if (!id) throw new Error("Gmail draft create returned no id");
  return id;
}

/** Explicit send — only used after user approval when GMAIL_ALLOW_SEND=true. */
export async function sendMail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<string> {
  const gmail = await getGmail();
  const raw = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
  const id = sent.data.id;
  if (!id) throw new Error("Gmail send returned no id");
  return id;
}
