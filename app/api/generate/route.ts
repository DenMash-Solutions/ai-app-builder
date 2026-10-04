import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { playgroundCatalog } from "@/lib/catalog";

export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-3.8-flash";

const COMPLETENESS_RULES = `
Additional rules:
- Emit the COMPLETE spec: every section you start must be fully written with all of its child elements before you finish.
- Never stop at a section header or an opening container — if you begin a section, finish it.
- Prefer fewer components fully written over many components left half-finished.
- End the stream only after the last section is complete.`;

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

  const { prompt, currentSpec } = await req.json();

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return Response.json(
      { error: "A non-empty 'prompt' string is required" },
      { status: 400 },
    );
  }

  const systemPrompt = playgroundCatalog.prompt() + COMPLETENESS_RULES;

  // Optionally include current UI state so the model can edit the existing UI
  const contextPrompt =
    currentSpec && currentSpec.root
      ? `\n\nCurrent UI state:\n${JSON.stringify(currentSpec, null, 2)}`
      : "";

  const result = streamText({
    model: google(process.env.GEMINI_MODEL ?? DEFAULT_MODEL),
    system: systemPrompt + contextPrompt,
    prompt,
    temperature: 0.7,
    onFinish: ({ finishReason, usage, text }) => {
      console.log(
        `[generate] finish=${finishReason} in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`,
      );
      console.log(`[generate] tail=${JSON.stringify(text.slice(-300))}`);
    },
  });

  return result.toTextStreamResponse();
}
