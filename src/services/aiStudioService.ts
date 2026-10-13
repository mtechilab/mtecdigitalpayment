import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateDraftRequest, buildMessages, budgetAllows, extractDraftText, DraftRequest, MAX_OUTPUT_CHARS } from "./aiPolicy.js";

export interface Lecturer { id: string; fullName: string }

const TIMEOUT_MS = 30000;
const MAX_TOKENS = 2000;

/** Calls the configured provider. Configure with AI_BASE_URL, AI_API_KEY and AI_MODEL. The key
 *  is read here on the server only and never appears in an error or a log line. */
async function callProvider(messages: { role: string; content: string }[]): Promise<{ text: string; tokens: number }> {
  const baseUrl = (process.env.AI_BASE_URL || "").trim();
  const apiKey = (process.env.AI_API_KEY || "").trim();
  const model = (process.env.AI_MODEL || "").trim();
  if (!baseUrl || !apiKey || !model) throw new Error("The AI studio is not configured yet. Ask an administrator.");
  if (!/^https:\/\//.test(baseUrl)) {
    console.error("[ai] AI_BASE_URL must start with https:// (check Render for stray spaces or quotes)");
    throw new Error("The AI studio is misconfigured. Ask an administrator to check its settings.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Log the provider's own short message, with the key removed if it ever appears in it.
      const detail = (await res.text().catch(() => "")).slice(0, 300).split(apiKey).join("[key]");
      console.error(`[ai] provider returned ${res.status}: ${detail}`);
      if (res.status === 404) throw new Error("The AI model or address was not found. Ask an administrator to check AI_MODEL and AI_BASE_URL.");
      if (res.status === 401 || res.status === 403) throw new Error("The AI service refused the key. Ask an administrator to check AI_API_KEY.");
      if (res.status === 429) throw new Error("The AI service is busy or its free quota is used up. Try again later.");
      throw new Error(`The AI service returned an error (${res.status}). Try again shortly.`);
    }
    const parsed = extractDraftText(await res.json());
    if (!parsed) throw new Error("The AI service returned nothing usable. Try again.");
    return parsed;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("The AI service took too long. Try again.");
    // Network failures ("fetch failed") carry the real cause on err.cause. Log that code and host
    // only: never the URL path, the key, or the request body.
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause || /fetch failed/i.test((err as Error).message)) {
      console.error(`[ai] could not reach the provider (${cause?.code || "network error"}). Check AI_BASE_URL.`);
      throw new Error("The AI service could not be reached. Ask an administrator to check its settings, then try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function spendBudget(tokens: number) {
  const supabase = getSupabase();
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await supabase.from("ai_usage").select("calls, tokens").eq("month", month).maybeSingle();
  const calls = (data?.calls ?? 0) + 1;
  const total = (data?.tokens ?? 0) + tokens;
  const { error } = await supabase.from("ai_usage").upsert({ month, calls, tokens: total }, { onConflict: "month" });
  if (error) console.error("[ai] could not record usage:", error.message);
}

async function monthlyCallsSoFar(): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await getSupabase().from("ai_usage").select("calls").eq("month", month).maybeSingle();
  return data?.calls ?? 0;
}

function monthlyLimit(): number {
  const n = Number(process.env.AI_MONTHLY_CALL_LIMIT || 200);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

async function generate(input: DraftRequest): Promise<{ text: string; tokens: number }> {
  const problem = validateDraftRequest(input);
  if (problem) throw new Error(problem);
  if (!budgetAllows(await monthlyCallsSoFar(), monthlyLimit())) {
    throw new Error("The studio has reached its monthly limit. It resets next month.");
  }
  const result = await callProvider(buildMessages(input));
  await spendBudget(result.tokens);
  return result;
}

export async function createDraft(owner: Lecturer, input: DraftRequest) {
  const { text } = await generate(input);
  const groupId = crypto.randomUUID();
  const { data, error } = await getSupabase().from("ai_drafts").insert({
    group_id: groupId, version: 1, owner_staff_id: owner.id, owner_name: owner.fullName,
    kind: input.kind, title: input.title.trim(), programme: input.programme.trim(),
    course_code: (input.courseCode || "").trim(), topic: (input.topic || "").trim(),
    instructions: (input.instructions || "").trim(), content: text, status: "draft",
  }).select("id, group_id, version, title, kind, content, status").single();
  if (error) throw new Error(`createDraft failed: ${error.message}`);
  await recordAudit({ actor: owner.fullName, action: "ai.generate", entityType: "ai_draft", entityId: data.id as string, detail: { kind: input.kind } });
  return data;
}

/** A new version of the same draft, from new notes. The earlier versions are kept. */
export async function regenerateDraft(owner: Lecturer, draftId: string, instructions: string) {
  const supabase = getSupabase();
  const current = await ownDraft(owner, draftId);
  const { text } = await generate({
    kind: current.kind as string, title: current.title as string, programme: current.programme as string,
    courseCode: current.course_code as string, topic: current.topic as string,
    instructions: instructions.trim() || (current.instructions as string),
  });
  const version = (current.version as number) + 1;
  const { data, error } = await supabase.from("ai_drafts").insert({
    group_id: current.group_id, version, owner_staff_id: owner.id, owner_name: owner.fullName,
    kind: current.kind, title: current.title, programme: current.programme, course_code: current.course_code,
    topic: current.topic, instructions: instructions.trim() || current.instructions, content: text, status: "draft",
  }).select("id, group_id, version, title, kind, content, status").single();
  if (error) throw new Error(`regenerateDraft failed: ${error.message}`);
  await recordAudit({ actor: owner.fullName, action: "ai.regenerate", entityType: "ai_draft", entityId: data.id as string, detail: { version } });
  return data;
}

/** Only the lecturer who created a draft can read, edit or approve it. */
async function ownDraft(owner: Lecturer, draftId: string) {
  const { data, error } = await getSupabase().from("ai_drafts").select("*").eq("id", draftId).maybeSingle();
  if (error) throw new Error(`ownDraft failed: ${error.message}`);
  if (!data || data.owner_staff_id !== owner.id) throw new Error("That draft was not found.");
  return data;
}

export async function getDraft(owner: Lecturer, draftId: string) {
  return ownDraft(owner, draftId);
}

export async function listDrafts(owner: Lecturer) {
  const { data, error } = await getSupabase().from("ai_drafts")
    .select("id, group_id, version, title, kind, programme, course_code, status, created_at, updated_at")
    .eq("owner_staff_id", owner.id).order("updated_at", { ascending: false }).limit(200);
  if (error) throw new Error(`listDrafts failed: ${error.message}`);
  return data || [];
}

/** Saves the lecturer's edits. Approved drafts are locked, so approval means what was approved. */
export async function saveDraft(owner: Lecturer, draftId: string, content: string) {
  const current = await ownDraft(owner, draftId);
  if (current.status === "approved") throw new Error("An approved draft cannot be changed. Regenerate it to make a new version.");
  const text = content.trim();
  if (text.length === 0) throw new Error("The draft cannot be empty.");
  if (text.length > MAX_OUTPUT_CHARS) throw new Error("The draft is too long to save.");
  const { error } = await getSupabase().from("ai_drafts")
    .update({ content: text, updated_at: new Date().toISOString() }).eq("id", draftId);
  if (error) throw new Error(`saveDraft failed: ${error.message}`);
  return { success: true };
}

export async function approveDraft(owner: Lecturer, draftId: string) {
  const current = await ownDraft(owner, draftId);
  if (current.status === "approved") return { success: true };
  const { error } = await getSupabase().from("ai_drafts")
    .update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", draftId);
  if (error) throw new Error(`approveDraft failed: ${error.message}`);
  await recordAudit({ actor: owner.fullName, action: "ai.approve", entityType: "ai_draft", entityId: draftId, detail: { version: current.version } });
  return { success: true };
}
