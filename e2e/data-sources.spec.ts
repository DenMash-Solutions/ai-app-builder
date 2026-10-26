import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PATHS, PROMPTS, ROLE, TODO } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import {
  API_ERROR_UI_LINES,
  API_UNSET_REF_UI_LINES,
  TODO_UI_LINES,
  TODO_UI_LINES_API,
  TODO_UI_LINES_API_KEYED,
  TODO_UI_LINES_SUPABASE,
} from "./msw/fixture";
import { deleteGenuiRecords, serviceClient } from "./db";
import { canSeed, e2eEnv } from "./env";

/**
 * Data sources (docs/plan/043-data-sources, M1): a generated design declares a
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

/** Row container for one todo (fixture marks items with this class).
 *  `visible: true` scopes past Activity-parked copies of the previous route
 *  (Cache Components keeps navigated-away pages mounted hidden). */
const row = (page: Page, title: string) =>
  page
    .locator(".todo-item")
    .filter({ visible: true })
    .filter({ hasText: title, visible: true });

const count = (page: Page) =>
  page.locator(`.${TODO.countClass}`).filter({ visible: true });

async function generateTodos(page: Page): Promise<void> {
  await mockGenerate(page, { lines: TODO_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await expect(
    page
      .getByRole(ROLE.heading, { name: TODO.heading })
      .filter({ visible: true }),
  ).toBeVisible();
}

async function addTodo(page: Page, title: string): Promise<void> {
  await page
    .getByPlaceholder(TODO.addPlaceholder)
    .filter({ visible: true })
    .filter({ visible: true })
    .fill(title);
  await page
    .getByRole(ROLE.button, { name: TODO.addLabel })
    .filter({ visible: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByText(title).filter({ visible: true })).toBeVisible();
}

test.describe("data sources — persistent todo (localStorage)", () => {
  test("adds, completes and deletes todos; everything survives a reload", async ({
    page,
  }) => {
    await generateTodos(page);
    // Fresh visitor: the store is empty — the empty branch, not an error.
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("0");

    // Create through data_mutate (input state → record → silent clear).
    await addTodo(page, TODO.first);
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(count(page)).toHaveText("1");

    // A second record — the repeat renders both, count follows (T12: two
    // components on one query must update together).
    await addTodo(page, TODO.second);
    await expect(count(page)).toHaveText("2");

    // Persistence: the design's own URL reloaded keeps both records.
    await page.reload();
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.first).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.second).filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("2");

    // Complete: the update refreshes the row — mark shown, button gone.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.doneLabel })
      .filter({ visible: true })
      .click();
    await expect(
      row(page, TODO.first).getByText(TODO.doneMark).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      row(page, TODO.first)
        .getByRole(ROLE.button, { name: TODO.doneLabel })
        .filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      row(page, TODO.second).getByText(TODO.doneMark).filter({ visible: true }),
    ).toHaveCount(0);

    // Delete both — back to the empty branch, and it sticks.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.deleteLabel })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(TODO.first).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(count(page)).toHaveText("1");
    await row(page, TODO.second)
      .getByRole(ROLE.button, { name: TODO.deleteLabel })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("0");

    await page.reload();
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("0");
  });

  test("the add button gates on validation: an empty submit is impossible", async ({
    page,
  }) => {
    await generateTodos(page);
    const add = page
      .getByRole(ROLE.button, { name: TODO.addLabel })
      .filter({ visible: true })
      .filter({ visible: true });

    // Fresh form: /formValidation doesn't exist yet — the $cond binding
    // renders disabled, so a press can never reach data_mutate.
    await expect(add).toBeDisabled();

    // A real value validates on change and enables the button…
    await page
      .getByPlaceholder(TODO.addPlaceholder)
      .filter({ visible: true })
      .filter({ visible: true })
      .fill(TODO.first);
    await expect(add).toBeEnabled();

    // …clearing it fires the watcher again — message shown, re-locked.
    await page
      .getByPlaceholder(TODO.addPlaceholder)
      .filter({ visible: true })
      .filter({ visible: true })
      .fill("");
    await expect(
      page.getByText(TODO.required).filter({ visible: true }),
    ).toBeVisible();
    await expect(add).toBeDisabled();

    // Back to a valid value, then submit: the record appears, the press's
    // setState clears the field, and the SAME watcher re-runs — the
    // button re-locks itself with no extra wiring.
    await page
      .getByPlaceholder(TODO.addPlaceholder)
      .filter({ visible: true })
      .filter({ visible: true })
      .fill(TODO.first);
    await expect(
      page.getByText(TODO.required).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(
      page.getByText(TODO.first).filter({ visible: true }),
    ).toBeVisible();
    await expect(add).toBeDisabled();
    // Exactly one row for one press — the invalid states never fired
    // data_mutate (the empty-submission bug this gating eliminates).
    await expect(count(page)).toHaveText("1");
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
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toHaveCount(0);
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
    await expect(
      page.getByText("Other tab todo").filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("2");
  });
});

/**
 * Database provider (docs/plan/046-database-provider, M2): the SAME todo
 * design with `provider: "supabase"` — every read/write is a real
 * PostgREST round-trip to the project (the MSW worker only mocks
 * /api/generate and bypasses everything else; `delay`/`fail` journeys
 * instrument the host via Playwright routing). Fresh visitors are
 * transparently signed in anonymously, so rows are per-visitor under RLS.
 * Cleanup is namespace-scoped (the design uuid the test itself minted)
 * via the service role.
 */

/**
 * Instrumentation (never the journey itself): these journeys run WITHOUT
 * the MSW worker — a registered service worker swallows Playwright-level
 * routing (SW-bound requests bypass `page.route`), which is exactly why
 * `delay`/`fail` never fired while MSW was active. So they route
 * everything through Playwright itself: `/api/generate` is fulfilled with
 * the same JSONL the worker would serve, and the supabase host is
 * delayed (loading branch observable) or aborted (error branch
 * deterministic). The passthrough journeys keep the MSW worker and run
 * against the live project untouched.
 */
async function mockGenerateViaRoute(
  page: Page,
  lines: string[],
): Promise<void> {
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      // Steer/edit requests never occur in these journeys — the fixture
      // is served as the initial generation every time.
      body: `${lines.join("\n")}\n`,
    }),
  );
}

