import type { UIElement } from "@json-render/core";

/**
 * State-inspector logic (plan 058 step 2): which state paths an element
 * reads, and how live state values render in the States tab.
 */

/** Depth cap + truncation guards for pathological state payloads. */
const MAX_DEPTH = 6;
const MAX_STRING = 120;

/** Collects every `$state` JSON Pointer inside an arbitrary condition/value. */
export function collectStatePointers(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "$state" && typeof child === "string") {
          found.add(child);
        } else {
          walk(child, depth + 1);
        }
      }
    }
  };
  walk(value, 0);
  return [...found];
}

/**
 * All state paths the selected element depends on: its `visible` condition
 * (recursed — arrays/`$or` nest), every `watch` key, and a string
 * `repeat.statePath`. Item-scoped repeat paths (`{ $item: … }`) are not
 * global pointers and are skipped.
 */
export function elementStatePaths(element: UIElement): string[] {
  const paths = new Set<string>();
  if (element.visible !== undefined && element.visible !== true) {
    for (const path of collectStatePointers(element.visible)) paths.add(path);
  }
  for (const path of Object.keys(element.watch ?? {})) paths.add(path);
  const repeatPath = element.repeat?.statePath;
  if (typeof repeatPath === "string") paths.add(repeatPath);
  return [...paths];
}

export interface StateRow {
  path: string;
  /** Human-readable rendering for the inspector list. */
  display: string;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[…] ${value.length} items`;
  if (typeof value === "object") return `{…} ${Object.keys(value).length} keys`;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `"${value.slice(0, MAX_STRING)}…"`
      : value;
  }
  return String(value);
}

/**
 * Flattens live state into sorted pointer rows for the inspector. Arrays and
 * nested objects collapse to a summary (`[…] 12 items`) — the list is an
 * at-a-glance map, not a data browser.
 */
export function flattenStateRows(state: Record<string, unknown>): StateRow[] {
  const rows: StateRow[] = [];
  const walk = (
    node: Record<string, unknown>,
    prefix: string,
    depth: number,
  ): void => {
    if (depth > MAX_DEPTH) return;
    for (const [key, value] of Object.entries(node)) {
      const path = `${prefix}/${key}`;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        const childKeys = Object.keys(value);
        if (childKeys.length > 0 && depth < MAX_DEPTH) {
          walk(value as Record<string, unknown>, path, depth + 1);
          continue;
        }
      }
      rows.push({ path, display: formatValue(value) });
    }
  };
  walk(state, "", 0);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export interface SplitStateRows {
  /** Rows referenced by the element (condition / watch / repeat) — first group. */
  used: StateRow[];
  /** Everything else — second group. */
  other: StateRow[];
}

/**
 * Splits flattened rows into the two accordion groups of the States tab.
 * A used path with no row in the store is appended to `used` with display
 * "—" so the "why is this hidden?" answer is never missing.
 */
export function splitStateRows(
  rows: StateRow[],
  usedPaths: Iterable<string>,
): SplitStateRows {
  const usedSet = new Set(usedPaths);
  const used: StateRow[] = [];
  const other: StateRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (usedSet.has(row.path)) {
      used.push(row);
      seen.add(row.path);
    } else {
      other.push(row);
    }
  }
  for (const path of usedSet) {
    if (!seen.has(path)) used.push({ path, display: "—" });
  }
  return { used, other };
}
