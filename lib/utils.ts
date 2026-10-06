export { cn } from "cn";

/**
 * Structural deep-equal for JSON-shaped specs: key order is ignored,
 * array order is significant. Object.is so NaN compares equal (JSON
 * specs never carry it, but stringify-based comparison would reject
 * reordered keys, which applyPatch output is prone to).
 */
export function specsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => specsEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      specsEqual(aRecord[key], bRecord[key]),
  );
}
