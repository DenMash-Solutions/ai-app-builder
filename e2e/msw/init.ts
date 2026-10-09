import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import {
  MOCK_EDIT_LINES,
  MOCK_UI_LINES,
  type GenerateMockConfig,
} from "./fixture";

interface MockWindow {
  __GENERATE_MOCK__?: GenerateMockConfig;
  __GENERATE_CALLS__?: number;
  /** Prompt of the most recent intercepted /api/generate request. */
  __LAST_GENERATE_PROMPT__?: string;
  __MSW_READY__?: boolean;
}

const mockWindow = window as unknown as MockWindow;

const worker = setupWorker(
  http.post("*/api/generate", async ({ request }) => {
    mockWindow.__GENERATE_CALLS__ = (mockWindow.__GENERATE_CALLS__ ?? 0) + 1;
    const config = mockWindow.__GENERATE_MOCK__ ?? {};

    const body = (await request.json().catch(() => ({}))) as {
      currentSpec?: { root?: string } | null;
      prompt?: string;
    };
    mockWindow.__LAST_GENERATE_PROMPT__ =
      typeof body.prompt === "string" ? body.prompt : "";

    if (config.delayMs && config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }

    if (config.status && config.status >= 400) {
      return HttpResponse.json(config.body ?? { error: "Mock failure" }, {
        status: config.status,
      });
    }

    const isEdit =
      typeof body.currentSpec?.root === "string" &&
      body.currentSpec.root.length > 0;
    const lines = isEdit
      ? (config.editLines ?? MOCK_EDIT_LINES)
      : (config.lines ?? MOCK_UI_LINES);
    return new HttpResponse(`${lines.join("\n")}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }),
);

void worker
  .start({ onUnhandledFrame: "bypass" })
  .then(() => {
    mockWindow.__MSW_READY__ = true;
  })
  .catch((error: unknown) => {
    console.error("[msw] failed to start", error);
  });
