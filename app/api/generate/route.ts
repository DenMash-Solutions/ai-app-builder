import { appDirectives } from "@/lib/computed/directives";
import { playgroundCatalog } from "@/lib/playground/catalog";
import {
  FIRST_CHUNK_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  StreamTimeoutError,
  withDeadline,
} from "@/lib/playground/deadline";
import { i18nRules } from "@/lib/playground/i18n-rules";
import { RATE_LIMIT_PATTERN, resolveModel } from "@/lib/playground/models";
import { validatePatchText } from "@/lib/playground/patch-text";
import { STYLING_RULES } from "@/lib/playground/styling-rules";
import { google } from "@ai-sdk/google";
import { buildUserPrompt, isNonEmptySpec } from "@json-render/core";
import { streamText } from "ai";

export const maxDuration = 60;

const COMPLETENESS_RULES = `
Additional rules:
- Emit the COMPLETE spec: every section you start must be fully written with all of its child elements before you finish.
- Never stop at a section header or an opening container — if you begin a section, finish it.
- Prefer fewer components fully written over many components left half-finished.
- End the stream only after the last section is complete.`;

interface GenerateBody {
  prompt?: unknown;
  currentSpec?: unknown;
  context?: { model?: unknown; locale?: unknown } | null;
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    if ((error as { statusCode?: number }).statusCode === 429) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERN.test(message);
}

/**
 * Quota and unavailable-service failures must arrive as real HTTP responses
 * (the client classifies them from the status/message) — they cannot surface
 * mid-stream.
 */
function errorResponse(error: unknown, model: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[generate] model=${model} failed: ${message}`);
  if (error instanceof StreamTimeoutError) {
    return Response.json(
      { error: error.message, code: "service_unavailable" },
      { status: 503 },
    );
  }
  if (isRateLimitError(error)) {
    return Response.json(
      {
        error: `Rate limit reached for ${model}. Switch model and retry.`,
        code: "rate_limit",
      },
      { status: 429 },
    );
  }
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: number }).statusCode
      : undefined;
  if (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600) {
    return Response.json(
      {
        error: `Service unavailable: ${message}`,
        code: "service_unavailable",
      },
      { status: 503 },
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
  const locale =
    typeof context?.locale === "string" ? context.locale : undefined;
  const spec = isNonEmptySpec(currentSpec) ? currentSpec : null;
  const isEdit = spec !== null;

  // One deadline per request: on timeout the upstream call is aborted (so a
  // dead model stops consuming quota/connections) and the wait rejects with a
  // classified StreamTimeoutError → 503 service_unavailable.
  const abort = new AbortController();
  const onTimeout = () => {
    abort.abort();
    return new StreamTimeoutError(model);
  };

  // Edit mode documents JSONL patch semantics; completeness rules only apply
  // to fresh generations (a patch never needs to "finish every section").
  // The language contract applies to both — edits add copy too.
  const systemPrompt =
    playgroundCatalog.prompt({
      editModes: ["patch"],
      directives: appDirectives,
    }) +
    STYLING_RULES +
    i18nRules(locale) +
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
    abortSignal: abort.signal,
    onFinish: ({ finishReason, usage, text }) => {
      console.log(
        `[${isEdit ? "edit" : "generate"}] finish=${finishReason} in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`,
      );
      console.log(`[generate] tail=${JSON.stringify(text.slice(-300))}`);
    },
  });

  // The upstream finished before producing any text: the model returned no
  // response (observed with unavailable model ids — a 200 here would reach
  // the client as a silent "success" with an empty spec).
  const emptyCompletion = (): Response => {
    console.error(`[generate] model=${model} failed: empty completion`);
    return Response.json(
      {
        error: `Service unavailable: ${model} returned no response — switch model and retry.`,
        code: "service_unavailable",
      },
      { status: 503 },
    );
  };

  // Edit mode buffers the whole response and validates JSONL completeness
  // before replying: the client applies ops line by line, so a partial 200
  // would commit a half-applied patch (observed: lite streams dying mid-
  // JSONL with finishReason=stop). One retry absorbs the ~1-in-4 flake;
  // still-invalid streams arrive as a classified 503 the service dialog
  // already understands. Generate mode keeps true streaming below.
  if (isEdit) {
    type CollectResult =
      | { kind: "text"; text: string }
      | { kind: "error"; error: unknown }
      | { kind: "empty" };

    const collect = async (
      stream: AsyncIterable<string>,
    ): Promise<CollectResult> => {
      const iterator = stream[Symbol.asyncIterator]();
      let first: IteratorResult<string>;
      try {
        first = await withDeadline(
          iterator.next(),
          FIRST_CHUNK_TIMEOUT_MS,
          onTimeout,
        );
      } catch (error) {
        return { kind: "error", error };
      }
      if (first.done) return { kind: "empty" };
      let text = first.value;
      try {
        for (;;) {
          const next = await withDeadline(
            iterator.next(),
            IDLE_TIMEOUT_MS,
            onTimeout,
          );
          if (next.done) break;
          text += next.value;
        }
      } catch (error) {
        return { kind: "error", error };
      }
      return { kind: "text", text };
    };

    let collected = await collect(result.textStream);
    if (collected.kind === "error")
      return errorResponse(collected.error, model);
    if (collected.kind === "empty") return emptyCompletion();

    let validation = validatePatchText(collected.text);
    if (!validation.ok) {
      console.warn(
        `[edit] incomplete patch (${validation.reason}) — retrying once`,
      );
      const retryResult = streamText({
        model: google(model),
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.7,
        abortSignal: abort.signal,
        onFinish: ({ finishReason, usage, text }) => {
          console.log(
            `[edit-retry] finish=${finishReason} in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`,
          );
          console.log(`[edit-retry] tail=${JSON.stringify(text.slice(-300))}`);
        },
      });
      collected = await collect(retryResult.textStream);
      if (collected.kind === "error")
        return errorResponse(collected.error, model);
      if (collected.kind === "empty") return emptyCompletion();
      validation = validatePatchText(collected.text);
      if (!validation.ok) {
        console.error(
          `[edit] model=${model} failed after retry: ${validation.reason}`,
        );
        return Response.json(
          {
            error: `Service unavailable: ${model} returned an incomplete patch — switch model and retry.`,
            code: "service_unavailable",
          },
          { status: 503 },
        );
      }
    }

    console.log(`[edit] patch ok patches=${validation.patchCount}`);
    return new Response(collected.text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Wait for the first chunk before committing to a 200 stream so upstream
  // quota/rate-limit errors surface as classifiable HTTP responses.
  const iterator = result.textStream[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await withDeadline(
      iterator.next(),
      FIRST_CHUNK_TIMEOUT_MS,
      onTimeout,
    );
  } catch (error) {
    return errorResponse(error, model);
  }

  if (first.done) {
    return emptyCompletion();
  }

  const stream = new ReadableStream<string>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(first.value);
        for (;;) {
          const next = await withDeadline(
            iterator.next(),
            IDLE_TIMEOUT_MS,
            onTimeout,
          );
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
