// Links that open a ready-to-send message: Gmail's compose window in the browser, or
// the computer's default mail app. Neither can attach files, so the caller has to say
// so; both only pre-fill the recipient, subject and body.

type Draft = {
  to?: string;
  subject: string;
  body: string;
  /** The Gmail account to compose from, when several are signed in. Only used for Google addresses. */
  account?: string;
};

const enc = encodeURIComponent;

export function gmailComposeUrl({ to, subject, body, account }: Draft): string {
  const parts = ["view=cm", "fs=1"];
  if (account && /@(gmail|googlemail)\.com$/i.test(account)) parts.push(`authuser=${enc(account)}`);
  if (to) parts.push(`to=${enc(to)}`);
  parts.push(`su=${enc(subject)}`, `body=${enc(body)}`);
  return `https://mail.google.com/mail/?${parts.join("&")}`;
}

export function mailtoUrl({ to, subject, body }: Draft): string {
  return `mailto:${to ? enc(to) : ""}?subject=${enc(subject)}&body=${enc(body)}`;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Opens an existing Gmail draft in the compose window, in the right account. */
export function gmailDraftUrl(account: string | undefined, messageId: string): string {
  const user = account ? `u/${enc(account)}` : "u/0";
  return `https://mail.google.com/mail/${user}/#drafts?compose=${enc(messageId)}`;
}
