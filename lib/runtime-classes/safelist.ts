const INLINE_DIRECTIVE = "@source inline(";

/**
 * Extracts raw patterns from every `@source inline("...")` directive in a
 * stylesheet. Directives are single-line and double-quoted; any other shape
 * (embedded quote, missing terminator, multi-line) throws so unusual syntax
 * fails loudly instead of being silently skipped.
 */
export function extractInlineSources(css: string): string[] {
  const sources: string[] = [];
  for (const line of css.split("\n")) {
    const idx = line.indexOf(INLINE_DIRECTIVE);
    if (idx === -1) continue;
    const open = line.lastIndexOf("/*", idx);
    const close = line.lastIndexOf("*/", idx);
    if (open > close) continue;
    const rest = line.slice(idx + INLINE_DIRECTIVE.length).trim();
    if (!rest.startsWith('"') || !rest.endsWith('");')) {
      throw new Error(`Unsupported @source inline shape: ${line.trim()}`);
    }
    const body = rest.slice(1, -3);
    if (body.includes('"')) {
      throw new Error(`Embedded quote in @source inline: ${line.trim()}`);
    }
    sources.push(body);
  }
  return sources;
}

/**
 * Expands a space-separated Tailwind `@source inline` pattern into concrete
 * candidates: whitespace separates candidates, single-level `{a,b}` groups
 * expand to their alternatives (empty alternatives allowed — `p{,x}` → `p`,
 * `px`), and sequential groups multiply (`{hover:,}bg-{red,blue}` → 4).
 * Nested braces and stray closers throw rather than expand wrongly.
 */
export function expandCandidates(pattern: string): string[] {
  const out: string[] = [];
  for (const part of pattern.trim().split(/\s+/)) {
    if (part) out.push(...expandBraces(part));
  }
  return out;
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) {
    if (pattern.includes("}")) {
      throw new Error(`Stray "}" in safelist pattern: ${pattern}`);
    }
    return [pattern];
  }
  let depth = 0;
  let nested = false;
  let close = -1;
  for (let i = open + 1; i < pattern.length; i++) {
    if (pattern[i] === "{") {
      depth += 1;
      nested = true;
    } else if (pattern[i] === "}") {
      if (depth === 0) {
        close = i;
        break;
      }
      depth -= 1;
    }
  }
  if (close === -1) {
    throw new Error(`Unbalanced "{" in safelist pattern: ${pattern}`);
  }
  if (nested) {
    throw new Error(
      `Nested braces not supported in safelist pattern: ${pattern}`,
    );
  }
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  const out: string[] = [];
  for (const alt of pattern.slice(open + 1, close).split(",")) {
    out.push(...expandBraces(prefix + alt + suffix));
  }
  return out;
}

/** All `@source inline` candidates of a stylesheet, expanded and deduped. */
export function expandGlobalSafelist(css: string): string[] {
  const set = new Set<string>();
  for (const source of extractInlineSources(css)) {
    for (const candidate of expandCandidates(source)) {
      set.add(candidate);
    }
  }
  return [...set];
}
