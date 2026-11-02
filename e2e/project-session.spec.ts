import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
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
  readHistoryStorage,
  readStoredProjects,
  shieldFromHeadSlotHides,
  waitForMsw,
} from "./helpers";

/**
 * Shared data/state (plan 061-4, A3): two screens of one project share the
 * `/session` subtree (seed + write-through) and the record namespace
 * (`QueryLoader namespace = projectId`), while screen-local state never
 * crosses. The `navigate` action is the screen change under test — the same
 * binding the model authors from the sibling list.
 */

const PROJECT_NAME = "Shared App";
/** Screen A's entry name — its prompt — and therefore a resolvable ref. */
const PROMPT_A = "Session screen A";
/** The imported entry's name (061 JSON import seam) — screen B's ref. */
const REF_B = JSON_IO.importedEntry;
const SESSION_TOKEN = "shared-42";
const LOCAL_DRAFT = "local-only";
const NOTE_TITLE = "shared-note";
/** Written on B and read back on A within the debounce window — this is the
 *  unmount-flush half of the write-through. */
const BUMP_TOKEN = "b-v2";

function line(op: Record<string, unknown>): string {
  return JSON.stringify(op);
}

function elementPath(key: string): string {
  return `${PATCH_PATH.elements}/${key}`;
}

/** Per-spec data blocks (043): declarations stay per spec — only the
 *  namespace (`genui-data:{projectId}:{collection}`) is what they share. */
const DATA_BLOCKS = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.dataSources,
    value: { sharedNotes: { provider: "localStorage", config: {} } },
  }),
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.resources,
    value: {
      notes: { dataSource: "sharedNotes", schema: { title: "string" } },
    },
  }),
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.queries,
    value: { noteList: { resource: "notes", operation: "list" } },
  }),
];

const press = (action: Record<string, unknown>) => ({ press: [action] });

