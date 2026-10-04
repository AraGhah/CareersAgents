import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// The desk has no accounts: it is one person's tool, served on this machine only. This is the gate in front of every
// page, server action and file download:
//   - the Host header must name this machine (localhost, 127.0.0.1, ::1) or a host listed in DESK_ALLOWED_HOSTS. A web
//     page that points its own domain at 127.0.0.1 (DNS rebinding) arrives with its own Host and is turned away.
//   - a request that changes something (any method but GET/HEAD) must come from one of those origins.
//   - with DESK_ACCESS_TOKEN set, every request needs the cookie that opening /?token=<value> once sets. Set it if you
//     ever serve the desk beyond this machine (DESK_ALLOWED_HOSTS + `next dev -H 0.0.0.0`).
// Server actions check the same things inside themselves where it matters; this is the first layer, not the only one.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const COOKIE = "desk_token";

function allowedHosts(): Set<string> {
  const extra = (process.env.DESK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK, ...extra]);
}

/** "localhost:3001" → "localhost", "[::1]:3001" → "[::1]". */
function hostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1) || null;
  return h.split(":")[0] || null;
}

function originHost(origin: string | null): string | null {
  if (!origin || origin === "null") return null;
  try {
    const u = new URL(origin);
    return u.hostname.startsWith("[") ? u.hostname : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function deny(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export function proxy(request: NextRequest) {
  const hosts = allowedHosts();
  const host = hostname(request.headers.get("host"));
  if (!host || !hosts.has(host)) return deny(403, "This desk only answers on this machine (see DESK_ALLOWED_HOSTS).");

  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const from = originHost(origin);
    // A browser always sends Origin on a cross-site POST; a missing one is a same-origin form or a script on this machine.
    if (origin && (!from || !hosts.has(from))) return deny(403, "Cross-site request refused.");
  }

  const token = process.env.DESK_ACCESS_TOKEN?.trim();
  if (token) {
    const offered = request.nextUrl.searchParams.get("token");
    if (offered && sameSecret(offered, token)) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete("token");
      const res = NextResponse.redirect(clean);
      res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", secure: request.nextUrl.protocol === "https:" });
      return res;
    }
    const cookie = request.cookies.get(COOKIE)?.value;
    if (!cookie || !sameSecret(cookie, token)) return deny(401, "Open the desk once with ?token=<DESK_ACCESS_TOKEN>.");
  }

  return NextResponse.next();
}
