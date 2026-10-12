import { getSupabase } from "../db/supabaseClient.js";

export interface AuditEntry {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}

/** Records an admin decision. A failed write is reported loudly, but it does not undo
 *  the decision: the decision is already made, and a gap in the log is better than a
 *  payment or admission being rolled back because the log was unavailable. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const { error } = await getSupabase().from("admin_audit_log").insert({
    actor: entry.actor,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    detail: entry.detail ?? null,
  });
  if (error) console.error("[audit] could not record", entry.action, entry.entityId, error.message);
}

export async function listAudit(limit: number) {
  const { data, error } = await getSupabase()
    .from("admin_audit_log")
    .select("id, actor, action, entity_type, entity_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listAudit failed: ${error.message}`);
  return data || [];
}
