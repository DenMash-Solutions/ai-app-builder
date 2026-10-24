import { createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/core";

/**
 * Root-member recovery for the playground stream (plan 043 rev 1.3,
 * generalized by plan 054).
 *
 * `useUIStream` (in `@json-render/react`) applies streamed patches through
 * its own `setSpecValue`, which only understands `/root`, `/state`,
 * `/state/*` and `/elements/*` — every OTHER top-level member
 * (`dataSources`, `resources`, `queries`, `urlSync`, any future extension)
 * is **silently dropped** mid-stream (verified against 0.21.0 and 0.21.1:
 * the unknown path falls through all branches with no warning). The raw
 * JSONL lines are intact though, so the completion seam re-folds them with
 * the core SpecStream compiler (which accepts arbitrary root members) and
 * merges every non-renderer root member back onto the completed spec.
 *
 * The invariant (plan 054, D6): the renderer applier owns exactly
 * `root`/`state`/`elements` — everything else is recovered from lines, so
 * a new top-level extension survives without touching this module.
 *
 * Steer-safe by construction: `useUIStream` shallow-spreads the previous
 * spec, so a steer's base blocks survive untouched; only members THIS
 * stream declares are merged over them. Everything else in the completed
 * spec keeps coming from `useUIStream`'s own applier.
 */

/** Root members `setSpecValue` applies itself — never merged from lines. */
const RENDERER_APPLIED_ROOT_KEYS = new Set(["root", "state", "elements"]);

export function withRootBlocksFromLines(
  spec: Spec,
  rawLines: readonly string[],
): Spec {
  const compiler = createSpecStreamCompiler<Record<string, unknown>>();
  for (const line of rawLines) {
    compiler.push(`${line}\n`);
  }
  const compiled = compiler.getResult();
  if (!compiled) return spec;

  const recovered: Record<string, unknown> = {};
  let found = false;
  for (const key of Object.keys(compiled)) {
    if (RENDERER_APPLIED_ROOT_KEYS.has(key)) continue;
    if (compiled[key] !== undefined) {
      recovered[key] = compiled[key];
      found = true;
    }
  }
  return found ? ({ ...spec, ...recovered } as Spec) : spec;
}
