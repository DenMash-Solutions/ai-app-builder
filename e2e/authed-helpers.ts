import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  ACTIONS,
  NUDGE,
  PATHS,
  ROLE,
  SLOTS,
  UI,
  entryRowName,
} from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";

/**
 * Shared flows for the authenticated suites. Rule of engagement: every
 * record is created with a unique `E2E `-prefixed prompt and located BY
 * TEXT (never list position or counts — sync pulls whatever the account
 * owns), so parallel tests can't collide.
 */

/** The history button appends a count when non-empty — address it by prefix. */
export function historyButton(page: Page): Locator {
  return page.getByRole(ROLE.button, { name: /^History/ });
}

export async function openHistory(page: Page): Promise<void> {
  await historyButton(page).click();
}

/** Drawer row for one specific prompt. */
export function historyRow(page: Page, prompt: string): Locator {
  return page
    .locator(SLOTS.drawer)
    .locator("li")
    .filter({
      has: page.getByRole(ROLE.button, { name: entryRowName(prompt) }),
    });
}

/**
 * The first-login upload nudge pins the bottom-left corner — the same zone
 * as the account menu — so dismiss it through its own "Not now" action
 * (which marks it seen for the rest of the session).
 */
export async function dismissUploadNudge(page: Page): Promise<void> {
  const later = page.getByRole(ROLE.button, { name: NUDGE.later });
  try {
    await later.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return; // auth still settling, or already dismissed — nothing to do
  }
  await later.click();
}

/** Generates a uniquely-marked UI through the real (MSW-mocked) flow. */
export async function generateUnique(
  page: Page,
  prompt: string,
  lines?: string[],
): Promise<string> {
  await mockGenerate(page, lines ? { lines } : {});
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByPlaceholder(UI.promptPlaceholder).fill(prompt);
  await page.getByRole(ROLE.button, { name: ACTIONS.generate }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await dismissUploadNudge(page);
  const entry = (await readHistoryStorage(page)).find(
    (stored) => stored.prompt === prompt,
  );
  if (!entry) {
    throw new Error(`generated entry not found in local history: ${prompt}`);
  }
  return entry.id;
}
