// Passwords the desk made for one portal, because that portal refused the configured one (lib/apply/auth/password-policy.ts).
// The configured account (PORTAL_ACCOUNT_EMAIL / PORTAL_ACCOUNT_PASSWORD in .env.local) stays the default everywhere; the
// vault only holds the exceptions, so the next run signs in to that portal with the password it was created with.
//
// How it is kept:
//   - one file, by default in your home folder (~/.internship-desk/portal-vault.json), NOT in the project: the project
//     lives in a synced folder, and the key (.env.local) must not travel next to what it opens. PORTAL_VAULT_PATH moves it.
//   - each password encrypted on its own with AES-256-GCM, a fresh IV each time, and the host + email as authenticated data,
//     so an entry copied onto another host does not open
//   - the key is derived (scrypt) from PORTAL_VAULT_KEY in .env.local, with a random salt kept in the file
//   - no PORTAL_VAULT_KEY: no vault. The desk then never generates a password and stops, as before, on a refused one
// Nothing here logs, and nothing returns a password except get(), which only the account step calls.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type Entry = { email: string; iv: string; tag: string; data: string; created_at: string; confirmed: boolean };
type VaultFile = { version: 1; salt: string; entries: Record<string, Entry> };

export type VaultEntry = { email: string; password: string; createdAt: Date; confirmed: boolean };

export type Vault = {
  /** The password made for this portal, or null. */
  get(host: string, email: string): VaultEntry | null;
  /** Keeps a password for this portal: written before the portal is asked to create the account, so it is never lost. */
  put(host: string, email: string, password: string): void;
  /** The portal accepted it (the account exists with this password). */
  confirm(host: string): void;
  /** Drops an entry the portal never accepted. */
  remove(host: string): void;
  hosts(): string[];
};

export function vaultPath(env: Record<string, string | undefined> = process.env): string {
  return env.PORTAL_VAULT_PATH?.trim() || path.join(os.homedir(), ".internship-desk", "portal-vault.json");
}

/** The vault, or null when PORTAL_VAULT_KEY is not set (or too short to be a key). */
export function openVault(env: Record<string, string | undefined> = process.env): Vault | null {
  const secret = env.PORTAL_VAULT_KEY?.trim() ?? "";
  if (secret.length < 16) return null;
  return fileVault(vaultPath(env), secret);
}

export function fileVault(file: string, secret: string): Vault {
  const load = (): VaultFile => {
    if (!existsSync(file)) return { version: 1, salt: randomBytes(16).toString("base64"), entries: {} };
    const parsed = JSON.parse(readFileSync(file, "utf8")) as VaultFile;
    if (parsed.version !== 1 || !parsed.salt || typeof parsed.entries !== "object") throw new Error(`unreadable portal vault at ${file}`);
    return parsed;
  };
  const keyFor = (salt: string) => scryptSync(secret, Buffer.from(salt, "base64"), 32);
  const save = (v: VaultFile) => {
    mkdirSync(path.dirname(file), { recursive: true });
    // Written beside, then renamed over: a crash mid-write never leaves half a vault.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const aad = (host: string, email: string) => Buffer.from(`${host.toLowerCase()}\n${email.toLowerCase()}`);

  return {
    get(host, email) {
      const v = load();
      const e = v.entries[host.toLowerCase()];
      if (!e || e.email.toLowerCase() !== email.toLowerCase()) return null;
      const decipher = createDecipheriv("aes-256-gcm", keyFor(v.salt), Buffer.from(e.iv, "base64"));
      decipher.setAAD(aad(host, email));
      decipher.setAuthTag(Buffer.from(e.tag, "base64"));
      // A wrong key or a tampered entry throws here (GCM): never a wrong password typed into a portal.
      const password = Buffer.concat([decipher.update(Buffer.from(e.data, "base64")), decipher.final()]).toString("utf8");
      return { email: e.email, password, createdAt: new Date(e.created_at), confirmed: e.confirmed };
    },
    put(host, email, password) {
      const v = load();
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keyFor(v.salt), iv);
      cipher.setAAD(aad(host, email));
      const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
      v.entries[host.toLowerCase()] = {
        email,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
        created_at: new Date().toISOString(),
        confirmed: false,
      };
      save(v);
    },
    confirm(host) {
      const v = load();
      const e = v.entries[host.toLowerCase()];
      if (!e || e.confirmed) return;
      e.confirmed = true;
      save(v);
    },
    remove(host) {
      const v = load();
      if (!v.entries[host.toLowerCase()]) return;
      delete v.entries[host.toLowerCase()];
      save(v);
    },
    hosts() {
      return Object.keys(load().entries);
    },
  };
}
