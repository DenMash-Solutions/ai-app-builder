import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { randomUUID } from "crypto";
import {
  ACTIONS,
  COMPONENT,
  JSON_IO,
  PATCH_OP,
  PATCH_PATH,
  PATHS,
  PROJECTS,
  PUBLISH,
  ROLE,
  SLOTS,
  UI,
} from "./constants";
import { historyButton } from "./authed-helpers";
import {
  deleteTestProject,
  deleteTestRow,
  waitForRemoteProject,
  waitForRemoteScreen,
} from "./db";
import {
  createProject,
  mockGenerate,
  readHistoryStorage,
  readStoredProjects,
  shieldFromHeadSlotHides,
  waitForMsw,
} from "./helpers";

/**
 * Project publishing (plan 069, task 6): the live handle surface. The JOURNEY
 * is signed-in (publish through the project-group header's Publish-site
 * dialog); every SERVING assertion runs in an anonymous context — a visitor
 * must resolve the snapshot the publish wrote, with no local state and no
 * session. Serial + a long budget: the flow writes several remote rows and a
 * shared admin account sits behind every context (a poisoned parallel batch
 * is a real risk — dev-server-e2e-triage.md section 9). Cleanup lives in
 * `afterAll` so it still runs when a middle test fails, plus the name-scoped
 * `E2E ` sweep on the next run.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const NAME_A = `E2E publish-a-${randomUUID().slice(0, 8)}`;
const NAME_B = `E2E publish-b-${randomUUID().slice(0, 8)}`;
const HANDLE_A = `e2e-pub-${randomUUID().slice(0, 6)}`;
const HANDLE_B = `e2e-pub-${randomUUID().slice(0, 6)}`;
const HANDLE_A_NEW = `e2e-pub-${randomUUID().slice(0, 6)}`;

const HOME_A_HEADING = "Home Alpha";
const STATIC_HEADING = "About Beta";
const DYNAMIC_HEADING = "Item viewer";
const HOME_B_HEADING = "Second site";

/** Service-role ids/names so afterAll can tear the projects down (cascades
 *  route_claims + route_redirects + published_entry_points). */
let projectIdA: string | undefined;
let projectIdB: string | undefined;
const entryIds: string[] = [];

function line(op: Record<string, unknown>): string {
  return JSON.stringify(op);
}

function elementPath(key: string): string {
  return `${PATCH_PATH.elements}/${key}`;
}

function headingLines(key: string, text: string): string[] {
  return [
    line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: key }),
    line({
      op: PATCH_OP.add,
      path: elementPath(key),
      value: {
        type: COMPONENT.heading,
        props: { text, level: "h1" },
        children: [],
      },
    }),
  ];
}

/** A one-heading screen — the home of the second project. */
const HOME_B_SPEC = {
  root: "b-home",
  elements: {
    "b-home": {
      type: COMPONENT.heading,
      props: { text: HOME_B_HEADING, level: "h1" },
      children: [],
    },
  },
};

/** The static extra screen behind workspace route `about`. */
const STATIC_SPEC = {
  root: "s-root",
  elements: {
    "s-root": {
      type: COMPONENT.heading,
      props: { text: STATIC_HEADING, level: "h1" },
      children: [],
    },
  },
};

/** The dynamic screen behind `items/{id}` — reads the seeded path param. */
const DYNAMIC_SPEC = {
  root: "d-root",
  elements: {
    "d-root": {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: ["d-heading", "d-id"],
    },
    "d-heading": {
      type: COMPONENT.heading,
      props: { text: DYNAMIC_HEADING, level: "h1" },
      children: [],
    },
    "d-id": {
      type: COMPONENT.text,
      props: { text: { $state: "/id" }, className: "route-id" },
      children: [],
    },
  },
};

async function openDrawer(page: Page): Promise<Locator> {
  const drawer = page.locator(SLOTS.drawer).filter({ visible: true });
  if ((await drawer.count()) === 0) {
    await shieldFromHeadSlotHides(page);
    await historyButton(page).filter({ visible: true }).click();
  }
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  return drawer;
}

