export type StyleRecord = Record<string, string | number>;

const PURE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function toCamelCase(key: string): string {
  if (key.startsWith("--")) return key;
  return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Parses CSS-declaration text ("width: 100%; background-color: #e0f2fe")
 * into a React style record. Accepts kebab-case and camelCase keys.
 * Returns null for empty input or malformed declarations.
 */
export function parseStyleText(text: string): StyleRecord | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const style: StyleRecord = {};
  for (const segment of trimmed.split(";")) {
    const raw = segment.trim();
    if (raw === "") continue;
    const colon = raw.indexOf(":");
    if (colon === -1) return null;
    const key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (key === "" || value === "") return null;
    style[toCamelCase(key)] = PURE_NUMBER.test(value) ? Number(value) : value;
  }

  return Object.keys(style).length > 0 ? style : null;
}

/**
 * Serializes a React style record to canonical declaration text
 * ("width: 100%; backgroundColor: #e0f2fe"). Non-object input → "".
 */
export function serializeStyleText(style: unknown): string {
  if (typeof style !== "object" || style === null || Array.isArray(style)) {
    return "";
  }
  return Object.entries(style as StyleRecord)
    .filter(
      ([, value]) => typeof value === "string" || typeof value === "number",
    )
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}
