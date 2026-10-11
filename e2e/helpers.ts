import path from "node:path";
import type { Page } from "@playwright/test";
import { STORAGE_KEY } from "@/lib/history";
import type { GenerateMockConfig } from "@/e2e/msw/fixture";

export type { GenerateMockConfig };

const MSW_INIT_BUNDLE = path.resolve(
  process.cwd(),
  "e2e/msw/init.generated.js",
);

/**
 * Injects the bundled MSW worker so `POST /api/generate` is mocked
 * entirely in the browser (no Gemini calls during tests).
 *
 * Must be called before `page.goto()`.
 */
export async function mockGenerate(
  page: Page,
  config: GenerateMockConfig = {},
): Promise<void> {
  await page.addInitScript({ path: MSW_INIT_BUNDLE });
  await page.addInitScript((cfg: GenerateMockConfig) => {
    (
      window as unknown as { __GENERATE_MOCK__?: GenerateMockConfig }
    ).__GENERATE_MOCK__ = cfg;
  }, config);
}

/** Waits until the MSW worker has registered and started. */
export async function waitForMsw(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __MSW_READY__?: boolean }).__MSW_READY__ === true,
  );
}

/** Number of `/api/generate` requests intercepted so far. */
export function generateCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __GENERATE_CALLS__?: number })
        .__GENERATE_CALLS__ ?? 0,
  );
}

/** Prompt of the most recent intercepted `/api/generate` request. */
export function lastGeneratePrompt(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as unknown as { __LAST_GENERATE_PROMPT__?: string })
        .__LAST_GENERATE_PROMPT__ ?? "",
  );
}

export interface StoredElement {
  children?: string[];
  props?: Record<string, unknown>;
}

export interface StoredSpec {
  root: string;
  elements: Record<string, StoredElement | undefined>;
  state?: Record<string, unknown>;
}

export interface StoredEntry {
  id: string;
  name: string;
  slug: string;
  prompt: string;
  createdAt: number;
  spec: StoredSpec;
  revisions?: { label: string; createdAt: number; spec: StoredSpec }[];
  head?: number;
}

export async function readHistoryStorage(page: Page): Promise<StoredEntry[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredEntry[]) : [];
  }, STORAGE_KEY);
}

/**
 * Dispatches a vertical swipe (touchstart + touchend) on the first element
 * matching `selector` — the editor sheet's swipe-to-dismiss/expand gestures.
 */
export async function swipeVertical(
  page: Page,
  selector: string,
  fromY: number,
  toY: number,
): Promise<void> {
  await page.evaluate(
    ({ selector, fromY, toY }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`swipe target not found: ${selector}`);
      const touch = (clientY: number): Touch =>
        new Touch({ identifier: 1, target: el, clientX: 80, clientY });
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [touch(fromY)],
          changedTouches: [touch(fromY)],
          bubbles: true,
          cancelable: true,
        }),
      );
      el.dispatchEvent(
        new TouchEvent("touchend", {
          touches: [],
          changedTouches: [touch(toY)],
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { selector, fromY, toY },
  );
}
