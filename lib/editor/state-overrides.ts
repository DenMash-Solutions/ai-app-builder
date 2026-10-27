/**
 * Session-only registry of state overrides made from the editor's States tab
 * (plan 058 step 3). Captures the original value of every path the editor
 * overwrites so "Reset overrides" can restore it, and lets the tab re-render
 * via `useSyncExternalStore`.
 *
 * Deliberately module-scoped: it survives tab switches and panel unmounts
 * (a half-finished force-preview must not lose its reset button) and dies on
 * page reload — overrides are runtime state only, never written to
 * `spec.state`.
 */

const EMPTY: Readonly<Record<string, unknown>> = Object.freeze({});

let originals: Readonly<Record<string, unknown>> = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const stateOverrides = {
  has(path: string): boolean {
    return path in originals;
  },

  count(): number {
    return Object.keys(originals).length;
  },

  /** The value captured before the first override (only valid if `has`). */
  original(path: string): unknown {
    return originals[path];
  },

  /**
   * Remember the pre-override value. No-op if the path was already
   * overridden — the FIRST original wins, so repeated edits reset cleanly.
   * Returns true when this call recorded a new override.
   */
  record(path: string, original: unknown): boolean {
    if (path in originals) return false;
    originals = { ...originals, [path]: original };
    emit();
    return true;
  },

  /**
   * Drop every override and return `[path, original]` pairs for the caller
   * to re-apply through the state provider.
   */
  clear(): Array<[string, unknown]> {
    const entries = Object.entries(originals) as Array<[string, unknown]>;
    if (entries.length === 0) return entries;
    originals = EMPTY;
    emit();
    return entries;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): Readonly<Record<string, unknown>> {
    return originals;
  },
};

/**
 * Parses an override input: JSON first (numbers, booleans, null, quoted
 * strings, objects/arrays), raw string as the fallback ("loading" stays a
 * string — conditions compare against raw values).
 */
export function parseStateInput(raw: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return raw;
  }
}
