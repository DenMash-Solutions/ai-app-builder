import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ACTIONS,
  PREVIEW,
  PROMPTS,
  RENAME,
  ROLE,
  UI,
  entryRowName,
} from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";

const UI_ROUTE_URL =
  /\/ui\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function generate(page: Page, prompt: string): Promise<void> {
  await page.getByRole(ROLE.button, { name: prompt }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
}

test.describe("ui routes", () => {
  test("generation redirects to /ui/[id] and the deep link survives a reload", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await generate(page, PROMPTS.signIn);

    await expect(page).toHaveURL(UI_ROUTE_URL);
    const [entry] = await readHistoryStorage(page);
    expect(entry).toBeDefined();
    await expect(page).toHaveURL(new RegExp(`/ui/${entry!.id}$`));

    // The URL owns the active entry: a reload restores it without the drawer
    await page.reload();
    await waitForMsw(page);
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });

  test("history selection navigates to the selected entry's /ui/[id]", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    // Two entries: signIn first (older), revenueDashboard second (newest/active)
    await generate(page, PROMPTS.signIn);
    await expect(page).toHaveURL(UI_ROUTE_URL);
    await page.getByRole(ROLE.button, { name: ACTIONS.clear }).click();
    await expect(page.getByText(UI.emptyState)).toBeVisible();
    await generate(page, PROMPTS.revenueDashboard);

    const stored = await readHistoryStorage(page);
    expect(stored).toHaveLength(2);
    const [newest, older] = stored;
    await expect(page).toHaveURL(new RegExp(`/ui/${newest!.id}$`));

    // Selecting the older entry from the drawer switches the URL to it
    await page.getByRole(ROLE.button, { name: /History/ }).click();
    await page
      .getByRole(ROLE.button, { name: entryRowName(PROMPTS.signIn) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/ui/${older!.id}$`));
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });

  test("a deep link to an unknown id shows the not-found panel with a way back", async ({
    page,
  }) => {
    await page.goto("/ui/00000000-0000-4000-8000-000000000000");
    await expect(
      page.getByRole(ROLE.heading, { name: UI.uiRouteNotFoundTitle }),
    ).toBeVisible();

    await page.getByRole(ROLE.link, { name: UI.uiRouteNotFoundBack }).click();
    await expect(page).toHaveURL(/\/(en|es)?$/);
    await expect(page.getByText(UI.emptyState)).toBeVisible();
  });
});

test.describe("ui rename & preview", () => {
  test("rename seeds the slug from the name; preview renders at /{slug} with a pill into the playground", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);
    await expect(page).toHaveURL(UI_ROUTE_URL);

    // Rename via the top-bar title popover: the slug follows the name until
    // edited by hand.
    await page.getByRole(ROLE.button, { name: RENAME.open }).click();
    // Exact labels: "Rename UI" (trigger/dialog aria-label) contains "name".
    const nameInput = page.getByLabel(RENAME.name, { exact: true });
    const slugInput = page.getByLabel(RENAME.slug, { exact: true });
    await nameInput.fill("Clinical Dental Sonrisas");
    await expect(slugInput).toHaveValue("clinical-dental-sonrisas");
    await slugInput.fill("dental-sonrisas");
    await page.getByRole(ROLE.button, { name: RENAME.save }).click();

    const [entry] = await readHistoryStorage(page);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("Clinical Dental Sonrisas");
    expect(entry!.slug).toBe("dental-sonrisas");

    // Preview at /{slug}: the rendered UI with no playground chrome…
    await page.goto("/dental-sonrisas");
    await waitForMsw(page);
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toHaveCount(0);

    // …and the floating pill opens the playground by slug.
    await page.getByRole(ROLE.link, { name: PREVIEW.openPlayground }).click();
    await expect(page).toHaveURL(/\/ui\/dental-sonrisas$/);
    // A spec is loaded, so the submit button reads "Steer", not "Generate".
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeVisible();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });

  test("the old slug shows the not-found panel after a rename", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);
    await expect(page).toHaveURL(UI_ROUTE_URL);

    const [entry] = await readHistoryStorage(page);
    const originalSlug = entry!.slug;
    expect(originalSlug).toBeTruthy();

    await page.getByRole(ROLE.button, { name: RENAME.open }).click();
    await page.getByLabel(RENAME.slug, { exact: true }).fill("brand-new-slug");
    await page.getByRole(ROLE.button, { name: RENAME.save }).click();

    await page.goto(`/${originalSlug}`);
    await expect(
      page.getByRole(ROLE.heading, { name: UI.uiRouteNotFoundTitle }),
    ).toBeVisible();
  });

  test("a slug already used by another UI blocks the save", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    // Two entries; try to give the second the first's slug.
    await generate(page, PROMPTS.signIn);
    await expect(page).toHaveURL(UI_ROUTE_URL);
    await page.getByRole(ROLE.button, { name: ACTIONS.clear }).click();
    await generate(page, PROMPTS.revenueDashboard);
    await expect(page).toHaveURL(UI_ROUTE_URL);

    const [newest, older] = await readHistoryStorage(page);
    await page.getByRole(ROLE.button, { name: RENAME.open }).click();
    const slugInput = page.getByLabel(RENAME.slug, { exact: true });
    await expect(slugInput).toHaveValue(newest!.slug);
    await slugInput.fill(older!.slug);
    await expect(page.getByText(RENAME.slugTaken)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: RENAME.save }),
    ).toBeDisabled();

    // The stored slug is untouched.
    const [after] = await readHistoryStorage(page);
    expect(after!.slug).toBe(newest!.slug);
  });
});
