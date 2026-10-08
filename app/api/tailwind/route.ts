import { sanitizeCandidates } from "@/lib/runtime-classes/candidates";
import { buildForCandidates } from "@/lib/runtime-classes/compile";

/** In-process response cache — same candidate set → same CSS. */
const CACHE_LIMIT = 64;
const cache = new Map<string, { css: string; missing: string[] }>();

/**
 * On-demand Tailwind compile: POST class tokens, get CSS back. Tokens that
 * produce no rule (invalid utilities) are listed in `missing` so the editor
 * can badge them instead of failing silently.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as { candidates?: unknown };
  const sanitized = sanitizeCandidates(payload.candidates);
  if (!sanitized) {
    return Response.json(
      { error: "`candidates` must be an array of strings" },
      { status: 400 },
    );
  }

  const { candidates, invalid } = sanitized;
  const key = candidates.join("\u0000");
  const cached = cache.get(key);
  if (cached) {
    return Response.json({
      css: cached.css,
      missing: [...cached.missing, ...invalid],
    });
  }

  try {
    const result = await buildForCandidates(candidates);
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, result);
    return Response.json({
      css: result.css,
      missing: [...result.missing, ...invalid],
    });
  } catch (error) {
    console.error("[api/tailwind] compile failed:", error);
    return Response.json({ error: "Compile failed" }, { status: 500 });
  }
}
