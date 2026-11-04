import { expect, test } from "@playwright/test";
import {
  ACTIONS,
  COMPONENT,
  JSON_IO,
  PATCH_OP,
  PATCH_PATH,
  PATHS,
  PROJECTS,
  ROLE,
  SLOTS,
  UI,
  entryRowName,
  historyButtonName,
} from "./constants";
import {
  createProject,
  mockGenerate,
  readStoredProjects,
  waitForMsw,
} from "./helpers";

/**
 * Project data (plan 067): a project's screens share one data namespace
 * (`genui-data:{projectId}:`), two projects never see each other's records,
 * and deleting a project purges only its own rows while its screens survive
 * (decision 4).
 */

const PROJECT_A = "Data App A";
const PROJECT_B = "Data App B";
const PROMPT_A = "Data screen A";
const NOTE_A = "note-a";
const NOTE_B = "note-b";

const line = (op: Record<string, unknown>): string => JSON.stringify(op);
const elementPath = (key: string): string => `${PATCH_PATH.elements}/${key}`;
const press = (action: Record<string, unknown>) => ({ press: [action] });

/** Same declarations on both screens: declarations stay per spec (067
 *  decision 1), only the namespace is shared. */
const notesBlocks = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.dataSources,
    value: { localNotes: { provider: "localStorage", config: {} } },
  }),
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.resources,
    value: {
      notes: { dataSource: "localNotes", schema: { title: "string" } },
    },
  }),
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.queries,
    value: { noteList: { resource: "notes", operation: "list" } },
  }),
];

