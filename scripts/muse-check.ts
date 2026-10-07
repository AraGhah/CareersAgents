// Offline checks of the desk's side of the Muse gadget link (lib/notify/muse.ts): no Pi, no Muse, no database. A fake
// bridge on 127.0.0.1 stands in for muse/desk_bridge.py.
//   npm run muse:check

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { bridgeConfig, dailyRunMessage, inboxMessage, MAX_TEXT, postToBridge } from "../lib/notify/muse";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

type Seen = { auth: string | undefined; path: string | undefined; body: Record<string, unknown> };

async function fakeBridge(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function main() {
  // Configuration
  check("unset → off", bridgeConfig({}) === null);
  check("URL without token → off", bridgeConfig({ MUSE_BRIDGE_URL: "http://pi.local:8788" }) === null);
  check("non-http URL → off", bridgeConfig({ MUSE_BRIDGE_URL: "file:///etc/passwd", MUSE_BRIDGE_TOKEN: "t" }) === null);
  check("bad URL → off", bridgeConfig({ MUSE_BRIDGE_URL: "not a url", MUSE_BRIDGE_TOKEN: "t" }) === null);
  check(
    "bare host → /event",
    bridgeConfig({ MUSE_BRIDGE_URL: "http://pi.local:8788", MUSE_BRIDGE_TOKEN: "t" })?.url === "http://pi.local:8788/event",
  );
  check(
    "explicit path kept",
    bridgeConfig({ MUSE_BRIDGE_URL: "https://pi.local/desk/event", MUSE_BRIDGE_TOKEN: "t" })?.url === "https://pi.local/desk/event",
  );

  // Delivery
  const seen: Seen[] = [];
  const ok = await fakeBridge((req, res, body) => {
    seen.push({ auth: req.headers.authorization, path: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, delivered: true }));
  });
  const config = bridgeConfig({ MUSE_BRIDGE_URL: ok.base, MUSE_BRIDGE_TOKEN: "s3cret" });
  const sent = await postToBridge({ kind: "test", text: "x".repeat(MAX_TEXT + 500), snapshot: null }, config);
  check("delivered", sent.ok, sent.detail);
  check("bearer token sent", seen[0]?.auth === "Bearer s3cret", String(seen[0]?.auth));
  check("posted to /event", seen[0]?.path === "/event", String(seen[0]?.path));
  check("kind sent", seen[0]?.body.kind === "test");
  check("text clipped", typeof seen[0]?.body.text === "string" && (seen[0].body.text as string).length === MAX_TEXT);
  check("sent_at stamped", typeof seen[0]?.body.sent_at === "string");
  ok.server.close();

  const refused = await fakeBridge((_req, res) => res.writeHead(401).end('{"ok":false,"error":"invalid token"}'));
  const no = await postToBridge({ kind: "test", text: "hi", snapshot: null }, bridgeConfig({ MUSE_BRIDGE_URL: refused.base, MUSE_BRIDGE_TOKEN: "wrong" }));
  check("refusal reported, not thrown", !no.ok && /401/.test(no.detail), no.detail);
  refused.server.close();

  const slow = await fakeBridge(() => undefined); // never answers
  const t0 = Date.now();
  const late = await postToBridge({ kind: "test", text: "hi", snapshot: null }, bridgeConfig({ MUSE_BRIDGE_URL: slow.base, MUSE_BRIDGE_TOKEN: "t" }), 300);
  check("silent bridge times out", !late.ok && Date.now() - t0 < 3000, late.detail);
  slow.server.closeAllConnections();
  slow.server.close();

  const down = await postToBridge({ kind: "test", text: "hi", snapshot: null }, bridgeConfig({ MUSE_BRIDGE_URL: "http://127.0.0.1:9", MUSE_BRIDGE_TOKEN: "t" }));
  check("bridge down reported, not thrown", !down.ok, down.detail);

  const redirect = await fakeBridge((_req, res) => res.writeHead(302, { location: "http://example.com/" }).end());
  const moved = await postToBridge({ kind: "test", text: "hi", snapshot: null }, bridgeConfig({ MUSE_BRIDGE_URL: redirect.base, MUSE_BRIDGE_TOKEN: "t" }));
  check("redirect not followed (token stays on the Pi)", !moved.ok, moved.detail);
  redirect.server.close();

  // Messages
  const daily = dailyRunMessage({ newCompanies: 1, newJobs: 12, filled: 3, waitingApproval: 2, ended: "the window closed", deskUrl: "http://desk" });
  check("daily: counts", /1 new company, 12 new postings, 3 forms filled/.test(daily), daily);
  check("daily: approvals link", daily.includes("2 applications wait for my approval: http://desk/approvals"), daily);
  const quiet = dailyRunMessage({ newCompanies: 0, newJobs: 0, filled: null, waitingApproval: 0, ended: "no forms asked for (--count 0)" });
  check("daily: nothing waiting", quiet.includes("Nothing waits for my approval."), quiet);

  check("inbox: no news → no message", inboxMessage([{ company: "A", title: "T", label: "other" }]) === null);
  const inbox = inboxMessage([
    { company: "Acme", title: "Dev intern", label: "rejection" },
    { company: "Bolt", title: "QA intern", label: "interview" },
  ]);
  check("inbox: interview first", !!inbox && inbox.indexOf("interview: Bolt") < inbox.indexOf("rejection: Acme"), String(inbox));
  check("inbox: count", !!inbox?.startsWith("Internship desk: 2 employer emails just came in."), String(inbox));

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll Muse checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