/** Screen A — writes both halves of "shared" and navigates to B. */
const SCREEN_A_LINES: string[] = [
  ...DATA_BLOCKS,
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "a-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: [
        "a-heading",
        "a-token",
        "a-shared",
        "a-local",
        "a-note",
        "a-nav",
      ],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-heading"),
    value: {
      type: COMPONENT.heading,
      props: { text: "Screen A", level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-token"),
    value: {
      type: COMPONENT.text,
      props: {
        text: { $state: "/session/token" },
        className: "session-token",
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-shared"),
    value: {
      type: COMPONENT.button,
      props: { label: "Save shared" },
      on: press({
        action: "setState",
        params: { statePath: "/session/token", value: SESSION_TOKEN },
      }),
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-local"),
    value: {
      type: COMPONENT.button,
      props: { label: "Save local" },
      on: press({
        action: "setState",
        params: { statePath: "/draft", value: LOCAL_DRAFT },
      }),
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-note"),
    value: {
      type: COMPONENT.button,
      props: { label: "Add note" },
      on: press({
        action: "data_mutate",
        params: {
          op: "create",
          resource: "notes",
          input: { title: NOTE_TITLE },
        },
      }),
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("a-nav"),
    value: {
      type: COMPONENT.button,
      props: { label: "Go to screen B" },
      on: press({ action: "navigate", params: { screen: REF_B } }),
      children: [],
    },
  }),
];

/** Screen B — imported via JSON; reads what A wrote through, and navigates
 *  back with a ref that resolves by name (case-insensitive). */
const SCREEN_B_SPEC = {
  root: "b-root",
  dataSources: { sharedNotes: { provider: "localStorage", config: {} } },
  resources: {
    notes: { dataSource: "sharedNotes", schema: { title: "string" } },
  },
  queries: { noteList: { resource: "notes", operation: "list" } },
  elements: {
    "b-root": {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: [
        "b-heading",
        "b-session",
        "b-leak",
        "b-count",
        "b-list",
        "b-bump",
        "b-back",
      ],
    },
    "b-heading": {
      type: COMPONENT.heading,
      props: { text: "Screen B", level: "h1" },
      children: [],
    },
    "b-session": {
      type: COMPONENT.text,
      props: {
        text: { $state: "/session/token" },
        className: "session-token",
      },
      children: [],
    },
    // Screen-local state from A must NOT be visible here.
    "b-leak": {
      type: COMPONENT.text,
      props: { text: "LOCAL-LEAK" },
      visible: { $state: "/draft", eq: LOCAL_DRAFT },
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
    "b-bump": {
      type: COMPONENT.button,
      props: { label: "Bump token" },
      on: press({
        action: "setState",
        params: { statePath: "/session/token", value: BUMP_TOKEN },
      }),
      children: [],
    },
    "b-back": {
      type: COMPONENT.button,
      props: { label: "Back to screen A" },
      on: press({ action: "navigate", params: { screen: PROMPT_A } }),
      children: [],
    },
  },
};

test.describe("shared data/state in a project (061-4, A3)", () => {
  test("two screens share /session and records through the project namespace, navigate to each other, and grouping survives reload", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: SCREEN_A_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await createProject(page, PROJECT_NAME);

    // --- Generate screen A into the active project (creation seam) ---
    await page.getByPlaceholder(UI.promptPlaceholder).fill(PROMPT_A);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.generate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Screen A", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // --- Write both halves of "shared" on A ---
    await page.getByRole(ROLE.button, { name: "Save shared" }).click();
    await page.getByRole(ROLE.button, { name: "Save local" }).click();
    await page.getByRole(ROLE.button, { name: "Add note" }).click();
    // Trailing debounce for the /session write-through is 300ms — let the
    // store land before reading it (the flush path is exercised below).
    await page.waitForTimeout(500);

    const projects = await readStoredProjects(page);
    const project = projects.find((entry) => entry.name === PROJECT_NAME);
    expect(project).toBeDefined();
    expect(project?.state).toEqual({ token: SESSION_TOKEN });

    const historyAfterA = await readHistoryStorage(page);
    expect(historyAfterA).toHaveLength(1);
    expect(historyAfterA[0].projectId).toBe(project?.id);

    // The record landed in the PROJECT namespace, not a per-screen one.
    const dataPrefix = `genui-data:${project?.id}:`;
    await expect
      .poll(() =>
        page.evaluate(
          (prefix) =>
            Object.keys(localStorage).some((key) => key.startsWith(prefix)),
          dataPrefix,
        ),
      )
      .toBe(true);

    // --- Import screen B (the JSON seam stamps the active project too) ---
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

    // --- Drawer groups both screens under the project ---
    await page
      .getByRole(ROLE.button, { name: historyButtonName(2) })
      .filter({ visible: true })
      .click();
    await expect(drawer).toBeVisible();
    const group = drawer.getByLabel(PROJECT_NAME, { exact: true });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole(ROLE.button, { name: entryRowName(PROMPT_A) }),
    ).toBeVisible();
    await expect(
      group.getByRole(ROLE.button, { name: entryRowName(REF_B) }),
    ).toBeVisible();

    // --- Activate B from the drawer: it reads what A wrote through ---
    await group.getByRole(ROLE.button, { name: entryRowName(REF_B) }).click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Screen B", exact: true }),
    ).toBeVisible();
    const history = await readHistoryStorage(page);
    const entryB = history.find((entry) => entry.name === REF_B);
    expect(entryB?.projectId).toBe(project?.id);
    await expect(page).toHaveURL(new RegExp(`/ui/${entryB?.id}$`));

    // Shared /session: seeded from the project store on B's mount.
    // House style (plan 059 T1): Next 16 keeps previous routes mounted via
    // <Activity> (display:none) — every raw locator must be visibility-aware.
    await expect(
      page.locator(".session-token").filter({ visible: true }),
    ).toHaveText(SESSION_TOKEN);
    // Screen-local state did NOT cross the screen change.
    await expect(
      page.getByText("LOCAL-LEAK").filter({ visible: true }),
    ).toHaveCount(0);
    // Shared records: the same namespace serves B's query.
    await expect(
      page.getByText(NOTE_TITLE).filter({ visible: true }),
    ).toBeVisible();

    // --- Unmount flush: bump on B, navigate back inside the 300ms window ---
    await page.getByRole(ROLE.button, { name: "Bump token" }).click();
    await page.getByRole(ROLE.button, { name: "Back to screen A" }).click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Screen A", exact: true }),
    ).toBeVisible();
    // The route was RESTORED (Activity preserves its old state) — the
    // hide cleanup must flush B's pending write (stamp-guarded), and the
    // store→state pull must reconcile the restored screen with it.
    await expect(
      page.locator(".session-token").filter({ visible: true }),
    ).toHaveText(BUMP_TOKEN);

    // --- Reload keeps the grouping and the selection ---
    await page.reload();
    await expect(
      page
        .getByRole(ROLE.button, { name: PROJECTS.switcher })
        .filter({ visible: true })
        .getByText(PROJECT_NAME),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: historyButtonName(2) })
      .filter({ visible: true })
      .click();
    const groupAfterReload = drawer.getByLabel(PROJECT_NAME, {
      exact: true,
    });
    await expect(groupAfterReload).toBeVisible();
    await expect(
      groupAfterReload.getByRole(ROLE.button, {
        name: entryRowName(PROMPT_A),
      }),
    ).toBeVisible();
    const historyAfterReload = await readHistoryStorage(page);
    expect(historyAfterReload).toHaveLength(2);
    expect(
      historyAfterReload.every((entry) => entry.projectId === project?.id),
    ).toBe(true);
  });
});

