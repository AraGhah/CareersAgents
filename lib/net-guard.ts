import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { BrowserContext } from "playwright";

// The desk opens addresses it did not choose: a pasted posting, a company website found in a scraped listing, the
// "apply" link of a job board, a link in an email. Each one is checked here first, so none of them can make this
// machine read its own services (the desk itself on :3001, Postgres, the router, a cloud metadata endpoint):
//   - http and https only
//   - every address the host resolves to must be a public one (no loopback, private, link-local, CGNAT, multicast...)
//   - redirects are followed one hop at a time, each hop checked again, and bodies are read up to a size limit.
// A host that resolves differently between the check and the request (DNS rebinding) is not caught by this alone; the
// browser guard below and the desk's own Host check (proxy.ts) are the other layers.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

function v4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** True for any address that is not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = v4Parts(ip);
    if (!p) return true;
    const [a, b] = p;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && p[2] === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (kind === 6) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = v6.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    // The same IPv4-mapped address as URL() writes it: [::ffff:127.0.0.1] → ::ffff:7f00:1.
    const mappedHex = v6.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (v6 === "::" || v6 === "::1") return true;
    const first = parseInt(v6.split(":")[0] || "0", 16);
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (first & 0xff00) === 0xff00 || // multicast
      v6.startsWith("64:ff9b:") // NAT64 can reach IPv4 private space
    );
  }
  return true;
}

const LOCAL_NAMES = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback)$|\.(localhost|local|internal|lan|home\.arpa)$/i;

/** The URL, parsed, when it is http(s) on a host that resolves only to public addresses. Throws BlockedUrlError otherwise. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`${url.protocol} links are not opened`);
  if (url.username || url.password) throw new BlockedUrlError("links with credentials are not opened");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || LOCAL_NAMES.test(host)) throw new BlockedUrlError(`${host || "this host"} is on this machine or its network`);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError(`${host} is a private address`);
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`${host} does not resolve`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError(`${host} points at a private address`);
  }
  return url;
}

/** True when the URL passes assertPublicUrl. */
export async function isPublicUrl(raw: string): Promise<boolean> {
  return assertPublicUrl(raw).then(
    () => true,
    () => false,
  );
}

export type SafeResponse = { status: number; ok: boolean; url: string; headers: Headers; text: string };

/**
 * fetch() for addresses the desk did not choose: every hop checked by assertPublicUrl, at most `maxRedirects` of them,
 * and the body cut at `maxBytes` (read as text). Network errors are thrown as fetch throws them.
 */
export async function safeFetch(
  raw: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<SafeResponse> {
  const maxBytes = init.maxBytes ?? 2_000_000;
  const signal = AbortSignal.timeout(init.timeoutMs ?? 12_000);
  let current = raw;
  for (let hop = 0; hop <= (init.maxRedirects ?? 5); hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { redirect: "manual", headers: init.headers, signal });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(location, url).toString();
      continue;
    }
    return { status: res.status, ok: res.ok, url: url.toString(), headers: res.headers, text: await readCapped(res, maxBytes) };
  }
  throw new BlockedUrlError("too many redirects");
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/**
 * Keeps a browser the desk drives off this machine's network: any request (page, frame, script, fetch) to a literal
 * private address or a local name is aborted. Names are not resolved per request (too slow); assertPublicUrl guards
 * the pages the desk itself opens.
 */
export async function blockPrivateNetwork(context: BrowserContext): Promise<void> {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    let host = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "data:" || parsed.protocol === "blob:") return route.continue();
      host = parsed.hostname.replace(/^\[|\]$/g, "");
    } catch {
      return route.abort("blockedbyclient");
    }
    if (LOCAL_NAMES.test(host) || (isIP(host) && isPrivateAddress(host))) return route.abort("blockedbyclient");
    return route.continue();
  });
}