async function importViaDrawer(
  page: Page,
  spec: Record<string, unknown>,
): Promise<void> {
  const drawer = await openDrawer(page);
  await shieldFromHeadSlotHides(page);
  await drawer
    .getByRole(ROLE.button, { name: JSON_IO.import })
    .filter({ visible: true })
    .click();
  const dialog = page.locator(SLOTS.dialog).filter({ visible: true });
  await expect(dialog).toBeVisible();
  await page
    .getByRole(ROLE.textbox, { name: JSON_IO.dialogTitle })
    .filter({ visible: true })
    .fill(JSON.stringify(spec, null, 2));
  await dialog
    .getByRole(ROLE.button, { name: JSON_IO.importConfirm, exact: true })
    .filter({ visible: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

function memberRows(group: Locator, page: Page, name: string): Locator {
  return group.locator("li").filter({
    has: page.getByRole(ROLE.button, { name: PROJECTS.rowActions(name) }),
  });
}

/**
 * Sets a workspace route on the just-imported screen and confirms the chip.
 * Every import defaults its entry name to `Imported spec`, so a project with
 * TWO imported screens resolves two member rows — `previousChip` disambiguates
 * to the one that does NOT carry the route already committed on its sibling.
 */
async function setRoute(
  page: Page,
  projectName: string,
  route: string,
  previousChip?: string,
): Promise<void> {
  const drawer = await openDrawer(page);
  const group = drawer.getByLabel(projectName, { exact: true });
  await group
    .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
    .filter({ visible: true })
    .click();
  const rows = memberRows(group, page, JSON_IO.importedEntry);
  const row = previousChip
    ? rows.filter({ hasNot: page.getByText(previousChip) }).first()
    : rows.first();
  await row
    .getByRole(ROLE.button, { name: PROJECTS.routeEdit })
    .filter({ visible: true })
    .click();
  const routeInput = row.getByRole(ROLE.textbox, { name: PROJECTS.routeEdit });
  await routeInput.fill(route);
  await routeInput.press("Enter");
  await expect(row.getByText(route)).toBeVisible();
}

/**
 * Publishes `projectName` with `handle` through the real dialog and confirms
 * it went live: the success toast, the drawer's Live badge, and — the task 5
 * cache observable — the client's POST /api/revalidate naming
 * `published_entry_points`, the projection the publish just wrote (F5).
 */
async function publishSite(
  page: Page,
  projectName: string,
  handle: string,
): Promise<void> {
  const drawer = await openDrawer(page);
  const group = drawer.getByLabel(projectName, { exact: true });
  // If a previous test left the project adopted through sync, the group may
  // still be arriving — gate on it before touching controls.
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group
    .getByRole(ROLE.button, { name: PUBLISH.publishSite })
    .filter({ visible: true })
    .click();
  const dialog = page.locator(SLOTS.dialog).filter({ visible: true });
  await expect(dialog.getByText(PUBLISH.siteTitle(projectName))).toBeVisible();
  await dialog
    .getByLabel(PUBLISH.siteLabel)
    .filter({ visible: true })
    .fill(handle);
  // The availability probe runs against the live arbiter RPC — Publish
  // enables only once it answers "free". The dialog labels the submit
  // "Publish" for a first publish and "Publish new version" once the
  // site is already live — match either, anchored so a stray
  // "Take offline" never matches.
  const submit = dialog.getByRole(ROLE.button, {
    name: /^Publish(?: new version)?$/,
  });
  await expect(submit).toBeEnabled({ timeout: 20_000 });

  const revalidate = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/api/revalidate"),
    { timeout: 20_000 },
  );
  await submit.filter({ visible: true }).click();
  // Fail-closed ordering: the toast means every write committed together.
  await expect(page.getByText(PUBLISH.sitePublished("")).first()).toBeVisible({
    timeout: 20_000,
  });
  const poke = await revalidate;
  expect(
    JSON.parse(poke.postData() ?? "{}") as { tags?: string[] },
  ).toHaveProperty("tags", expect.arrayContaining(["published_entry_points"]));
  // The drawer re-labels the group LIVE.
  await expect(
    drawer.getByRole(ROLE.link, { name: PUBLISH.openSite(projectName) }),
  ).toBeVisible({ timeout: 20_000 });
  // Leave the drawer closed for whatever follows (createProject needs the
  // top bar).
  await page.keyboard.press("Escape");
  await expect(
    page.locator(SLOTS.drawer).filter({ visible: true }),
  ).toHaveCount(0);
}

test.afterAll(async () => {
  // `projects` delete cascades this project's claims, redirects and entry
  // points; targeted ids only — never a range or bare-owner match.
  await deleteTestProject(projectIdA);
  await deleteTestProject(projectIdB);
  for (const id of entryIds) await deleteTestRow(id);
});

test("a published project serves home/static/dynamic live and 404s unknown paths; a second project publishes alongside", async ({
  page,
  browser,
  baseURL,
}) => {
  const promptHome = `E2E pub-home ${randomUUID()}`;
  await mockGenerate(page, { lines: headingLines("a-root", HOME_A_HEADING) });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await createProject(page, NAME_A);
  const projects = await readStoredProjects(page);
  projectIdA = projects.find((item) => item.name === NAME_A)?.id;

  // Home (auto-seeded by 065's first-add rule).
  await page.getByPlaceholder(UI.promptPlaceholder).fill(promptHome);
  await page
    .getByRole(ROLE.button, { name: ACTIONS.generate })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole(ROLE.heading, { name: HOME_A_HEADING, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

  // Static + dynamic screens behind workspace routes `about` / `items/{id}`.
  await importViaDrawer(page, STATIC_SPEC);
  await setRoute(page, NAME_A, "about");
  await importViaDrawer(page, DYNAMIC_SPEC);
  await setRoute(page, NAME_A, "items/{id}", "about");

  const history = await readHistoryStorage(page);
  const homeEntries = history.filter(
    (entry) => entry.projectId === projectIdA && entry.id,
  );
  for (const entry of homeEntries) entryIds.push(entry.id);

  // Publish-time writes FK to the remote `projects` + `uis` rows — the sync
  // loops push them, and a failed publish only leaves an auto-dismissing
  // toast, so waiting for the parents BEFORE the dialog is also what keeps
  // this debuggable (the striped-batch race in dev-server-e2e-triage §9).
  await waitForRemoteProject(NAME_A);
  for (const entry of homeEntries) {
    await waitForRemoteScreen(entry.id);
  }

  await publishSite(page, NAME_A, HANDLE_A);

  // Anonymous visitor — no storage state, no session — resolves the LIVE
  // surface (decisions 8/17/18).
  const visitor = await browser.newContext({ baseURL });
  const visitorPage = await visitor.newPage();
  try {
    // The bare handle redirects by the locale sugar, then the home rung.
    await visitorPage.goto(`/${HANDLE_A}`);
    await expect(visitorPage).toHaveURL(new RegExp(`/${HANDLE_A}$`));
    await expect(
      visitorPage.getByRole(ROLE.heading, { name: HOME_A_HEADING }),
    ).toBeVisible();

    // Static route — the baked-CSS branch (task 5) with the literal match.
    await visitorPage.goto(`/en/${HANDLE_A}/about`);
    await expect(
      visitorPage.getByRole(ROLE.heading, { name: STATIC_HEADING }),
    ).toBeVisible();

    // Dynamic route — client-rendered with the seeded param (decision 3).
    await visitorPage.goto(`/en/${HANDLE_A}/items/42`);
    await expect(
      visitorPage.getByRole(ROLE.heading, { name: DYNAMIC_HEADING }),
    ).toBeVisible();
    await expect(
      visitorPage.locator(".route-id").filter({ visible: true }),
    ).toHaveText("42");

    // Decision 19: an unmatched path under the handle carries a REAL 404.
    const miss = await visitorPage.goto(`/en/${HANDLE_A}/no-such-path`);
    expect(miss?.status()).toBe(404);
  } finally {
    await visitor.close();
  }

  // A second project publishes alongside — the claims namespace stays
  // exclusive per handle and neither site disturbs the other's routes.
  await createProject(page, NAME_B);
  const projectsAfter = await readStoredProjects(page);
  projectIdB = projectsAfter.find((item) => item.name === NAME_B)?.id;
  await importViaDrawer(page, HOME_B_SPEC);
  const historyB = await readHistoryStorage(page);
  const importedB = historyB.find((entry) => entry.projectId === projectIdB);
  if (importedB?.id) {
    entryIds.push(importedB.id);
    await waitForRemoteScreen(importedB.id);
  }
  await waitForRemoteProject(NAME_B);
  await publishSite(page, NAME_B, HANDLE_B);

  const visitor2 = await browser.newContext({ baseURL });
  const visitor2Page = await visitor2.newPage();
  try {
    await visitor2Page.goto(`/${HANDLE_B}`);
    await expect(visitor2Page).toHaveURL(new RegExp(`/${HANDLE_B}$`));
    await expect(
      visitor2Page.getByRole(ROLE.heading, { name: HOME_B_HEADING }),
    ).toBeVisible();
    // Project A still serves its whole surface.
    await visitor2Page.goto(`/en/${HANDLE_A}/about`);
    await expect(
      visitor2Page.getByRole(ROLE.heading, { name: STATIC_HEADING }),
    ).toBeVisible();
  } finally {
    await visitor2.close();
  }
});

test("a handle change redirects the old URL", async ({
  page,
  browser,
  baseURL,
}) => {
  // Prospect contexts are fresh per test: the MSW init scripts added by
  // the previous test live in ITS context, so this suite's dialog flow
  // must (re)install them before the first goto.
  await mockGenerate(page, {});
  // Project A is still published from the previous (serial) test.
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await publishSite(page, NAME_A, HANDLE_A_NEW);

  const visitor = await browser.newContext({ baseURL });
  const visitorPage = await visitor.newPage();
  try {
    // One hop, unintercepted: the old value answers with the redirect itself.
    const old = await visitorPage.request.get(`/en/${HANDLE_A}/about`, {
      maxRedirects: 0,
    });
    expect([307, 308]).toContain(old.status());
    expect(old.headers()["location"]).toContain(HANDLE_A_NEW);
    // Following it lands on the live site at the new handle.
    await visitorPage.goto(`/en/${HANDLE_A}/about`);
    await expect(visitorPage).toHaveURL(new RegExp(`${HANDLE_A_NEW}/about$`));
    await expect(
      visitorPage.getByRole(ROLE.heading, { name: STATIC_HEADING }),
    ).toBeVisible();
  } finally {
    await visitor.close();
  }
});