/**
 * Workspace membership end-to-end (plan 065, task 5): the drawer's
 * membership-driven grouping and the panel's flows (add / remove, route
 * config, home pick), the workspace route resolving and seeding params on
 * BOTH the editor (`/ui/[ref]/[[...param]]`) and the preview client
 * (`/{locale}/{slug}/{…route}`), and persistence across reload.
 */
test.describe("project workspace membership (plan 065)", () => {
  const PROJECT_ONE = "Alpha Project";
  const PROJECT_TWO = "Beta Project";
  const ROUTE_PROJECT = "Route Project";
  const HOME_PROJECT = "Home Project";
  const PROMPT_ONE = "Screen A";
  const PROMPT_HOME = "Launch page";
  const HOME_HEADING = "Home screen";
  /** The imported entry's name — the ref a navigate target resolves by. */
  const REF_IMPORT = JSON_IO.importedEntry;
  /** B's workspace route (decision 6's `{param}` syntax) and its URL. */
  const ROUTE_PATTERN = "items/{id}";
  const ROUTE_URL_SEGMENT = "/items/7";
  /** A's model-authored navigate param — the record id segment. */
  const NAV_PARAM_ID = "7";

  const headingLines = (key: string, text: string): string[] => [
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

  /** Screen A — the prompt-taught navigate to B with a record param: the
   *  route is built from B's WORKSPACE route (decision 14's teaching). */
  const NAV_A_LINES: string[] = [
    line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "a-root" }),
    line({
      op: PATCH_OP.add,
      path: elementPath("a-root"),
      value: {
        type: COMPONENT.stack,
        props: { direction: "vertical", gap: "md" },
        children: ["a-heading", "a-nav"],
      },
    }),
    // NOTE: not headingLines() — that helper also re-points root at the
    // heading, which would orphan the stack (and the nav button below).
    line({
      op: PATCH_OP.add,
      path: elementPath("a-heading"),
      value: {
        type: COMPONENT.heading,
        props: { text: PROMPT_ONE, level: "h1" },
        children: [],
      },
    }),
    line({
      op: PATCH_OP.add,
      path: elementPath("a-nav"),
      value: {
        type: COMPONENT.button,
        props: { label: "Go to B" },
        on: press({
          action: "navigate",
          params: { screen: REF_IMPORT, id: NAV_PARAM_ID },
        }),
        children: [],
      },
    }),
  ];

  /** Imported screen B — reads the path param the route seeds. */
  const SCREEN_B_ROUTE_SPEC = {
    root: "b-root",
    elements: {
      "b-root": {
        type: COMPONENT.stack,
        props: { direction: "vertical", gap: "md" },
        children: ["b-heading", "b-id"],
      },
      "b-heading": {
        type: COMPONENT.heading,
        props: { text: "Screen B", level: "h1" },
        children: [],
      },
      "b-id": {
        type: COMPONENT.text,
        props: { text: { $state: "/id" }, className: "route-id" },
        children: [],
      },
    },
  };

  /** Imported screen with its own heading — the second project's screen. */
  const SCREEN_C_SPEC = {
    root: "c-root",
    elements: {
      "c-root": {
        type: COMPONENT.heading,
        props: { text: "Screen C", level: "h1" },
        children: [],
      },
    },
  };

  /** Opens the history drawer when it is closed (import and entry
   *  activation both close it) and waits for it to show. */
  async function openDrawer(page: Page, count: number): Promise<Locator> {
    const drawer = page.locator(SLOTS.drawer).filter({ visible: true });
    if ((await drawer.count()) === 0) {
      await shieldFromHeadSlotHides(page);
      const trigger = page.getByRole(ROLE.button, {
        name: historyButtonName(count),
      });
      await trigger.filter({ visible: true }).click();
    }
    await expect(drawer).toBeVisible({ timeout: 2000 });
    return drawer;
  }

  /** Imports a spec through the drawer's JSON seam — the seam stamps the
   *  active project, then closes the drawer and activates the screen. */
  async function importViaDrawer(
    page: Page,
    spec: Record<string, unknown>,
    countBefore: number,
  ): Promise<void> {
    const drawer = await openDrawer(page, countBefore);
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

  /** The panel's member row for a named screen — the "Actions for {name}"
   *  button is unique to panel rows (drawer rows never carry it). */
  function memberRow(group: Locator, page: Page, name: string): Locator {
    return group.locator("li").filter({
      has: page.getByRole(ROLE.button, { name: PROJECTS.rowActions(name) }),
    });
  }

  test("a screen in two projects — remove from one keeps it in the other; reload keeps membership", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: headingLines("a-root", PROMPT_ONE) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await createProject(page, PROJECT_ONE);

    // Screen A is born into project one (generation seam).
    await page.getByPlaceholder(UI.promptPlaceholder).fill(PROMPT_ONE);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.generate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: PROMPT_ONE, exact: true }),
    ).toBeVisible();
    // Generate navigates to /en/ui/{uuid} — opening the drawer mid-transition
    // defers the drawer/dialog subtree's layout effects (Radix Presence never
    // mounts). The passing test below waits for this URL; do the same.
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // Screen C is born into project two (the JSON seam stamps the active
    // project too).
    await createProject(page, PROJECT_TWO);
    await importViaDrawer(page, SCREEN_C_SPEC, 1);

    // Project two's workspace adds screen A → a member of BOTH projects.
    const drawer = await openDrawer(page, 2);
    const groupTwo = drawer.getByLabel(PROJECT_TWO, { exact: true });
    await groupTwo
      .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
      .filter({ visible: true })
      .click();
    await groupTwo
      .getByRole(ROLE.button, { name: PROJECTS.addScreen })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.menuitem, { name: PROMPT_ONE })
      .filter({ visible: true })
      .click();

    // Row-driven grouping: A shows under BOTH project groups.
    const groupOne = drawer.getByLabel(PROJECT_ONE, { exact: true });
    await expect(
      groupOne.getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toBeVisible();
    await expect(
      groupTwo.getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toBeVisible();

    // Remove A from project one — project two keeps it (membership only).
    await groupOne
      .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
      .filter({ visible: true })
      .click();
    await memberRow(groupOne, page, PROMPT_ONE)
      .getByRole(ROLE.button, { name: PROJECTS.rowActions(PROMPT_ONE) })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.menuitem, { name: PROJECTS.removeScreen })
      .filter({ visible: true })
      .click();
    await expect(
      groupOne.getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toHaveCount(0);
    await expect(
      groupTwo.getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toBeVisible();

    // Reload: both memberships persisted — two still lists A, one never
    // resurrects it (decision 12's pointer hygiene + the idempotent heal).
    await page.reload();
    const drawerAfter = await openDrawer(page, 2);
    await expect(
      drawerAfter
        .getByLabel(PROJECT_TWO, { exact: true })
        .getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toBeVisible();
    await expect(
      drawerAfter
        .getByLabel(PROJECT_ONE, { exact: true })
        .getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) }),
    ).toHaveCount(0);
  });

  test("a workspace route builds the navigate path and seeds params on both surfaces", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: NAV_A_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await createProject(page, ROUTE_PROJECT);

    // Screen A (generated into the project) navigates to B by ref with a
    // record param — what NAVIGATE_RULES teaches for a listed route.
    await page.getByPlaceholder(UI.promptPlaceholder).fill(PROMPT_ONE);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.generate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: PROMPT_ONE, exact: true }),
    ).toBeVisible();
    // Same as test 1: wait for generate's route transition before touching
    // the drawer, else the dialog's layout effects are deferred (Presence
    // stuck "unmounted", dialog never mounts).
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // Screen B (imported into the project) reads the seeded path param.
    await importViaDrawer(page, SCREEN_B_ROUTE_SPEC, 1);

    // Configure B's workspace route (decision 6's `{param}` syntax).
    const drawer = await openDrawer(page, 2);
    const group = drawer.getByLabel(ROUTE_PROJECT, { exact: true });
    await group
      .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
      .filter({ visible: true })
      .click();
    const rowB = memberRow(group, page, REF_IMPORT);
    await rowB
      .getByRole(ROLE.button, { name: PROJECTS.routeEdit })
      .filter({ visible: true })
      .click();
    const routeInput = rowB.getByRole(ROLE.textbox, {
      name: PROJECTS.routeEdit,
    });
    await routeInput.fill(ROUTE_PATTERN);
    await routeInput.press("Enter");
    // The committed route renders as the row's chip (duplicate routes are
    // rejected at write — decision 7, unit-tested).
    await expect(rowB.getByText(ROUTE_PATTERN)).toBeVisible();

    // Back on A: the model-authored navigate BUILDS the workspace route —
    // the editor serves B with the record param seeded.
    await drawer
      .getByRole(ROLE.button, { name: entryRowName(PROMPT_ONE) })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: PROMPT_ONE, exact: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: "Go to B" })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: "Screen B", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/ui/[0-9a-f-]{36}${ROUTE_URL_SEGMENT}$`),
    );
    await expect(
      page.locator(".route-id").filter({ visible: true }),
    ).toHaveText(NAV_PARAM_ID);

    // The preview client resolves the same dynamic route and seeds it.
    const projects = await readStoredProjects(page);
    const project = projects.find(
      (candidate) => candidate.name === ROUTE_PROJECT,
    );
    expect(project).toBeDefined();
    await page.goto(`/en/${project?.slug}${ROUTE_URL_SEGMENT}`);
    await expect(
      page.getByRole(ROLE.heading, { name: "Screen B", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".route-id").filter({ visible: true }),
    ).toHaveText(NAV_PARAM_ID);
  });

  test("the home screen serves the bare project namespace and survives reload", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: headingLines("h-root", HOME_HEADING) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await createProject(page, HOME_PROJECT);

    await page.getByPlaceholder(UI.promptPlaceholder).fill(PROMPT_HOME);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.generate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole(ROLE.heading, { name: HOME_HEADING, exact: true }),
    ).toBeVisible();

    const projects = await readStoredProjects(page);
    const project = projects.find(
      (candidate) => candidate.name === HOME_PROJECT,
    );
    expect(project).toBeDefined();

    // Decision 13: the generation flow seeds the home automatically via
    // the in-session backfill (screens created via entry.projectId get
    // membership rows on the next history commit, and the first member
    // seeds an empty home). The bare namespace serves the home screen
    // immediately — no "UI not found" state.
    await page.goto(`/en/${project?.slug}`);
    await expect(
      page.getByRole(ROLE.heading, { name: HOME_HEADING, exact: true }),
    ).toBeVisible();

    // Verify the home star is already set in the workspace panel
    // (decision 13 seeded it automatically).
    await page.goto(PATHS.ui);
    const drawer = await openDrawer(page, 1);
    const group = drawer.getByLabel(HOME_PROJECT, { exact: true });
    await group
      .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
      .filter({ visible: true })
      .click();
    await expect(
      memberRow(group, page, PROMPT_HOME).getByRole(ROLE.button, {
        name: PROJECTS.unsetHome,
      }),
    ).toHaveAttribute("aria-pressed", "true");

    // The bare namespace serves the home screen — and a reload keeps
    // both the membership and the home pick.
    await page.goto(`/en/${project?.slug}`);
    await expect(
      page.getByRole(ROLE.heading, { name: HOME_HEADING, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole(ROLE.heading, { name: HOME_HEADING, exact: true }),
    ).toBeVisible();
  });
});
