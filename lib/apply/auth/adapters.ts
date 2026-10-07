// Where an application system's account pages differ from the generic ones. Only what was checked on a live portal is
// here: Workday's automation ids (sign-in, create account, the "Apply Manually" choice, the transparent click layer) were
// read off abb.wd3.myworkdayjobs.com on 2026-10-06. Every other portal (iCIMS, Taleo, SuccessFactors, a company's own) is
// read the generic way in lib/apply/account.ts: buttons by their visible text, fields by their labels through the shared
// classifier (lib/apply/classify.ts). A new system gets an entry here only once its ids are seen on a real page; a guessed
// selector would only make the generic reading worse.

export type AuthAdapter = {
  id: "workday" | "generic";
  label: string;
  hosts: RegExp | null;
  /** Automation ids tried before the visible-text search, per action. */
  /** emailChoice: "Sign in with email" on a page that first offers Google / LinkedIn / email (never the first two). */
  ids: { signIn: string[]; create: string[]; toSignup: string[]; toSignin: string[]; manual: string[]; emailChoice: string[] };
  /** What a page of this system shows once it has drawn itself (it renders seconds after "load"), or null. */
  settled: string | null;
  /** How long to wait for the portal to react to a press before calling it unanswered. */
  reactionMs: number;
};

export const WORKDAY_AUTH: AuthAdapter = {
  id: "workday",
  label: "Workday",
  hosts: /\.myworkday(jobs|site)\.com$/i,
  ids: {
    signIn: ["signInSubmitButton"],
    create: ["createAccountSubmitButton"],
    toSignup: ["createAccountLink"],
    toSignin: ["signInLink"],
    manual: ["applyManually"],
    // Newer tenants (globalhr.wd5, RTX, 2026-10-06) hide the email + password form behind this choice.
    emailChoice: ["SignInWithEmailButton"],
  },
  settled: [
    "input[type='password']",
    "[data-automation-id='errorMessage']",
    "[data-automation-id='errorBanner']",
    "[data-automation-id='applyFlowMyInfoPage']",
    "[data-automation-id='legalNameSection_firstName']",
    "[data-automation-id='pageFooterNextButton']",
    "[data-automation-id='SignInWithEmailButton']",
  ].join(", "),
  // Creating a Workday candidate account regularly takes 10 to 20 seconds; judging the page sooner read a form that was
  // still being processed as "it did not go through" (abb, cisco, giro on 2026-10-04/05).
  reactionMs: 35_000,
};

export const GENERIC_AUTH: AuthAdapter = {
  id: "generic",
  label: "generic",
  hosts: null,
  ids: { signIn: [], create: [], toSignup: [], toSignin: [], manual: [], emailChoice: [] },
  settled: null,
  reactionMs: 20_000,
};

export const AUTH_ADAPTERS: AuthAdapter[] = [WORKDAY_AUTH, GENERIC_AUTH];

export function authAdapterFor(host: string): AuthAdapter {
  return AUTH_ADAPTERS.find((a) => a.hosts?.test(host)) ?? GENERIC_AUTH;
}

/**
 * The automation ids to try for an action: this system's first, then every other known system's. An id like
 * "createAccountSubmitButton" means the same thing wherever it appears (a Workday form embedded on an employer's domain).
 */
export function knownIds(adapter: AuthAdapter, action: keyof AuthAdapter["ids"]): string[] {
  return [...new Set([...adapter.ids[action], ...AUTH_ADAPTERS.flatMap((a) => a.ids[action])])];
}
