/**
 * CSS.escape (MDN algorithm) — must match how Tailwind escapes class names
 * into selectors (`.aspect-\[4\/5\]`), so emitted CSS can be checked back
 * against the candidates that requested it.
 */
export function cssEscape(value: string): string {
  const string = String(value);
  const length = string.length;
  let index = -1;
  let result = "";
  const firstCodeUnit = string.charCodeAt(0);
  while (++index < length) {
    const codeUnit = string.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += "\uFFFD";
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }
    result += `\\${string.charAt(index)}`;
  }
  return result;
}

/**
 * Selector-identifier extraction: every `.identifier` in the stylesheet,
 * honoring backslash escapes — including hex form with its space terminator
 * (`.\32 xl\:flex` for `2xl:flex`) and punctuation form (`\/`, `\[`) —
 * terminating at real selector delimiters. A single pass over the whole CSS
 * (one Set) instead of one indexOf scan per token: a 17k-token audit over
 * 4.5 MB would otherwise spend seconds re-scanning.
 */
const SELECTOR_TOKEN =
  /\.((?:\\[0-9a-fA-F]{1,6}[ ]?|\\.|[^\s,{}():>+~[\].#$])+)/g;

/**
 * Tokens with no selector of their own in the compiled CSS. Exact Set match
 * after cssEscape, so a longer class name's selector cannot satisfy a shorter
 * token (`.h-48` does not cover `h-4`, `.w-1\/2` does not cover `w-1`) and
 * order/duplicates of the input are preserved.
 */
export function findMissingTokens(
  css: string,
  tokens: readonly string[],
): string[] {
  const present = new Set<string>();
  for (const match of css.matchAll(SELECTOR_TOKEN)) {
    present.add(`.${match[1]}`);
  }
  return tokens.filter((token) => !present.has(`.${cssEscape(token)}`));
}
