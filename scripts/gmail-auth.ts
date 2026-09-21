// One-time Gmail OAuth (readonly + compose only).
//   npx tsx scripts/gmail-auth.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import { GMAIL_SCOPES, runLocalAuth } from "../lib/gmail";

async function main() {
  console.log("Scopes requested:");
  for (const scope of GMAIL_SCOPES) console.log(`  ${scope}`);
  console.log("gmail.send is not requested on purpose.\n");

  const tokens = await runLocalAuth();
  console.log("\nSaved to cache/gmail-token.json");
  console.log(`refresh_token: ${tokens.refresh_token ? "yes" : "no — re-run with prompt=consent"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
