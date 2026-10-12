import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getSupabase } from "../db/supabaseClient.js";
import { normaliseUsername, validateNewStaffAccount } from "./staffValidation.js";

export interface StaffIdentity {
  id: string;
  username: string;
  fullName: string;
  role: string;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing required env var JWT_SECRET — check your .env file.");
  return secret;
}

function issueToken(identity: StaffIdentity): string {
  return jwt.sign({ sub: identity.id, username: identity.username, role: identity.role, type: "staff" },
    jwtSecret(), { expiresIn: "12h" });
}

/** Returns a session for an active account with the right password, otherwise null.
 *  The same null covers unknown user, disabled account and wrong password, so the
 *  response reveals nothing about which one failed. */
export async function loginStaff(username: string, password: string): Promise<{ token: string; staff: StaffIdentity } | null> {
  const { data, error } = await getSupabase()
    .from("staff_accounts").select("id, username, full_name, role, active, password_hash")
    .eq("username", normaliseUsername(username)).maybeSingle();
  if (error || !data || !data.active) return null;
  if (!(await bcrypt.compare(password, data.password_hash))) return null;
  const staff = { id: data.id, username: data.username, fullName: data.full_name, role: data.role };
  return { token: issueToken(staff), staff };
}

/** Checks a staff session on every request. Looking the account up each time means a
 *  disabled account stops working immediately, even while its token is still valid. */
export async function verifyStaffToken(token: string): Promise<StaffIdentity | null> {
  const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
  if (payload.type !== "staff" || typeof payload.sub !== "string") return null;
  const { data, error } = await getSupabase()
    .from("staff_accounts").select("id, username, full_name, role, active").eq("id", payload.sub).maybeSingle();
  if (error || !data || !data.active) return null;
  return { id: data.id, username: data.username, fullName: data.full_name, role: data.role };
}

export async function createStaffAccount(input: { username: string; password: string; fullName: string; role: string }) {
  const problem = validateNewStaffAccount(input);
  if (problem) throw new Error(problem);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const { data, error } = await getSupabase().from("staff_accounts")
    .insert({ username: normaliseUsername(input.username), password_hash: passwordHash, full_name: input.fullName.trim(), role: input.role })
    .select("id, username, full_name, role, active, created_at").single();
  if (error) {
    if (error.code === "23505") throw new Error("That username is already taken.");
    throw new Error(`createStaffAccount failed: ${error.message}`);
  }
  return data;
}

export async function listStaffAccounts() {
  const { data, error } = await getSupabase().from("staff_accounts")
    .select("id, username, full_name, role, active, created_at").order("created_at", { ascending: true });
  if (error) throw new Error(`listStaffAccounts failed: ${error.message}`);
  return data || [];
}

export async function setStaffAccountActive(id: string, active: boolean) {
  const { error } = await getSupabase().from("staff_accounts").update({ active }).eq("id", id);
  if (error) throw new Error(`setStaffAccountActive failed: ${error.message}`);
  return { success: true };
}
