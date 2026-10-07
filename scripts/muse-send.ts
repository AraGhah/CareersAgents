// Send something to your Muse chat through the gadget bridge, with a fresh snapshot of the desk (lib/notify/muse.ts).
//   npm run muse:send                         a test message: checks the whole path desk → Pi → Muse
//   npm run muse:send -- "Remind me to..."    your own text
//   npm run muse:send -- --snapshot           only refresh what `desk-status` shows on the Pi; nothing in the chat
// The daily run and the inbox sync send on their own once MUSE_BRIDGE_URL and MUSE_BRIDGE_TOKEN are set.

import { pool } from "../lib/db";
import { bridgeConfig, deskSnapshot, notifyMuse } from "../lib/notify/muse";

async function main() {
  const config = bridgeConfig();
  if (!config) {
    throw new Error("Muse is not set up: set MUSE_BRIDGE_URL and MUSE_BRIDGE_TOKEN in .env.local (muse/install.sh prints both).");
  }
  const snapshotOnly = process.argv.includes("--snapshot");
  const own = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  const snap = await deskSnapshot();
  console.log(
    `Desk: ${snap.awaiting_approval.count} waiting for approval, ${snap.needs_you.count} needing you, ` +
      `${snap.submitted_today} submitted today, ${snap.followups_due} follow-up(s) due.`,
  );
  const text = snapshotOnly
    ? null
    : own ||
      `Internship desk: test message. ${snap.awaiting_approval.count} application(s) wait for my approval. ` +
        `Run desk-status on this gadget to see the whole desk.`;
  const result = await notifyMuse({ kind: snapshotOnly ? "snapshot" : "test", text });
  console.log(result.ok ? `Delivered to ${config.url}: ${result.detail}` : `Not delivered (${config.url}): ${result.detail}`);
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));
