/** Rules for staff accounts. Kept free of database and crypto imports so they can be tested directly. */
export const STAFF_ROLES = ["staff", "lecturer"] as const;

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Returns the first problem with a new account, or null when it is valid. */
export function validateNewStaffAccount(input: { username: string; password: string; fullName: string; role: string }): string | null {
  const username = normaliseUsername(input.username);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return "Username must be 3 to 40 characters: letters, numbers, dot, dash or underscore.";
  }
  if (input.password.length < 8) return "Password must be at least 8 characters.";
  if (input.password.length > 200) return "Password is too long.";
  if (!input.fullName.trim()) return "Full name is required.";
  if (!(STAFF_ROLES as readonly string[]).includes(input.role)) return "Role must be staff or lecturer.";
  return null;
}
