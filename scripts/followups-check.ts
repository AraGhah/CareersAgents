// Offline check: submit → two follow-ups; inbound on day 5 cancels the day-7 row.
//   npx tsx scripts/followups-check.ts

import { classifyMessage, shouldApplyStatus, statusFromClassification } from "../lib/classify";
import { pool } from "../lib/db";
import { scheduleFollowups } from "../lib/followups";
import { listJobs, setApplicationStatus, startApplication } from "../lib/queries";

async function main() {
  const rejection = classifyMessage({
    subject: "Update on your application",
    snippet: "Unfortunately we will not be moving forward.",
    from: "noreply@example.com",
    submittedAt: new Date(),
    occurredAt: new Date(),
  });
  if (rejection !== "rejection") throw new Error(`expected rejection, got ${rejection}`);
  if (!shouldApplyStatus("applied", statusFromClassification(rejection)!)) {
    throw new Error("rejection should apply from applied");
  }
  console.log("classification rules ok");

  let apps = await pool.query<{ id: string }>(`SELECT id FROM applications LIMIT 1`);
  if (!apps.rows[0]) {
    const jobs = await listJobs({ includeClosed: true, includeLow: true, includeSkipped: true });
    if (!jobs[0]) throw new Error("no jobs — run discovery first");
    await startApplication(jobs[0].id);
    apps = await pool.query<{ id: string }>(`SELECT id FROM applications LIMIT 1`);
  }
  const applicationId = apps.rows[0].id;

  await setApplicationStatus(applicationId, "applied", "followups-check");
  const { rows: followups } = await pool.query<{ due_on: string; state: string }>(
    `SELECT due_on::text, state FROM followups WHERE application_id = $1 ORDER BY due_on`,
    [applicationId],
  );
  if (followups.length < 2) throw new Error(`expected 2 followups, got ${followups.length}`);
  console.log(`followups after submit: ${followups.map((f) => f.due_on).join(", ")}`);

  const day7 = followups[0];
  const submittedAt = new Date();
  submittedAt.setUTCDate(submittedAt.getUTCDate() - 5);

  await pool.query(`UPDATE applications SET submitted_at = $2 WHERE id = $1`, [
    applicationId,
    submittedAt,
  ]);
  await pool.query(`DELETE FROM followups WHERE application_id = $1`, [applicationId]);
  await scheduleFollowups(applicationId, submittedAt);

  await pool.query(
    `INSERT INTO messages (application_id, direction, subject, snippet, classification, occurred_at)
     VALUES ($1, 'inbound', 'Thanks for applying', 'We received your application', 'confirmation', now())`,
    [applicationId],
  );

  // Same logic as process-followups for cancel.
  const { rows: pending } = await pool.query<{ id: string; due_on: string }>(
    `SELECT id, due_on::text FROM followups
      WHERE application_id = $1 AND state = 'pending'
      ORDER BY due_on`,
    [applicationId],
  );

  for (const row of pending) {
    const { rows: inbound } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM messages
        WHERE application_id = $1 AND direction = 'inbound'
          AND occurred_at >= (SELECT submitted_at FROM applications WHERE id = $1)`,
      [applicationId],
    );
    if (Number(inbound[0].n) > 0) {
      await pool.query(`UPDATE followups SET state = 'cancelled' WHERE id = $1`, [row.id]);
    }
  }

  const { rows: after } = await pool.query<{ due_on: string; state: string }>(
    `SELECT due_on::text, state FROM followups WHERE application_id = $1 ORDER BY due_on`,
    [applicationId],
  );
  const cancelled = after.filter((f) => f.state === "cancelled");
  if (cancelled.length < 1) throw new Error("expected at least one follow-up cancelled by inbound");
  console.log(
    `inbound on day 5 cancelled ${cancelled.length} pending follow-up(s); first due was ${day7.due_on}.`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
