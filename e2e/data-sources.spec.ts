import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PATHS, PROMPTS, ROLE, TODO } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";
import { TODO_UI_LINES } from "./msw/fixture";

/**
 * Data sources (docs/plan/data-sources, M1): a generated design declares a
 * localStorage-backed resource and every read/write flows through the
 * query mirror (`/queries/todoList`) and `data_mutate`. Journeys drive the
 * UI only; environment instrumentation is limited to corrupting/simulating
 * storage contents (never driving the journey itself).
 *
 * Loading-branch note: the loading mirror lasts microseconds with a
 * synchronous store — it cannot paint (localStorage reads never yield the
 * main thread), so the loading branch is covered by the unit integration
 * test (components/data-sources/query-bindings.test.tsx) instead.
 */

/** Row container for one todo (fixture marks items with this class). */
const row = (page: Page, title: string) =>
  page.locator(".todo-item").filter({ hasText: title });

const count = (page: Page) => page.locator(`.${TODO.countClass}`);

async function generateTodos(page: Page): Promise<void> {
  await mockGenerate(page, { lines: TODO_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole(ROLE.heading, { name: TODO.heading }),
  ).toBeVisible();
}

async function addTodo(page: Page, title: string): Promise<void> {
  await page.getByPlaceholder(TODO.addPlaceholder).fill(title);
  await page.getByRole(ROLE.button, { name: TODO.addLabel }).click();
  await expect(page.getByText(title)).toBeVisible();
}

test.describe("data sources — persistent todo (localStorage)", () => {
  test("adds, completes and deletes todos; everything survives a reload", async ({
    page,
  }) => {
    await generateTodos(page);
    // Fresh visitor: the store is empty — the empty branch, not an error.
    await expect(page.getByText(TODO.empty)).toBeVisible();
    await expect(count(page)).toHaveText("0");

    // Create through data_mutate (input state → record → silent clear).
    await addTodo(page, TODO.first);
    await expect(page.getByText(TODO.empty)).toHaveCount(0);
    await expect(count(page)).toHaveText("1");

    // A second record — the repeat renders both, count follows (T12: two
    // components on one query must update together).
    await addTodo(page, TODO.second);
    await expect(count(page)).toHaveText("2");

    // Persistence: the design's own URL reloaded keeps both records.
    await page.reload();
    await expect(
      page.getByRole(ROLE.heading, { name: TODO.heading }),
    ).toBeVisible();
    await expect(page.getByText(TODO.first)).toBeVisible();
    await expect(page.getByText(TODO.second)).toBeVisible();
    await expect(count(page)).toHaveText("2");

    // Complete: the update refreshes the row — mark shown, button gone.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.doneLabel })
      .click();
    await expect(row(page, TODO.first).getByText(TODO.doneMark)).toBeVisible();
    await expect(
      row(page, TODO.first).getByRole(ROLE.button, { name: TODO.doneLabel }),
    ).toHaveCount(0);
    await expect(row(page, TODO.second).getByText(TODO.doneMark)).toHaveCount(
      0,
    );

    // Delete both — back to the empty branch, and it sticks.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.deleteLabel })
      .click();
    await expect(page.getByText(TODO.first)).toHaveCount(0);
    await expect(count(page)).toHaveText("1");
    await row(page, TODO.second)
      .getByRole(ROLE.button, { name: TODO.deleteLabel })
      .click();
    await expect(page.getByText(TODO.empty)).toBeVisible();
    await expect(count(page)).toHaveText("0");

    await page.reload();
    await expect(page.getByText(TODO.empty)).toBeVisible();
    await expect(count(page)).toHaveText("0");
  });

  test("corrupted stored data surfaces the error branch, not a broken page", async ({
    page,
  }) => {
    await generateTodos(page);
    await addTodo(page, TODO.first);

    // Environment seeding: corrupt this design's collection bytes (the
    // journey up to here — and the error rendering — is pure UI).
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(
        (candidate) =>
          candidate.startsWith("genui-data:") && candidate.endsWith(":todos"),
      );
      if (!key) throw new Error("todo collection key not found");
      localStorage.setItem(key, "{oops");
    });

    await page.reload();
    await expect(
      page.getByRole(ROLE.heading, { name: TODO.heading }),
    ).toBeVisible();
    await expect(page.getByText(TODO.error)).toBeVisible();
    await expect(page.getByText(TODO.empty)).toHaveCount(0);
  });

  test("another tab's write refreshes the mirror without touching the UI", async ({
    page,
  }) => {
    await generateTodos(page);
    await addTodo(page, TODO.first);

    // Environment instrumentation: write the collection as another tab
    // would, then fire the storage event this tab's manager listens for.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(
        (candidate) =>
          candidate.startsWith("genui-data:") && candidate.endsWith(":todos"),
      );
      if (!key) throw new Error("todo collection key not found");
      const records = JSON.parse(localStorage.getItem(key) ?? "[]");
      records.push({
        id: "from-other-tab",
        title: "Other tab todo",
        done: false,
      });
      localStorage.setItem(key, JSON.stringify(records));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });

    // Silent refresh: the new record appears with no interaction.
    await expect(page.getByText("Other tab todo")).toBeVisible();
    await expect(count(page)).toHaveText("2");
  });
});
