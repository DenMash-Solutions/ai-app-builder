/** Reserved slug segments that collide with static route names. */
export const RESERVED_SLUGS = {
  ui: "ui",
} as const;

export const SLUG_MAX_LENGTH = 48;

/** Lowercase alphanumerics joined by single hyphens (no leading/trailing). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalize free text into a URL slug: diacritics stripped (NFD), casing
 * lowered, every non-alphanumeric run collapsed to a hyphen, capped at
 * SLUG_MAX_LENGTH without ending mid-word on a hyphen.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isReservedSlug(slug: string): boolean {
  return (Object.values(RESERVED_SLUGS) as string[]).includes(slug);
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * Deterministic unique slug for a new entry: the slugified name/prompt
 * (truncated to leave room for the tail) plus a short id tail, so two
 * entries seeded from the same prompt never collide.
 */
export function uniqueSlugFrom(name: string, id: string): string {
  const base = slugify(name).slice(0, 40).replace(/-+$/g, "");
  const tail = id.replaceAll("-", "").slice(0, 8);
  return `${base || RESERVED_SLUGS.ui}-${tail}`;
}
