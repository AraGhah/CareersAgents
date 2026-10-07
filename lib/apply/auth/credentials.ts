// Which email and password to use on one portal. The configured account (.env.local) is the default; the vault holds the
// exceptions: a password generated for a portal whose rules the default does not meet. The account step asks this module,
// never the vault or .env.local directly, so the choice is made in one place:
//
//   sign-in:  the portal's vault password when there is one (then the default, if the vault entry was never confirmed),
//             else the default
//   sign-up:  the vault password already made for this portal if it fits, else the default if it fits the portal's printed
//             rules, else a new password that fits, put in the vault BEFORE the portal is asked to create the account
//             (a crash right after the press never loses the password the account was made with)

import type { AccountCredentials } from "../account-config";
import { generatePassword, hasRules, policyViolations, type PasswordPolicy } from "./password-policy";
import type { Vault } from "./vault";

export type SignInChoice = { creds: AccountCredentials; source: "default" | "vault" };
export type SignUpChoice = { creds: AccountCredentials; source: "default" | "vault" | "generated" } | { problem: string };

export type CredentialProvider = {
  /** The passwords to try on a sign-in form, best first (at most two: a bounded number of failed sign-ins). */
  forSignIn(host: string): SignInChoice[];
  /** The password to create the account with. `refused`: the portal refused the last one for its rules. */
  forSignUp(host: string, policy: PasswordPolicy, refused: boolean): SignUpChoice;
  /** The portal accepted this password (signed in, or created the account). */
  accepted(host: string, source: "default" | "vault" | "generated"): void;
  /** Every password this provider may hand out for the host, for redaction. */
  secrets(host: string): string[];
};

export function credentialProvider(defaults: AccountCredentials, vault: Vault | null): CredentialProvider {
  const fromVault = (host: string) => {
    try {
      return vault?.get(host, defaults.email) ?? null;
    } catch {
      // An entry that does not decrypt (another key) is treated as absent, never typed.
      return null;
    }
  };
  return {
    forSignIn(host) {
      const v = fromVault(host);
      const fallback: SignInChoice = { creds: defaults, source: "default" };
      if (!v) return [fallback];
      const mine: SignInChoice = { creds: { email: v.email, password: v.password }, source: "vault" };
      return v.confirmed ? [mine] : [mine, fallback];
    },
    forSignUp(host, policy, refused) {
      const v = fromVault(host);
      if (v && !refused && policyViolations(policy, v.password).length === 0) return { creds: { email: v.email, password: v.password }, source: "vault" };
      const defaultBreaks = policyViolations(policy, defaults.password);
      if (!refused && defaultBreaks.length === 0) return { creds: defaults, source: "default" };
      if (!vault) {
        const why = refused ? "the portal refused the configured password" : `the configured password does not meet this portal's rules (${defaultBreaks.join(", ")})`;
        return { problem: `${why}; set PORTAL_VAULT_KEY in .env.local so the desk can make a password for this portal alone, or create the account yourself` };
      }
      if (refused && !hasRules(policy)) return { problem: "the portal refused the password without saying which rule it breaks" };
      let password: string;
      try {
        password = generatePassword(policy);
      } catch (err) {
        return { problem: (err as Error).message };
      }
      vault.put(host, defaults.email, password);
      return { creds: { email: defaults.email, password }, source: "generated" };
    },
    accepted(host, source) {
      if (source === "default") return;
      try {
        vault?.confirm(host);
      } catch {
        // The account works either way; only the "confirmed" flag is lost.
      }
    },
    secrets(host) {
      const v = fromVault(host);
      return [defaults.password, ...(v ? [v.password] : [])].filter(Boolean);
    },
  };
}

/** A provider with no vault: the configured account everywhere (what the desk did before the vault existed). */
export function defaultOnly(defaults: AccountCredentials): CredentialProvider {
  return credentialProvider(defaults, null);
}
