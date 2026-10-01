// Checks for "Postuler automatiquement". Needs the database (it makes its own temporary company, postings and runs
// and deletes them at the end) but no Gmail, no browser and no network: the per-application step and Gmail are stood
// in for by fakes. The question words of the criminal-record / security answers are checked in portal-check.ts.
//   npm run auto-apply:check

import type { gmail_v1 } from "googleapis";
import { pool } from "../lib/db";
import { configuredMinScore, dropTwins, type Candidate } from "../lib/auto-apply/select";
import { isGmailAuthError, type ApplyContext, type ApplyResult } from "../lib/auto-apply/apply";
import { lookLimit, runAutoApply, summarize } from "../lib/auto-apply/run";
import { syncSentDrafts } from "../lib/auto-apply/sent";
import { closeStaleRuns, createRun, getRun, listItems, requestStop } from "../lib/auto-apply/store";
import { markOutreachSentFromOutbound } from "../lib/outreach";
import { APPLICATION_STATUS_FR } from "../lib/status-labels";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const tag = `zz-auto-apply-check-${Date.now()}`;
let companyId = "";
const runIds: string[] = [];

async function makeApplication(title: string, status = "ready"): Promise<{ applicationId: string; jobId: string }> {
  const job = await pool.query<{ id: string }>(
    `INSERT INTO jobs (company_id, external_id, title, url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [companyId, `${tag}-${title}`, title, `https://example.test/${tag}/${encodeURIComponent(title)}`],
  );
  const app = await pool.query<{ id: string }>(`INSERT INTO applications (job_id, status) VALUES ($1, $2) RETURNING id`, [job.rows[0].id, status]);
  return { applicationId: app.rows[0].id, jobId: job.rows[0].id };
}

const candidate = (applicationId: string, jobId: string, n: number): Candidate => ({
  job_id: jobId,
  company_id: companyId,
  company_name: "ZZ check",
  title: `Role ${n}`,
  application_id: applicationId,
  status: "ready",
  channel: "email",
  score: 0.9 - n * 0.01,
});

const draft = (detail = "draft"): ApplyResult => ({ outcome: "draft", detail, channel: "email", counts: true });
const skip = (): ApplyResult => ({ outcome: "skipped", detail: "account portal", channel: "manual", counts: false });
const fail = (): ApplyResult => ({ outcome: "failed", detail: "boom", channel: null, counts: false });

async function newRun(requested: number): Promise<string> {
  // A real batch could be live while this runs: the check never starts over it.
  const id = await createRun(requested, 60);
  runIds.push(id);
  return id;
}

function pureChecks() {
  console.log("\ntwin postings and limits");
  const rows = [
    { company_id: "c1", title: "Software Developer Intern (Winter 2027)", n: 1 },
    { company_id: "c1", title: "Stage - Software Developer Intern", n: 2 },
    { company_id: "c2", title: "Software Developer Intern (Winter 2027)", n: 3 },
    { company_id: "c3", title: "Backend Developer Intern", n: 4 },
  ];
  check(dropTwins(rows).map((r) => r.n).join() === "1,3,4", "the same role at the same company is applied to once (the better-scored copy)", dropTwins(rows));
  check(dropTwins(rows, new Set(["c3|backend developer"])).map((r) => r.n).join() === "1,3", "a role whose twin is already out or waiting in Gmail is not picked again");
  check(dropTwins([{ company_id: "c9", title: "Intern" }, { company_id: "c9", title: "Intern" }]).length === 2, "a title too generic to compare is never treated as a twin");
  check(lookLimit(1) === 13 && lookLimit(5) === 25 && lookLimit(50) === 80, "the look-ahead is bounded");

  const before = process.env.AUTO_APPLY_MIN_SCORE;
  delete process.env.AUTO_APPLY_MIN_SCORE;
  check(configuredMinScore() === 60, "default minimum score is 60");
  process.env.AUTO_APPLY_MIN_SCORE = "75";
  check(configuredMinScore() === 75, "AUTO_APPLY_MIN_SCORE changes it");
  process.env.AUTO_APPLY_MIN_SCORE = "banana";
  check(configuredMinScore() === 60, "a value that is not a number falls back to 60");
  process.env.AUTO_APPLY_MIN_SCORE = "250";
  check(configuredMinScore() === 60, "so does one out of range");
  if (before === undefined) delete process.env.AUTO_APPLY_MIN_SCORE;
  else process.env.AUTO_APPLY_MIN_SCORE = before;

  check(summarize({ draft: 3 }, 3, false).startsWith("Objectif atteint : 3 candidatures."), "summary: goal reached");
  check(summarize({ draft: 1, skipped: 4 }, 3, false).includes("1 candidature sur 3 demandées"), "summary: says when there were not enough postings");
  check(summarize({ draft: 1 }, 3, true).startsWith("Arrêté."), "summary: stopped");
  check(isGmailAuthError(new Error("Gmail is not authorized yet. Run: npm run gmail:auth")) && isGmailAuthError(new Error("invalid_grant")), "a lost Gmail connection is recognised");
  check(!isGmailAuthError(new Error("socket hang up")), "a network error is not mistaken for it");
  check(APPLICATION_STATUS_FR.applied === "Envoyé", "the 'applied' status is shown as « Envoyé »");
}

