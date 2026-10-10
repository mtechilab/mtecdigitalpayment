import { Request, Response, NextFunction } from "express";

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

/** Fixed-window, in-memory limiter for brute-forceable public endpoints
 *  (student PIN login is 6 digits = 1,000,000 combinations).
 *
 *  Limits: per client IP, per named endpoint. Per-instance only — a restart
 *  clears counts and multiple instances each count separately. That's enough
 *  to stop one client hammering a single instance; a shared store (Redis) is
 *  the upgrade if the backend ever scales out.
 *
 *  Client IP: behind Render's proxy the proxy APPENDS the real address to
 *  X-Forwarded-For, so the LAST entry is the trustworthy one. The first entry
 *  is client-supplied and spoofable, so it must not be used. */
export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = (req.headers["x-forwarded-for"] as string | undefined) || "";
    const ip = forwarded.split(",").pop()?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();

    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    }

    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    }
    next();
  };
}