/** Screen A, generated into the active project. */
const SCREEN_A_LINES: string[] = [
  ...notesBlocks,
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "a-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: ["a-heading", "a-count", "a-list", "a-add"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-heading"),
    value: {
      type: COMPONENT.heading,
      props: { text: "Data screen A", level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-count"),
    value: {
      type: COMPONENT.text,
      props: {
        text: { $state: "/queries/noteList/count" },
        className: "note-count",
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-list"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm" },
      repeat: { statePath: "/queries/noteList/data", key: "id" },
      children: ["a-item"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-item"),
    value: {
      type: COMPONENT.text,
      props: { text: { $item: "title" }, className: "note-item" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-add"),
    value: {
      type: COMPONENT.button,
      props: { label: "Add note" },
      on: press({
        action: "data_mutate",
        params: {
          op: "create",
          resource: "notes",
          input: { title: NOTE_A },
        },
      }),
      children: [],
    },
  }),
];

/** Screen B, imported as JSON into the second project. Same blocks, its own
 *  heading and its own note — that is what makes the isolation assertion
 *  meaningful. */
const SCREEN_B_SPEC = {
  root: "b-root",
  dataSources: { localNotes: { provider: "localStorage", config: {} } },
  resources: {
    notes: { dataSource: "localNotes", schema: { title: "string" } },
  },
  queries: { noteList: { resource: "notes", operation: "list" } },
  elements: {
    "b-root": {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: ["b-heading", "b-count", "b-list", "b-add"],
    },
    "b-heading": {
      type: COMPONENT.heading,
      props: { text: "Data screen B", level: "h1" },
      children: [],
    },
    "b-count": {
      type: COMPONENT.text,
      props: {
        text: { $state: "/queries/noteList/count" },
        className: "note-count",
      },
      children: [],
    },
    "b-list": {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm" },
      repeat: { statePath: "/queries/noteList/data", key: "id" },
      children: ["b-item"],
    },
    "b-item": {
      type: COMPONENT.text,
      props: { text: { $item: "title" }, className: "note-item" },
      children: [],
    },
    "b-add": {
      type: COMPONENT.button,
      props: { label: "Add note" },
      on: press({
        action: "data_mutate",
        params: {
          op: "create",
          resource: "notes",
          input: { title: NOTE_B },
        },
      }),
      children: [],
    },
  },
};

const dataPrefix = (projectId: string): string => `genui-data:${projectId}:`;

/** Keys this browser holds for one project's namespace. */
const storedDataKeys = (
  page: Parameters<typeof readStoredProjects>[0],
  projectId: string,
): Promise<string[]> =>
  page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    dataPrefix(projectId),
  );

test.describe("project data lifecycle (067)", () => {
  test("records stay inside their project and deleting a project purges them, keeping its screens", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mockGenerate(page, { lines: SCREEN_A_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    // --- Project A + its screen writes a record ---
    await createProject(page, PROJECT_A);
    const projectsA = await readStoredProjects(page);
    const projectA = projectsA.find((entry) => entry.name === PROJECT_A);
    expect(projectA).toBeDefined();

    await page.getByPlaceholder(UI.promptPlaceholder).fill(PROMPT_A);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.generate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Data screen A", exact: true }),
    ).toBeVisible();

    // Readiness gate: the query mirror only exists once `QueryLoader` has
    // attached and registered `data_mutate` — the heading paints before that
    // effect runs, and a click in between is dropped (no handler yet).
    const noteCount = page.locator(".note-count").filter({ visible: true });
    await expect(noteCount).toHaveText("0");

    await page
      .getByRole(ROLE.button, { name: "Add note" })
      .filter({ visible: true })
      .click();
    await expect(noteCount).toHaveText("1");
    await expect
      .poll(async () => storedDataKeys(page, projectA?.id ?? ""))
      .not.toHaveLength(0);

    // --- Project B gets the same screen, imported, and its own record ---
    await createProject(page, PROJECT_B);
    const projectB = (await readStoredProjects(page)).find(
      (entry) => entry.name === PROJECT_B,
    );
    expect(projectB).toBeDefined();
    expect(projectB?.id).not.toBe(projectA?.id);

    await page
      .getByRole(ROLE.button, { name: historyButtonName(1) })
      .filter({ visible: true })
      .click();
    const drawer = page.locator(SLOTS.drawer).filter({ visible: true });
    await expect(drawer).toBeVisible();
    await drawer
      .getByRole(ROLE.button, { name: JSON_IO.import })
      .filter({ visible: true })
      .click();
    const dialog = page.locator(SLOTS.dialog).filter({ visible: true });
    await expect(dialog).toBeVisible();
    await page
      .getByRole(ROLE.textbox, { name: JSON_IO.dialogTitle })
      .filter({ visible: true })
      .fill(JSON.stringify(SCREEN_B_SPEC, null, 2));
    await dialog
      .getByRole(ROLE.button, { name: JSON_IO.importConfirm, exact: true })
      .filter({ visible: true })
      .click();
    await expect(dialog).toHaveCount(0);

    // The import closes the drawer; reopen it to reach the grouped screens.
    await page
      .getByRole(ROLE.button, { name: historyButtonName(2) })
      .filter({ visible: true })
      .click();
    await expect(drawer).toBeVisible();
    const groupB = drawer.getByLabel(PROJECT_B, { exact: true });
    await expect(groupB).toBeVisible();
    await groupB
      .getByRole(ROLE.button, { name: entryRowName(JSON_IO.importedEntry) })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Data screen B", exact: true }),
    ).toBeVisible();

    // Isolation (067 decision 3): A's record is NOT readable here, even
    // though both screens declare the same resource name.
    await expect(page.getByText(NOTE_A).filter({ visible: true })).toHaveCount(
      0,
    );
    const noteCountB = page.locator(".note-count").filter({ visible: true });
    await expect(noteCountB).toHaveText("0");

    await page
      .getByRole(ROLE.button, { name: "Add note" })
      .filter({ visible: true })
      .click();
    await expect(noteCountB).toHaveText("1");
    await expect(
      page.getByText(NOTE_B).filter({ visible: true }),
    ).toBeVisible();
    await expect
      .poll(async () => storedDataKeys(page, projectB?.id ?? ""))
      .not.toHaveLength(0);
    // A's rows are untouched by B's writes.
    const keysA = await storedDataKeys(page, projectA?.id ?? "");
    expect(keysA.length).toBeGreaterThan(0);

    // --- Delete project B: its rows go (local + remote scope), its screen stays ---
    const purgeRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        request.url().includes("/rest/v1/genui_records")
      ) {
        purgeRequests.push(request.url());
      }
    });

    await page
      .getByRole(ROLE.button, { name: historyButtonName(2) })
      .filter({ visible: true })
      .click();
    await expect(drawer).toBeVisible();
    await drawer
      .getByLabel(PROJECT_B, { exact: true })
      .getByRole(ROLE.button, { name: PROJECTS.delete })
      .click();

    // Local rows: the project's whole namespace is gone, A's survives.
    await expect.poll(async () => storedDataKeys(page, projectB?.id ?? "")).toEqual([]);
    expect(await storedDataKeys(page, projectA?.id ?? "")).not.toHaveLength(0);
    // Remote rows: the purge fires scoped to this project's app_id (best
    // effort by design — the local purge above never waits on it).
    await expect
      .poll(() =>
        purgeRequests.some((url) => url.includes(`app_id=eq.${projectB?.id}`)),
      )
      .toBe(true);

    // Decision 4: screens outlive their project — B's screen is still here,
    // now ungrouped, and A's project keeps working.
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole(ROLE.button, { name: entryRowName(JSON_IO.importedEntry) }),
    ).toBeVisible();
    await expect(drawer.getByLabel(PROJECT_B, { exact: true })).toHaveCount(0);

    await drawer
      .getByRole(ROLE.button, { name: entryRowName(PROMPT_A) })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Data screen A", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(NOTE_A).filter({ visible: true }),
    ).toBeVisible();
  });
});
