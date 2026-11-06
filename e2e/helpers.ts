import path from "node:path";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { STORAGE_KEY } from "@/lib/history";
import { PROJECT_STORAGE_KEY } from "@/lib/projects/projects";
import { PATCH_OP, PATCH_PATH, PROJECTS, ROLE } from "./constants";
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

/** Top-level spec blocks besides `root`/`elements` — each rides its own
 *  `add` patch, the shape the model's JSONL stream uses (plan 070 task 2). */
const SPEC_TOP_LEVEL_BLOCKS = {
  route: "/route",
  state: PATCH_PATH.state,
  dataSources: PATCH_PATH.dataSources,
  resources: PATCH_PATH.resources,
  queries: PATCH_PATH.queries,
  i18n: "/i18n",
  urlSync: PATCH_PATH.urlSync,
} as const;

/**
 * Serializes a whole committed spec into the patch-line stream `/api/generate`
 * streams — the MSW mock returns these lines for a real Generate, so a demo
 * screen is AUTHORED through the app (plan 070 decision 4) instead of being
 * imported. Same `{op, path, value}` shape as `headingLines`.
 */
export function specToLines(spec: {
  root: string;
  elements: Record<string, unknown>;
  [key: string]: unknown;
}): string[] {
  const lines: string[] = [
    JSON.stringify({
      op: PATCH_OP.add,
      path: PATCH_PATH.root,
      value: spec.root,
    }),
  ];
  for (const [key, element] of Object.entries(spec.elements)) {
    lines.push(
      JSON.stringify({
        op: PATCH_OP.add,
        path: `${PATCH_PATH.elements}/${key}`,
        value: element,
      }),
    );
  }
  for (const [key, path] of Object.entries(SPEC_TOP_LEVEL_BLOCKS)) {
    if (spec[key] === undefined) continue;
    lines.push(JSON.stringify({ op: PATCH_OP.add, path, value: spec[key] }));
  }
  return lines;
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

/** A project as stored locally (plans 061 A1 / 064) — the full `Project`
 *  row (065: the preview client resolves the bare namespace by `slug`). */
export interface StoredProject {
  id: string;
  name: string;
  slug: string;
  state: Record<string, unknown>;
}

export async function readStoredProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredProject[]) : [];
  }, PROJECT_STORAGE_KEY);
}

/**
 * Next serves streaming metadata behind a `<div hidden>` in the App Router's
 * head slot (`MetadataWrapper`); when that wrapper mounts — it does so in
 * waves once the page has navigated/streamed — React's hide cascade
 * (`hideInstance` via `hideOrUnhideNearestPortals`) copies
 * `display: none !important` onto the open Radix popover's popper wrapper.
 * The popover then reads `data-state="open"` but measures 0×0, and Playwright
 * waits for visibility forever (plan 065 Task 5). Strip styles an earlier
 * wave applied and neutralise later writes for the rest of the page session.
 * The canvas root is deliberately NOT shielded: React's Suspense boundaries
 * hide stale content there on purpose, and un-hiding it duplicates controls.
 */
export async function shieldFromHeadSlotHides(page: Page): Promise<void> {
  await page.evaluate(() => {
    const SHIELDED =
      "[data-radix-popper-content-wrapper], [data-radix-popper-content-wrapper] *, [data-slot='drawer-content'], [data-slot='drawer-content'] *, [data-slot='dialog-content'], [data-slot='dialog-content'] *";
    const strip = (): void => {
      for (const el of document.querySelectorAll<HTMLElement>(SHIELDED)) {
        // Only strip if the element should be visible (has data-state="open")
        // - this distinguishes React's malicious hide from Radix's legitimate close
        if (
          el.style.display === "none" &&
          (el.getAttribute("data-state") === "open" ||
            el.closest("[data-state='open']"))
        ) {
          el.style.removeProperty("display");
        }
      }
    };
    const w = window as unknown as { __HIDE_SHIELD__?: boolean };
    if (!w.__HIDE_SHIELD__) {
      w.__HIDE_SHIELD__ = true;
      // React only reaches the element through the style getter, so tag it
      // there (the descriptor lives on HTMLElement.prototype, not Element).
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "style",
      );
      if (descriptor?.get) {
        const get = descriptor.get;
        Object.defineProperty(HTMLElement.prototype, "style", {
          ...descriptor,
          get(this: HTMLElement) {
            const style = get.call(this) as CSSStyleDeclaration & {
              __el?: Element;
            };
            style.__el = this;
            return style;
          },
        });
      }
      const proto = CSSStyleDeclaration.prototype;
      const setProperty = proto.setProperty;
      proto.setProperty = function (
        this: CSSStyleDeclaration & { __el?: Element },
        property: string,
        value: string,
        priority?: string,
      ): void {
        // Only block `display: none !important` from React's hideInstance
        // when the element should be visible (has data-state="open")
        if (
          property === "display" &&
          value === "none" &&
          priority === "important" &&
          this.__el?.matches(SHIELDED) &&
          (this.__el.getAttribute("data-state") === "open" ||
            this.__el.closest("[data-state='open']"))
        ) {
          return;
        }
        setProperty.call(this, property, value, priority);
      };
    }
    strip();
  });
}

/**
 * Creates a project through the top-bar switcher's inline input and waits
 * for the pill to name it — the creation seam both project suites exercise
 * (anonymous 061-4 and authenticated 064).
 */
export async function createProject(page: Page, name: string): Promise<void> {
  await shieldFromHeadSlotHides(page);
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
