import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { buildUserPrompt, isNonEmptySpec } from "@json-render/core";
import { playgroundCatalog } from "@/lib/playground/catalog";
import { RATE_LIMIT_PATTERN, resolveModel } from "@/lib/playground/models";

export const maxDuration = 60;

const COMPLETENESS_RULES = `
Additional rules:
- Emit the COMPLETE spec: every section you start must be fully written with all of its child elements before you finish.
- Never stop at a section header or an opening container — if you begin a section, finish it.
- Prefer fewer components fully written over many components left half-finished.
- End the stream only after the last section is complete.`;

const STYLING_RULES = `
Styling rules:
- Prefer the "className" prop with Tailwind utility classes for visual styling (colors, spacing, layout, typography).
- Put interaction states in className: hover:, focus-visible:, active:, dark: variants (e.g. "hover:bg-blue-300").
- Use the "style" prop only for exact values Tailwind classes cannot express, and never set the same CSS property in both.`;

interface GenerateBody {
  prompt?: unknown;
  currentSpec?: unknown;
  context?: { model?: unknown } | null;
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    if ((error as { statusCode?: number }).statusCode === 429) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERN.test(message);
}

/**
 * Quota failures must arrive as real HTTP responses (the client classifies
 * them from the status/message) — they cannot surface mid-stream.
 */
function errorResponse(error: unknown, model: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[generate] model=${model} failed: ${message}`);
  if (isRateLimitError(error)) {
    return Response.json(
      {
        error: `Rate limit reached for ${model}. Switch model and retry.`,
        code: "rate_limit",
      },
      { status: 429 },
    );
  }
  return Response.json({ error: message, code: "internal" }, { status: 500 });
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      {
        error:
          "GOOGLE_GENERATIVE_AI_API_KEY is not set. Copy .env.example to .env.local, add your key, and restart the dev server.",
      },
      { status: 500 },
    );
  }

  const body = (await req.json()) as GenerateBody;
  const { prompt, currentSpec, context } = body;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return Response.json(
      { error: "A non-empty 'prompt' string is required" },
      { status: 400 },
    );
  }

  const model = resolveModel(context?.model ?? process.env.GEMINI_MODEL);
  const spec = isNonEmptySpec(currentSpec) ? currentSpec : null;
  const isEdit = spec !== null;

  // Edit mode documents JSONL patch semantics; completeness rules only apply
  // to fresh generations (a patch never needs to "finish every section").
  const systemPrompt =
    playgroundCatalog.prompt({ editModes: ["patch"] }) +
    STYLING_RULES +
    (isEdit ? "" : COMPLETENESS_RULES);

  const userPrompt = buildUserPrompt({
    prompt,
    currentSpec: spec,
    editModes: ["patch"],
  });

  const result = streamText({
    model: google(model),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.7,
    onFinish: ({ finishReason, usage, text }) => {
      console.log(
        `[${isEdit ? "edit" : "generate"}] finish=${finishReason} in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`,
      );
      console.log(`[generate] tail=${JSON.stringify(text.slice(-300))}`);
    },
  });

  // Wait for the first chunk before committing to a 200 stream so upstream
  // quota/rate-limit errors surface as classifiable HTTP responses.
  const iterator = result.textStream[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    return errorResponse(error, model);
  }

  const stream = new ReadableStream<string>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(first.value);
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          controller.enqueue(next.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      void iterator.return?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
