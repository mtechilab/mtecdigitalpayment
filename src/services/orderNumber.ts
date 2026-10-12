/** Monime's order number, found by key name. The exact field path was never confirmed
 *  from a real delivery, so this searches for it; the full payload is stored beside it. */
export function findOrderNumber(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (/order/i.test(key) && typeof value === "string" && value.trim().length >= 4 && value.trim().length <= 40) {
      return value.trim();
    }
    // An "order" object: take its first short string, e.g. order.number
    if (/order/i.test(key) && value !== null && typeof value === "object") {
      for (const inner of Object.values(value as Record<string, unknown>)) {
        if (typeof inner === "string" && inner.trim().length >= 4 && inner.trim().length <= 40) return inner.trim();
      }
    }
    const nested = findOrderNumber(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}
