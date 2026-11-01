import path from "node:path";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { STORAGE_KEY } from "@/lib/history";
import { PROJECT_STORAGE_KEY } from "@/lib/projects/projects";
import { PROJECTS, ROLE } from "./constants";
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
  /** Visibility condition — plan 058's condition-editor assertions. */
  visible?: unknown;
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
  /** Project grouping (061 A1) — absent for legacy/unprojected entries. */
  projectId?: string;
}

export async function readHistoryStorage(page: Page): Promise<StoredEntry[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredEntry[]) : [];
  }, STORAGE_KEY);
}

/** A project as stored locally (plans 061 A1 / 064). */
export interface StoredProject {
  id: string;
  name: string;
  state: Record<string, unknown>;
}

export async function readStoredProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredProject[]) : [];
  }, PROJECT_STORAGE_KEY);
}

/**
 * Creates a project through the top-bar switcher's inline input and waits
 * for the pill to name it — the creation seam both project suites exercise
 * (anonymous 061-4 and authenticated 064).
 */
export async function createProject(page: Page, name: string): Promise<void> {
  await page
    .getByRole(ROLE.button, { name: PROJECTS.switcher })
    .filter({ visible: true })
    .click();
  await page
    .getByRole(ROLE.button, { name: PROJECTS.create })
    .filter({ visible: true })
    .click();
  await page
    .getByLabel(PROJECTS.namePlaceholder)
    .filter({ visible: true })
    .fill(name);
  await page.keyboard.press("Enter");
  // The pill now names the project new screens are created into.
  await expect(
    page
      .getByRole(ROLE.button, { name: PROJECTS.switcher })
      .filter({ visible: true })
      .getByText(name),
  ).toBeVisible();
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
