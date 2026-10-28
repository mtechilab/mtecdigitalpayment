/** Weekly check-in rules. No database or network imports, so they can be tested directly. */
export const REFLECTION_FIELDS = ["workCompleted", "skillsLearned", "challenges", "nextPlan"] as const;
export const MAX_REFLECTION_CHARS = 500;
export const DEFAULT_MILESTONES = [
  "Project proposal", "Initial prototype", "Intermediate development", "Testing and improvement", "Final product", "Individual demonstration",
];

export interface CheckinFields { workCompleted?: unknown; skillsLearned?: unknown; challenges?: unknown; nextPlan?: unknown }

/** A submitted check-in needs all four answers. A draft may be incomplete. */
export function validateCheckin(fields: CheckinFields, submit: boolean): string | null {
  for (const f of REFLECTION_FIELDS) {
    const v = fields[f];
    if (v !== undefined && v !== null && typeof v !== "string") return "Each answer must be text.";
    if (typeof v === "string" && v.length > MAX_REFLECTION_CHARS) return `Each answer can be at most ${MAX_REFLECTION_CHARS} characters.`;
  }
  if (submit) {
    const missing = REFLECTION_FIELDS.filter((f) => typeof fields[f] !== "string" || (fields[f] as string).trim().length < 5);
    if (missing.length > 0) return "Answer all four questions (at least 5 characters each) before submitting.";
  }
  return null;
}

/** What happens to an existing check-in when a new save arrives for the same project and week. */
export function saveOutcome(existingStatus: string | null, incomingStatus: "draft" | "submitted", sameReference: boolean): "create" | "update" | "already_saved" | "refuse" {
  if (existingStatus === null) return "create";
  if (sameReference) return "already_saved";
  if (existingStatus === "submitted") return "refuse";
  return "update";
}
