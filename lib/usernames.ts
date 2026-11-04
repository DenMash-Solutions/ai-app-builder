import {
  isValidSlug,
  isReservedSlug,
  SLUG_MAX_LENGTH,
  slugify,
} from "@/lib/slug";

/**
 * Usernames (plan 068) are the public handle in `/user/<username>/ui`. They
 * reuse the slug grammar so one URL space stays consistent (062 decision 1):
 * lowercase alphanumerics joined by single hyphens.
 *
 * The database enforces shape and uniqueness (`profiles_username_check`,
 * `profiles_username_key`); this module is the app-side gate that also owns
 * the rules SQL deliberately does not copy — the reserved segment list
 * (`RESERVED_SLUGS`) and the minimum length.
 */

export const USERNAME_MIN_LENGTH = 3;

/** Why a handle cannot be used. `taken` is the only one that needs a round
 *  trip (`usernameIssue` never returns it); it lives here so every surface
 *  shares one translation table. */
export const USERNAME_ISSUES = {
  empty: "empty",
  tooShort: "tooShort",
  tooLong: "tooLong",
  pattern: "pattern",
  reserved: "reserved",
  taken: "taken",
} as const;

export type UsernameIssue =
  (typeof USERNAME_ISSUES)[keyof typeof USERNAME_ISSUES];

/**
 * Canonical stored form: the slug normalization (diacritics stripped, lower
 * cased, junk collapsed) — the same function the manual typing path and the
 * signup metadata both pass through, so `Ana López` and `ana-lopez` cannot end
 * up as two different rows.
 */
export function normalizeUsername(input: string): string {
  return slugify(input);
}

/** Shape/reserved verdict for an already-normalized handle, or null when it
 *  is usable. Reserved comes before length so `ui` reports "reserved" (the
 *  real reason) instead of "too short". */
export function usernameIssue(normalized: string): UsernameIssue | null {
  if (normalized.length === 0) return USERNAME_ISSUES.empty;
  if (isReservedSlug(normalized)) return USERNAME_ISSUES.reserved;
  if (normalized.length < USERNAME_MIN_LENGTH) return USERNAME_ISSUES.tooShort;
  if (normalized.length > SLUG_MAX_LENGTH) return USERNAME_ISSUES.tooLong;
  if (!isValidSlug(normalized)) return USERNAME_ISSUES.pattern;
  return null;
}

/** One call for the UI: normalize free text, then judge the result. */
export function checkUsername(input: string): {
  username: string;
  issue: UsernameIssue | null;
} {
  const username = normalizeUsername(input);
  return { username, issue: usernameIssue(username) };
}
