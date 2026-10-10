/** A live `@query` token immediately before the caret. */
export interface ActiveMention {
  /** Partial key after `@` (may be empty; may carry a `#N` index suffix). */
  query: string;
  /** Index of the `@` in the full text. */
  start: number;
  /** Caret index (end of the partial token). */
  end: number;
}

// `#` and digits are part of the charset so an inserted instance token
// (`@product-image#2`) still reads as one token — the caret landing back on
// it re-opens the picker scoped to that instance instead of truncating.
const MENTION_BEFORE_CARET = /(?:^|\s)@([\w#-]*)$/;

/**
 * The `@query` token the caret currently sits at the end of, if any. The
 * token must start the text or follow whitespace so emails and mid-word
 * `@`s never open the picker.
 */
export function findActiveMention(
  text: string,
  caret: number,
): ActiveMention | null {
  const before = text.slice(0, caret);
  const match = MENTION_BEFORE_CARET.exec(before);
  if (!match) return null;
  return {
    query: match[1],
    start: match.index + (match[0].length - match[1].length - 1),
    end: caret,
  };
}

/** Replace the active partial token with `@tokenBody`; returns the new text
 *  and the caret position after the inserted token. `tokenBody` is the chip
 *  key, plus `#N` for instance chips. */
export function insertMention(
  text: string,
  mention: ActiveMention,
  tokenBody: string,
): { text: string; caret: number } {
  const token = `@${tokenBody}`;
  return {
    text: text.slice(0, mention.start) + token + text.slice(mention.end),
    caret: mention.start + token.length,
  };
}
