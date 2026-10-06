const PATCH_OPS = new Set(["add", "replace", "remove", "move", "copy", "test"]);

export type ValidatePatchResult =
  { ok: true; patchCount: number } | { ok: false; reason: string };

/**
 * Mirrors `parseLine` from @json-render/react (trim, blank/`//` skips,
 * `__meta: "usage"` passthrough) and adds the schema check the client's
 * applySpecPatch silently assumes: a string JsonPatch `op` from the
 * standard set and a non-empty `path`. At least one patch line required —
 * a stream with only comments/usage/fragments is an incomplete patch.
 */
export function validatePatchText(text: string): ValidatePatchResult {
  const lines = text.split("\n");
  let patchCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: `line ${i + 1} is not valid JSON` };
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { __meta?: unknown }).__meta === "usage"
    ) {
      continue;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, reason: `line ${i + 1} is not a patch object` };
    }

    const { op, path } = parsed as { op?: unknown; path?: unknown };
    if (typeof op !== "string" || !PATCH_OPS.has(op)) {
      return { ok: false, reason: `line ${i + 1} has an unsupported op` };
    }
    if (typeof path !== "string" || path.length === 0) {
      return { ok: false, reason: `line ${i + 1} is missing a path` };
    }
    patchCount++;
  }

  if (patchCount === 0) {
    return { ok: false, reason: "no patch lines found" };
  }
  return { ok: true, patchCount };
}
