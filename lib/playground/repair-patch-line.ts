/**
 * Line-level JSON repair for model JSONL streams (plan 054).
 *
 * The client's stream parser (`parseLine` in @json-render/react) discards
 * any line that fails `JSON.parse` — `catch { return null }` — so a single
 * malformed line silently erases its whole patch op (observed live: the
 * model wrote a JS computed key `[":watch"]: …` instead of the JSON
 * `"watch": …`, and the element vanished, leaving dangling child refs).
 * The server relay is the seam we own: it can repair the one observed
 * malformation BEFORE the client parses, and — crucially — LOG what it
 * drops, which the library consumer cannot do.
 *
 * Repairs are deliberately minimal and deterministic (D1): only lines that
 * already failed `JSON.parse` are ever rewritten, and only with the exact
 * transformation observed in the wild. Unknown malformation classes fall
 * through as `invalid` and surface in the server log with a line number.
 */

/** JS computed keys in the model's observed pointer-flavored `[":key"]:`  * form — the leading ":" inside the string is stripped, because the
 * renderer expects the plain property name (`watch`, not `:watch`). */
const POINTER_COMPUTED_KEY = /\[":([^"]+)"\]:/g;
/** Generic JS computed string keys (`["key"]:`) → JSON quoted keys. */
const COMPUTED_KEY = /\[("(?:[^"\\]|\\.)*")\]:/g;

export type LineRepair =
  | { status: "valid"; line: string }
  | { status: "repaired"; line: string }
  | { status: "invalid"; reason: string };

/**
 * Validate one JSONL patch line, repairing the computed-key class on the
 * way. Valid lines come back byte-identical (trimmed) — the fast path
 * never mutates, so string values that merely LOOK like keys are safe.
 */
export function repairPatchLine(rawLine: string): LineRepair {
  const line = rawLine.trim();
  try {
    JSON.parse(line);
    return { status: "valid", line };
  } catch (firstError) {
    const repaired = line
      .replace(POINTER_COMPUTED_KEY, '"$1":')
      .replace(COMPUTED_KEY, "$1:");
    try {
      JSON.parse(repaired);
      return { status: "repaired", line: repaired };
    } catch {
      return {
        status: "invalid",
        reason:
          firstError instanceof Error ? firstError.message : String(firstError),
      };
    }
  }
}

export interface RepairedText {
  text: string;
  repaired: number;
  dropped: Array<{ line: number; prefix: string }>;
}

/**
 * Repair a whole JSONL buffer (edit mode) before validation: valid and
 * repaired lines are kept in order, unparseable lines are dropped and
 * reported with their 1-based line number so the server log can say
 * exactly what was lost.
 */
export function repairPatchText(text: string): RepairedText {
  const lines = text.split("\n");
  const kept: string[] = [];
  const dropped: Array<{ line: number; prefix: string }> = [];
  let repaired = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Blanks and comments pass through untouched (the validators skip them).
    if (!trimmed || trimmed.startsWith("//")) {
      kept.push(line);
      continue;
    }
    const result = repairPatchLine(trimmed);
    if (result.status === "invalid") {
      dropped.push({ line: i + 1, prefix: trimmed.slice(0, 120) });
      continue;
    }
    if (result.status === "repaired") repaired++;
    kept.push(result.line);
  }
  return { text: kept.join("\n"), repaired, dropped };
}
