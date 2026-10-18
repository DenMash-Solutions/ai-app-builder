import { createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/core";
import { DATA_BLOCK_KEYS } from "./types";

/**
 * Data-block recovery for the playground stream (plan
 * docs/plan/data-sources, rev 1.3 — found empirically).
 *
 * `useUIStream` (in `@json-render/react`) applies streamed patches through
 * its own `setSpecValue`, which only understands `/root`, `/state`,
 * `/state/*` and `/elements/*` — `add /dataSources|/resources|/queries`
 * lines are **silently dropped** mid-stream (verified against 0.21.0 and
 * 0.21.1). The raw JSONL lines are intact though, so the completion seam
 * re-folds them with the core SpecStream compiler (which accepts arbitrary
 * root members) and merges the three data blocks back onto the completed
 * spec.
 *
 * Steer-safe by construction: `useUIStream` shallow-spreads the previous
 * spec, so a steer's base blocks survive untouched; only this stream's
 * block lines are recovered and merged over them. Everything else in the
 * completed spec keeps coming from `useUIStream`'s own applier.
 */
export function withDataBlocksFromLines(
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
  for (const key of DATA_BLOCK_KEYS) {
    if (compiled[key] !== undefined) {
      recovered[key] = compiled[key];
      found = true;
    }
  }
  return found ? ({ ...spec, ...recovered } as Spec) : spec;
}
