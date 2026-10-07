/**
 * Splits a className value into its whitespace-separated tokens.
 * Non-string input (null, undefined, expression objects) → [].
 */
export function toClassTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(/\s+/).filter((token) => token !== "");
}

/**
 * Joins tokens into a canonical className string: each token trimmed,
 * empties dropped, single spaces between. Empty result → "".
 */
export function joinClassTokens(tokens: readonly string[]): string {
  return tokens
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .join(" ");
}
