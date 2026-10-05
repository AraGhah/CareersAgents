// Sign in to LinkedIn once for the desk's Easy Apply runs (session saved to cache/linkedin-state.json).
//   npm run linkedin:signin

import { signInToLinkedIn } from "../lib/linkedin-session";

signInToLinkedIn().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
