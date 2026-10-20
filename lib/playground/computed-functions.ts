// D7 (docs/plan/040-catalog-icons): catalog-level computed functions. The model
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
 * Page window shared by the pagination functions — the same fallbacks
 * everywhere: non-array `source` behaves as a one-page empty list, a
 * missing / non-positive / non-number `limit` degrades to "the whole
 * source is one page", a non-number `page` reads as 0.
 */
function pageWindow(args: Record<string, unknown>): {
  source: unknown[];
  limit: number;
  clamped: number;
  maxPage: number;
} {
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
  return {
    source,
    limit,
    clamped: Math.min(Math.max(page, 0), maxPage),
    maxPage,
  };
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
  const { source, limit, clamped } = pageWindow(args);
  return source.slice(clamped * limit, clamped * limit + limit);
}

/**
 * Next/previous page number, clamped — how press actions must move `/page`
 * (D2 of docs/plan/041-responsive-ui): the page state itself can never reach
 * −1 or past the end, so label and slice always agree. Delta applies to the
 * clamped page (what the user sees), then the result is clamped again.
 * - `delta`: steps to move (Next: 1, Previous: −1); non-number → 0.
 * - `page`, `source`, `limit`: read with the same semantics as
 *   `sliceItems` (see `pageWindow`).
 */
export function stepPage(args: Record<string, unknown>): unknown {
  const delta =
    typeof args.delta === "number" && Number.isFinite(args.delta)
      ? Math.trunc(args.delta)
      : 0;
  const { clamped, maxPage } = pageWindow(args);
  return Math.min(Math.max(clamped + delta, 0), maxPage);
}

/**
 * "Page 1 of 2" — the pagination position label (D2 of
 * docs/plan/041-responsive-ui): 1-based numbers with the true page count, unlike
 * a `{"$template"}` which interpolates raw state and cannot compute bounds.
 * Specs use it as a Text `text` prop.
 */
export function pageLabel(args: Record<string, unknown>): unknown {
  const { clamped, maxPage } = pageWindow(args);
  return `Page ${clamped + 1} of ${maxPage + 1}`;
}

/** Computed functions handed to every `<JSONUIProvider>` (playground,
 *  spec page, live pages). Pagination moves `/page` through `stepPage` and
 *  labels it with `pageLabel` (D2, docs/plan/041-responsive-ui). */
export const PLAYGROUND_FUNCTIONS = {
  filterItems,
  sliceItems,
  stepPage,
  pageLabel,
} as const;