async function loopChecks() {
  console.log("\nthe batch loop (fake per-application step)");
  const apps = [];
  for (let i = 1; i <= 7; i++) apps.push(await makeApplication(`Role ${i}`));
  const cands = apps.map((a, i) => candidate(a.applicationId, a.jobId, i + 1));
  const quiet = { log: () => undefined };

  // Asked for 3: a skip and a failure do not count, and the loop stops the moment 3 are done.
  let id = await newRun(3);
  const script = [skip(), draft(), fail(), draft(), draft(), draft(), draft()];
  let calls = 0;
  let out = await runAutoApply(id, { ...quiet, candidates: async () => cands, apply: async () => script[calls++] });
  let items = await listItems(id);
  let run = await getRun(id);
  check(out.counted === 3 && calls === 5, "asked for 3: stops after the 3rd draft, the rest are never touched", { counted: out.counted, calls });
  check(items.map((i) => i.outcome).join() === "skipped,draft,failed,draft,draft", "every posting tried is recorded, in score order", items.map((i) => i.outcome));
  check(items.map((i) => i.position).join() === "1,2,3,4,5", "positions follow the ranking");
  check(run?.state === "done" && /Objectif atteint : 3/.test(run.note ?? ""), "run is done, with the summary", run);

  // Fewer postings than asked for.
  id = await newRun(5);
  calls = 0;
  out = await runAutoApply(id, { ...quiet, candidates: async () => cands.slice(0, 2), apply: async () => draft() });
  run = await getRun(id);
  check(out.counted === 2 && run?.state === "done" && /pas assez/.test(run.note ?? ""), "fewer postings than asked: does what it can and says so", run?.note);

  // Stop.
  id = await newRun(5);
  calls = 0;
  out = await runAutoApply(id, {
    ...quiet,
    candidates: async () => cands,
    apply: async () => {
      calls++;
      await requestStop(id);
      return draft();
    },
  });
  run = await getRun(id);
  check(calls === 1 && run?.state === "stopped", "Stop is honoured between postings", { calls, state: run?.state });

  // Gmail lost: nothing else is tried, the run says what to do.
  id = await newRun(5);
  calls = 0;
  out = await runAutoApply(id, {
    ...quiet,
    candidates: async () => cands,
    apply: async () => {
      calls++;
      throw new Error("Gmail is not authorized yet. Run: npm run gmail:auth");
    },
  });
  run = await getRun(id);
  check(calls === 1 && run?.state === "failed" && /gmail:auth/.test(run.note ?? ""), "a lost Gmail connection ends the run at once, naming the fix", run);

  // An ordinary error on one posting does not end the batch.
  id = await newRun(2);
  calls = 0;
  out = await runAutoApply(id, {
    ...quiet,
    candidates: async () => cands,
    apply: async () => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      return draft();
    },
  });
  items = await listItems(id);
  check(out.counted === 2 && items[0].outcome === "failed" && /socket/.test(items[0].detail ?? ""), "an error on one posting is recorded and the next is tried", items.map((i) => i.outcome));

  // A posting not tracked yet is tracked just before it is applied to.
  id = await newRun(1);
  const bare = await makeApplication("Untracked role");
  let tracked = 0;
  out = await runAutoApply(id, {
    ...quiet,
    candidates: async () => [{ ...candidate(bare.applicationId, bare.jobId, 1), application_id: null, status: null, channel: null }],
    track: async () => {
      tracked++;
      return bare.applicationId;
    },
    apply: async () => draft(),
  });
  check(tracked === 1 && out.counted === 1, "an untracked posting is tracked first");

  // One batch at a time; a dead one does not block the next.
  id = await newRun(1);
  let refused = false;
  try {
    await createRun(1, 60);
  } catch {
    refused = true;
  }
  check(refused, "a second batch is refused while one is running");
  await pool.query(`UPDATE auto_apply_runs SET heartbeat_at = now() - interval '2 hours' WHERE id = $1`, [id]);
  await closeStaleRuns();
  check((await getRun(id))?.state === "failed", "a run whose process stopped answering is closed, so it never blocks the next one");

  // Two online applications are never sent back to back.
  id = await newRun(2);
  const slept: number[] = [];
  await runAutoApply(id, {
    ...quiet,
    candidates: async () => cands.slice(0, 2),
    portalDelaySeconds: 90,
    sleep: async (ms) => void slept.push(ms),
    apply: async (_a: string, ctx: ApplyContext) => {
      await ctx.paceNextPortal();
      return draft();
    },
  });
  check(slept.length === 1 && slept[0] > 80_000 && slept[0] <= 90_000, "a pause of PORTAL_DELAY_SECONDS between two forms (none before the first)", slept);
}

