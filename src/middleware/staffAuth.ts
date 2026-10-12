import { Request, Response, NextFunction } from "express";
import { verifyStaffToken, StaffIdentity } from "../services/staffAccountService.js";

/** A request that has passed the staff gate. `staff` is set for individual accounts and is
 *  absent for the legacy shared key, which cannot say who acted. */
export interface StaffRequest extends Request {
  staff?: StaffIdentity;
}

let warnedLegacy = false;

/** Individual staff sessions first (Authorization: Bearer). The shared X-Staff-Token is still
 *  accepted during the transition so existing cash approvals keep working. Remove it once
 *  every staff member has an account. */
export async function requireStaffAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    try {
      const staff = await verifyStaffToken(auth.slice(7));
      if (!staff) return res.status(401).json({ error: "Your staff session has ended. Sign in again." });
      (req as StaffRequest).staff = staff;
      return next();
    } catch {
      return res.status(401).json({ error: "Your staff session has ended. Sign in again." });
    }
  }

  const key = process.env.STAFF_API_KEY;
  if (!key) {
    console.error("[staffAuth] STAFF_API_KEY not set — refusing legacy staff requests.");
    return res.status(401).json({ error: "Sign in with your staff account." });
  }
  if (req.headers["x-staff-token"] !== key) {
    return res.status(401).json({ error: "Sign in with your staff account." });
  }
  if (!warnedLegacy) {
    console.warn("[staffAuth] shared staff key used — move staff to individual accounts.");
    warnedLegacy = true;
  }
  return next();
}
