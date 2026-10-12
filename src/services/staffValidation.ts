/** Rules for staff accounts. Free of database and crypto imports so they can be tested directly. */
export const STAFF_ROLES = ["staff", "lecturer", "administrator"] as const;
export type StaffRoleName = typeof STAFF_ROLES[number];

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Lecturers and administrators both teach: they can use the library and the AI studio.
 *  Administrators also manage library items they did not upload. */
export function canTeach(role: string): boolean {
  return role === "lecturer" || role === "administrator";
}

export function isAdministratorRole(role: string): boolean {
  return role === "administrator";
}

/** The first problem with a new account, or null when it is valid. */
export function validateNewStaffAccount(input: { username: string; password: string; fullName: string; role: string }): string | null {
  const username = normaliseUsername(input.username);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return "Username must be 3 to 40 characters: letters, numbers, dot, dash or underscore.";
  }
  if (input.password.length < 8) return "Password must be at least 8 characters.";
  if (input.password.length > 200) return "Password is too long.";
  if (!input.fullName.trim()) return "Full name is required.";
  if (!(STAFF_ROLES as readonly string[]).includes(input.role)) return "Role must be staff, lecturer or administrator.";
  return null;
}

/** The first problem with an update, or null. Only the fields given are checked. */
export function validateStaffUpdate(input: { fullName?: string; role?: string; password?: string }): string | null {
  if (input.fullName !== undefined && !input.fullName.trim()) return "Full name cannot be empty.";
  if (input.role !== undefined && !(STAFF_ROLES as readonly string[]).includes(input.role)) {
    return "Role must be staff, lecturer or administrator.";
  }
  if (input.password !== undefined && (input.password.length < 8 || input.password.length > 200)) {
    return "Password must be 8 to 200 characters.";
  }
  return null;
}