async function failSupabase(page: Page): Promise<void> {
  await page.route(/supabase\.co/, (route) => route.abort("connectionrefused"));
}

async function delaySupabase(page: Page, ms: number): Promise<void> {
  await page.route(/supabase\.co/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

async function generateTodosSupabase(
  page: Page,
  mode?: "fail" | "delay",
  delayMs?: number,
): Promise<string> {
  if (mode) {
    // Instrumented: Playwright routes only — no MSW worker registered.
    await mockGenerateViaRoute(page, TODO_UI_LINES_SUPABASE);
    if (mode === "fail") await failSupabase(page);
    if (mode === "delay") await delaySupabase(page, delayMs ?? 0);
    await page.goto(PATHS.ui);
  } else {
    await mockGenerate(page, { lines: TODO_UI_LINES_SUPABASE });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
  }
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  const entry = (await readHistoryStorage(page)).find(
    (stored) => stored.prompt === PROMPTS.signIn,
  );
  if (!entry) {
    throw new Error("supabase todo entry not found in local history");
  }
  return entry.id;
}

test.describe("data sources — database provider (supabase)", () => {
  test.skip(
    !canSeed,
    "SUPABASE_SERVICE_ROLE_KEY not set — the real-project journeys cannot clean up their rows",
  );
  test.skip(
    process.env.E2E_SKIP_MUTATING === "1",
    "another e2e run holds the lock — refusing to run state-mutating suites",
  );

  test("a fresh visitor's todos persist in the project database across reloads", async ({
    page,
  }) => {
    const entryId = await generateTodosSupabase(page);
    try {
      await expect(
        page.getByText(TODO.empty).filter({ visible: true }),
      ).toBeVisible();
      await expect(count(page)).toHaveText("0");
      await addTodo(page, TODO.first);
      await expect(count(page)).toHaveText("1");

      // A reload reattaches the design to the SAME visitor session — the
      // record is still there because it is a row, not a browser byte.
      await page.reload();
      await expect(
        page
          .getByRole(ROLE.heading, { name: TODO.heading })
          .filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByText(TODO.first).filter({ visible: true }),
      ).toBeVisible();
      await expect(count(page)).toHaveText("1");
    } finally {
      await deleteGenuiRecords([entryId]);
    }
  });

  test("the loading branch paints while the database reads (M1 descope, at last)", async ({
    page,
  }) => {
    const entryId = await generateTodosSupabase(page, "delay", 1000);
    try {
      // The async read makes the loading mirror observable…
      await expect(
        page.getByText(TODO.loading).filter({ visible: true }),
      ).toBeVisible();
      // …then the empty branch replaces it once the round-trip lands.
      await expect(
        page.getByText(TODO.empty).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByText(TODO.loading).filter({ visible: true }),
      ).toHaveCount(0);
    } finally {
      await deleteGenuiRecords([entryId]);
    }
  });

  test("a write disables its buttons and shows the pending indicator until it lands", async ({
    page,
  }) => {
    const entryId = await generateTodosSupabase(page, "delay", 1000);
    try {
      // The initial (delayed) read settles into the empty branch.
      await expect(
        page.getByText(TODO.empty).filter({ visible: true }),
      ).toBeVisible();
      const add = page
        .getByRole(ROLE.button, { name: TODO.addLabel })
        .filter({ visible: true })
        .filter({ visible: true });
      await page
        .getByPlaceholder(TODO.addPlaceholder)
        .filter({ visible: true })
        .filter({ visible: true })
        .fill(TODO.first);
      await expect(add).toBeEnabled();

      // Click: the POST + its refresh are both delayed — the button is
      // held busy (disabled, aria-busy, spinner) and the manager-stamped
      // mirror flag paints the "Saving…" indicator.
      await add.click();
      await expect(add).toBeDisabled();
      await expect(add).toHaveAttribute("aria-busy", "true");
      await expect(
        add.locator(".animate-spin").filter({ visible: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText(TODO.saving).filter({ visible: true }),
      ).toBeVisible();

      // Settled: the busy state is over — aria-busy and the "Saving…"
      // indicator are gone, and the record rendered. The button STAYS
      // disabled here on purpose: the submit cleared the field, so the
      // validation watcher re-locked it (covered by the gating journey).
      await expect(add).not.toHaveAttribute("aria-busy", "true", {
        timeout: 15_000,
      });
      await expect(
        page.getByText(TODO.saving).filter({ visible: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(TODO.first).filter({ visible: true }),
      ).toBeVisible();
      await expect(count(page)).toHaveText("1");

      // Recovery: a fresh value re-enables the button — busy never latches.
      await page
        .getByPlaceholder(TODO.addPlaceholder)
        .filter({ visible: true })
        .filter({ visible: true })
        .fill(TODO.second);
      await expect(add).toBeEnabled();
    } finally {
      await deleteGenuiRecords([entryId]);
    }
  });

  test("an unreachable database shows the friendly error branch, not a broken page", async ({
    page,
  }) => {
    await generateTodosSupabase(page, "fail");
    await expect(
      page.getByText(TODO.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("a corrupt stored record surfaces the error branch, not a broken page", async ({
    page,
  }) => {
    const entryId = await generateTodosSupabase(page);
    try {
      await addTodo(page, TODO.first);

      // Environment seeding: rewrite this design's rows with a
      // schema-violating payload (service role — the journey up to here
      // and the error rendering are pure UI).
      const { error } = await serviceClient()
        .from("genui_records")
        .update({ data: { title: 42, done: false } })
        .eq("app_id", entryId)
        .eq("resource", "todos");
      if (error) {
        throw new Error(`corrupt-row seeding failed: ${error.message}`);
      }

      await page.reload();
      await expect(
        page
          .getByRole(ROLE.heading, { name: TODO.heading })
          .filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByText(TODO.error).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByText(TODO.first).filter({ visible: true }),
      ).toHaveCount(0);
    } finally {
      await deleteGenuiRecords([entryId]);
    }
  });
});

test.describe("data sources — RLS boundary (supabase)", () => {
  test("without a session the table reads empty and writes are denied", async ({
    request,
  }) => {
    const table = `${e2eEnv.supabaseUrl}/rest/v1/genui_records`;

    // Read with the public key but NO user session: the anon role matches
    // no policy — every row is invisible (empty, not an error).
    const select = await request.get(`${table}?select=id&limit=1`, {
      headers: {
        apikey: e2eEnv.anonKey,
        Authorization: `Bearer ${e2eEnv.anonKey}`,
      },
    });
    expect(select.ok()).toBeTruthy();
    expect(await select.json()).toEqual([]);

    // Write with no session: the policy itself refuses the row. This
    // gateway reports policy denial for anon writes as HTTP 401 carrying
    // the PostgREST 42501 payload — assert BOTH layers (wire + code).
    const insert = await request.post(table, {
      headers: {
        apikey: e2eEnv.anonKey,
        Authorization: `Bearer ${e2eEnv.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: {
        app_id: "e2e-rls-should-never-land",
        resource: "todos",
        id: "no-session",
        data: {},
      },
    });
    expect(insert.status()).toBe(401);
    const denial = (await insert.json()) as { code?: string; message?: string };
    expect(denial.code).toBe("42501");
    expect(denial.message).toContain("row-level security");
  });
});

test.describe("data sources — API provider (api, browser-direct)", () => {
  /** Same todo design, data source swapped to the browser-direct API. */
  async function generateTodosApi(page: Page): Promise<void> {
    await mockGenerate(page, { lines: TODO_UI_LINES_API });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
  }

  test("reads a public API browser-direct and round-trips a write", async ({
    page,
  }) => {
    await generateTodosApi(page);

    // The seeded row comes from the MSW-answered API — no storage involved
    // (the adapter fetched http://localhost:3000/api-public/todos itself).
    await expect(
      page.getByText("Ship M3").filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("1");

    // Create: POST to the collection, then the manager's refresh re-reads.
    await addTodo(page, TODO.first);
    await expect(count(page)).toHaveText("2");

    // Complete: PATCH the record — mark shown, button gone.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.doneLabel })
      .filter({ visible: true })
      .click();
    await expect(
      row(page, TODO.first).getByText(TODO.doneMark).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      row(page, TODO.first)
        .getByRole(ROLE.button, { name: TODO.doneLabel })
        .filter({ visible: true }),
    ).toHaveCount(0);

    // Delete: back to the seed — every verb of the REST mapping exercised.
    await row(page, TODO.first)
      .getByRole(ROLE.button, { name: TODO.deleteLabel })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(TODO.first).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(count(page)).toHaveText("1");

    // Reload re-reads the API from scratch — the design re-attaches and
    // renders exactly what the endpoint serves (seed only: the deleted
    // row stays deleted, nothing was stored locally).
    await page.reload();
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Ship M3").filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("1");
  });

  test("a failing API shows the friendly error branch, not a broken page", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: API_ERROR_UI_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // The collection always answers 500 → normalized `unavailable` →
    // the mirror's error branch, with the page otherwise intact.
    await expect(
      page.getByText(TODO.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.locator(".api-error").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.empty).filter({ visible: true }),
    ).toHaveCount(0);
  });
});

test.describe("data sources — keyed API (Lane 2 proxy)", () => {
  /** What the browser sent to the proxy — read back from the MSW worker. */
  const lastProxyCall = (page: Page) =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __LAST_PROXY__?: {
              ref: string;
              path: string;
              method: string;
              clientSentAuth: boolean;
            };
            __LAST_PROXY_WRITE__?: {
              ref: string;
              path: string;
              method: string;
              clientSentAuth: boolean;
            };
          }
        ).__LAST_PROXY__,
    );

  const lastProxyWrite = (page: Page) =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __LAST_PROXY_WRITE__?: {
              ref: string;
              path: string;
              method: string;
              clientSentAuth: boolean;
            };
          }
        ).__LAST_PROXY_WRITE__,
    );

  test("a keyed source routes through the proxy with no key in the browser", async ({
    page,
  }) => {
    // The keyed store is only served through /api/data-proxy — a plain
    // browser-direct fetch to the spec's baseUrl would find no handler
    // and fail, so a rendered list PROVES the proxy transport.
    await mockGenerate(page, { lines: TODO_UI_LINES_API_KEYED });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();

    // List read through the proxy (GET /todos), then a round-trip write.
    await expect(
      page.getByText("Keyed seed").filter({ visible: true }),
    ).toBeVisible();
    await expect(count(page)).toHaveText("1");
    await addTodo(page, TODO.first);
    await expect(count(page)).toHaveText("2");

    // The write itself rode the proxy with the ref + path and NO
    // client-held credential; the manager's post-write refresh re-GETs.
    expect(await lastProxyWrite(page)).toMatchObject({
      ref: "weather",
      path: "/todos",
      method: "POST",
      clientSentAuth: false,
    });
    expect(await lastProxyCall(page)).toMatchObject({
      ref: "weather",
      path: "/todos",
      method: "GET",
      clientSentAuth: false,
    });

    // Reload: the design re-attaches and re-reads through the proxy —
    // nothing was stored locally, so the page shows exactly what the
    // keyed origin serves afresh (its own seed again).
    await page.reload();
    await expect(
      page
        .getByRole(ROLE.heading, { name: TODO.heading })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Keyed seed").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(TODO.first).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(count(page)).toHaveText("1");
    expect(await lastProxyCall(page)).toMatchObject({
      ref: "weather",
      path: "/todos",
      method: "GET",
      clientSentAuth: false,
    });
  });

  test("an unconfigured auth ref degrades to the friendly error branch", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: API_UNSET_REF_UI_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // unknown_ref → the adapter's DataError → the mirror's error branch,
    // with the page otherwise intact.
    await expect(
      page.getByText(TODO.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.locator(".api-unset-ref").filter({ visible: true }),
    ).toBeVisible();
    expect(await lastProxyCall(page)).toMatchObject({ ref: "unset" });
  });
});