type FakeMessage = { id: string; subject: string; at: number };

/** The few Gmail calls the sent-detection makes. */
function fakeGmail(opts: { liveDrafts: string[]; sent: FakeMessage[] }): gmail_v1.Gmail {
  return {
    users: {
      drafts: {
        get: async ({ id }: { id: string }) => {
          if (opts.liveDrafts.includes(id)) return { data: { id } };
          throw Object.assign(new Error("Requested entity was not found."), { code: 404 });
        },
      },
      messages: {
        list: async () => ({ data: { messages: opts.sent.map((m) => ({ id: m.id })) } }),
        get: async ({ id }: { id: string }) => {
          const m = opts.sent.find((x) => x.id === id)!;
          return { data: { id, internalDate: String(m.at), payload: { headers: [{ name: "Subject", value: m.subject }] } } };
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
}

async function draftRow(applicationId: string, gmailDraftId: string, to: string, subject: string) {
  await pool.query(
    `INSERT INTO outreach_drafts (application_id, kind, lang, to_email, subject, body, gmail_draft_id, approved_at)
     VALUES ($1, 'application', 'en', $2, $3, 'body', $4, now())`,
    [applicationId, to, subject, gmailDraftId],
  );
}

const statusOf = async (id: string) => (await pool.query<{ status: string; submitted_at: Date | null }>(`SELECT status, submitted_at FROM applications WHERE id = $1`, [id])).rows[0];

async function sentChecks() {
  console.log("\nsent status (you press Send in Gmail)");
  const subject = "Application - Developer Intern - Ara Ghahramanyan";
  const when = Date.now() + 60_000;
  const waiting = await makeApplication("Waiting");
  const sent = await makeApplication("Sent");
  await draftRow(waiting.applicationId, `${tag}-d-wait`, "jobs@wait.test", subject);
  await draftRow(sent.applicationId, `${tag}-d-sent`, "jobs@sent.test", subject);

  // The fake mailbox answers every search with the same Sent folder, so each step below has only the drafts it is about.
  const gmail = fakeGmail({ liveDrafts: [`${tag}-d-wait`], sent: [{ id: "m-1", subject: subject.toUpperCase(), at: when }] });
  const result = await syncSentDrafts(gmail);

  check((await statusOf(sent.applicationId)).status === "applied", "a draft that left Gmail and is in Sent → the application becomes applied (Envoyé)");
  check((await statusOf(sent.applicationId)).submitted_at !== null, "…and its sent date is stamped");
  check((await statusOf(waiting.applicationId)).status === "ready", "a draft still in Gmail stays ready (you have not sent it)");
  check(result.waiting >= 1, "…and is counted as waiting", result);
  const sentRow = (await pool.query<{ sent_at: Date | null; gmail_message_id: string | null }>(`SELECT sent_at, gmail_message_id FROM outreach_drafts WHERE application_id = $1`, [sent.applicationId])).rows[0];
  check(sentRow.sent_at !== null && sentRow.gmail_message_id === "m-1", "the draft row records when and which message", sentRow);
  check((await syncSentDrafts(gmail)).sent === 0, "running it again finds nothing new");

  // A draft that vanished with nothing in Sent was deleted, not sent.
  const deleted = await makeApplication("Deleted");
  await draftRow(deleted.applicationId, `${tag}-d-del`, "jobs@del.test", subject);
  await syncSentDrafts(fakeGmail({ liveDrafts: [`${tag}-d-wait`], sent: [] }));
  check((await statusOf(deleted.applicationId)).status === "ready", "a draft that vanished with nothing in Sent was deleted: not marked sent");
  await pool.query(`DELETE FROM outreach_drafts WHERE application_id = $1`, [deleted.applicationId]);

  // The recipient was kept but the subject edited in Gmail: still the same application going out.
  const edited = await makeApplication("Edited subject");
  await draftRow(edited.applicationId, `${tag}-d-edit`, "jobs@edit.test", subject);
  await syncSentDrafts(fakeGmail({ liveDrafts: [`${tag}-d-wait`], sent: [{ id: "m-2", subject: "Hello from Ara", at: when }] }));
  check((await statusOf(edited.applicationId)).status === "applied", "sent to the same address with an edited subject still counts");

  // The older path (inbox sync's Sent scan) moves the status too, and never pulls a later status back.
  const viaScan = await makeApplication("Via scan");
  await draftRow(viaScan.applicationId, `${tag}-d-scan`, "jobs@scan.test", subject);
  const matched = await markOutreachSentFromOutbound({ applicationId: viaScan.applicationId, toOrSubjectHint: "jobs@scan.test", occurredAt: new Date() });
  check(matched && (await statusOf(viaScan.applicationId)).status === "applied", "inbox sync's Sent scan also moves the status to applied");
  const interview = await makeApplication("Already interviewing", "interview");
  await draftRow(interview.applicationId, `${tag}-d-int`, "jobs@int.test", "Follow-up");
  await markOutreachSentFromOutbound({ applicationId: interview.applicationId, toOrSubjectHint: "jobs@int.test", occurredAt: new Date() });
  check((await statusOf(interview.applicationId)).status === "interview", "a later status is never pulled back to applied");
}

async function cleanup() {
  const { rows: jobs } = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE company_id = $1`, [companyId]);
  const jobIds = jobs.map((j) => j.id);
  const { rows: apps } = await pool.query<{ id: string }>(`SELECT id FROM applications WHERE job_id = ANY($1::uuid[])`, [jobIds]);
  const appIds = apps.map((a) => a.id);
  await pool.query(`DELETE FROM auto_apply_runs WHERE id = ANY($1::uuid[])`, [runIds]);
  await pool.query(`DELETE FROM followups WHERE application_id = ANY($1::uuid[])`, [appIds]);
  await pool.query(`DELETE FROM status_events WHERE application_id = ANY($1::uuid[])`, [appIds]);
  await pool.query(`DELETE FROM messages WHERE application_id = ANY($1::uuid[])`, [appIds]);
  await pool.query(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [appIds]);
  await pool.query(`DELETE FROM job_scores WHERE job_id = ANY($1::uuid[])`, [jobIds]);
  await pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [jobIds]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
}

async function main() {
  pureChecks();

  const live = await pool.query(`SELECT id FROM auto_apply_runs WHERE state = 'running' AND heartbeat_at > now() - interval '15 minutes'`);
  if (live.rows.length > 0) {
    console.log("\nA real batch is running right now: the database checks are skipped so they cannot interfere with it.");
    return;
  }

  companyId = (await pool.query<{ id: string }>(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [tag])).rows[0].id;
  try {
    await loopChecks();
    await sentChecks();
  } finally {
    await cleanup();
  }
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(async () => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
    await pool.end().catch(() => undefined);
  });
