"use server";

// Buttons of the Answers page: confirm a legal answer once ("use it automatically"), and edit or forget an answer the
// desk remembered from an earlier form.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "../lib/db";
import { forgetAnswer, updateRememberedAnswer } from "../lib/apply/memory-store";

/** The only answers that can be confirmed for automatic use: the rest of the personal ones always wait for you. */
const AUTO_USE_KEYS = new Set(["work_authorization", "sponsorship_required", "salary_expectation"]);

function text(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`${key} is required`);
  return v.trim();
}

export async function setAnswerAutoUseAction(form: FormData) {
  const key = text(form, "key");
  if (!AUTO_USE_KEYS.has(key)) throw new Error("This answer cannot be used automatically.");
  const on = form.get("on") === "1";
  try {
    await pool.query(`UPDATE answers SET auto_use = $2, updated_at = now() WHERE key = $1`, [key, on]);
  } catch (err) {
    if ((err as { code?: string }).code === "42703") redirect("/answers?error=schema#auto");
    throw err;
  }
  revalidatePath("/answers");
  redirect(`/answers?ok=${on ? "auto-on" : "auto-off"}#auto`);
}

export async function updateMemoryAction(form: FormData) {
  const key = text(form, "key");
  const value = text(form, "value");
  await updateRememberedAnswer(key, value.slice(0, 2000));
  revalidatePath("/answers");
  redirect("/answers?ok=memory#memoire");
}

export async function forgetMemoryAction(form: FormData) {
  await forgetAnswer(text(form, "key"));
  revalidatePath("/answers");
  redirect("/answers?ok=forgotten#memoire");
}
