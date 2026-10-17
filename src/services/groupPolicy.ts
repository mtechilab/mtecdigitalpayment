/** Group rules. No database or network imports, so they can be tested directly. */
export const MAX_GROUP_MEMBERS = 50;
export const MIN_GROUP_NAME = 2;
export const MAX_GROUP_NAME = 60;

export interface MemberRef { kind: "student" | "staff"; id: string }

export function validateGroupName(name: string): string | null {
  const t = name.trim();
  if (t.length < MIN_GROUP_NAME || t.length > MAX_GROUP_NAME) return `The group name must be ${MIN_GROUP_NAME} to ${MAX_GROUP_NAME} characters.`;
  return null;
}

/** The people to add, not counting the creator. Each is a student or staff member, listed once. */
export function validateMemberList(list: unknown, creator: MemberRef): string | null {
  if (!Array.isArray(list) || list.length === 0) return "Choose at least one person to add.";
  if (list.length > MAX_GROUP_MEMBERS - 1) return `A group can have at most ${MAX_GROUP_MEMBERS} people.`;
  const seen = new Set<string>();
  for (const item of list) {
    const ref = item as { kind?: unknown; id?: unknown };
    if (ref.kind !== "student" && ref.kind !== "staff") return "One of the people could not be read.";
    if (typeof ref.id !== "string" || ref.id.length < 8) return "One of the people could not be read.";
    const key = `${ref.kind}:${ref.id}`;
    if (ref.kind === creator.kind && ref.id === creator.id) return "You are already in the group.";
    if (seen.has(key)) return "The same person was chosen twice.";
    seen.add(key);
  }
  return null;
}

export function groupHasRoom(currentMembers: number): boolean {
  return currentMembers < MAX_GROUP_MEMBERS;
}
