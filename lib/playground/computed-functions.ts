// D7 (docs/plan/catalog-icons): catalog-level computed functions. The model
// prompt auto-lists their names, and specs may call them anywhere an
// expression is allowed — props or action params — as
// `{ "$computed": "<name>", "args": { … } }`.

/**
 * Case-insensitive substring filter over an array — the search/filter
 * primitive specs bind to an Input's `change` event.
 *
 * - `source`: array to filter; anything else yields `[]`.
 * - `query`: search text; empty/whitespace returns `source` unchanged so the
 *   seeded "show everything" state survives clearing the field.
 * - `fields`: optional keys to match; without it (or with no usable keys)
 *   every string / number / boolean value of an object item is searched.
 *   Plain string entries always match against `query` directly.
 */
export function filterItems(args: Record<string, unknown>): unknown {
  const source = Array.isArray(args.source) ? args.source : [];
  const query =
    typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  if (query.length === 0) return source;

  const fields =
    Array.isArray(args.fields) && args.fields.length > 0
      ? args.fields.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
  const keys = fields.length > 0 ? fields : null;

  return source.filter((entry) => {
    if (typeof entry === "string") return entry.toLowerCase().includes(query);
    if (entry === null || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    const searchKeys = keys ?? Object.keys(record);
    return searchKeys.some((key) => {
      const value = record[key];
      if (typeof value === "string") return value.toLowerCase().includes(query);
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value).toLowerCase().includes(query);
      }
      return false;
    });
  });
}

/**
 * One page of `source` — the pagination primitive (D8). `page * limit`
 * arithmetic lives inside the function because specs cannot compute it
 * (and repeat paths read raw state, so this result must be written back
 * through setState).
 * - `page`: 0-based index, clamped into `[0, maxPage]` — an over-eager
 *   Previous/Next lands on the edge page instead of blanking the list;
 *   non-number → 0.
 * - `limit`: items per page; missing/non-positive/non-number → the whole
 *   source (a spec without a sane limit degrades to "show everything").
 * - non-array source → `[]`.
 */
export function sliceItems(args: Record<string, unknown>): unknown {
  const source = Array.isArray(args.source) ? args.source : [];
  const limit =
    typeof args.limit === "number" &&
    Number.isFinite(args.limit) &&
    args.limit > 0
      ? Math.floor(args.limit)
      : source.length;
  const page =
    typeof args.page === "number" && Number.isFinite(args.page)
      ? Math.floor(args.page)
      : 0;
  const maxPage =
    limit > 0 ? Math.max(0, Math.ceil(source.length / limit) - 1) : 0;
  const clamped = Math.min(Math.max(page, 0), maxPage);
  return source.slice(clamped * limit, clamped * limit + limit);
}

/** Computed functions handed to every `<JSONUIProvider>` (playground,
 *  spec page, live pages). Page increments use the prompt-documented `$math`
 *  directive instead of a bespoke `add` (D8r). */
export const PLAYGROUND_FUNCTIONS = {
  filterItems,
  sliceItems,
} as const;
