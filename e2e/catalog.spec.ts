import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Spec } from "@json-render/core";
import { CATALOG, ACTIONS, EDITOR, PATHS, ROLE, UI } from "./constants";
import { dismissUploadNudge } from "./authed-helpers";
import {
  createProject,
  mockGenerate,
  readStoredProjects,
  waitForMsw,
} from "./helpers";
import {
  CATALOG_SEEDED_STORAGE_KEY,
  CATALOG_STORAGE_KEY,
  CATALOG_TYPES,
  CATALOG_VISIBILITIES,
} from "@/lib/catalog/catalog";
import { TEMPLATE_STORAGE_KEY } from "@/lib/editor/templates";
import {
  deleteSeededCatalogAsset,
  deleteTestProject,
  deleteTestRow,
  publishSeededCatalogVersion,
  resolveUserByEmail,
  seedCatalogAsset,
  seedOwnedProject,
  serviceClient,
  waitForRemoteCatalogInstall,
  waitForRemoteMembership,
  waitForRemoteProject,
} from "./db";
import { BASE_URL, canSeed, e2eEnv, hasAdminAuth, statePath } from "./env";

/**
 * UI catalog e2e (plan 066 Task 5). Rule of engagement: every record carries
 * the `E2E ` marker (service-role sweeps catch leftovers) and is addressed BY
 * NAME, never by list position — sync pulls whatever the account owns.
 *
 * Screen-type assets have no production creator (the only caller is the
 * component-typed template seed), so the suite seeds the asset rows itself
 * and drives the REAL UI for install / update / fork / visibility.
 */

/** Mutating suites refuse to run when another run holds the lock. */
const skipMutating = process.env.E2E_SKIP_MUTATING === "1";

const picker = (page: Page) =>
  page.locator("[data-component-picker]").filter({ visible: true });

const panel = (page: Page) =>
  page.locator("[data-editor-panel]").filter({ visible: true });

/** A spec whose single Card title is the unique marker text. */
function cardSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

/** Mock-generate a screen that groups under a NEW project (064 seam). */
async function generateInProject(
  page: Page,
  projectName: string,
  prompt: string,
): Promise<string> {
  await mockGenerate(page);
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await createProject(page, projectName);
  await page.getByPlaceholder(UI.promptPlaceholder).fill(prompt);
  await page.getByRole(ROLE.button, { name: ACTIONS.generate }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await dismissUploadNudge(page);
  const projects = await readStoredProjects(page);
  const projectId = projects.find((row) => row.name === projectName)?.id;
  if (!projectId) throw new Error(`project not found locally: ${projectName}`);
  return projectId;
}

/** The `uis` id the current `/ui/{id}` URL names (post-navigation ground truth). */
function uiIdFromUrl(page: Page): string {
  const match = page.url().match(/\/ui\/([0-9a-f-]{36})$/);
  if (!match) throw new Error(`not on a ui route: ${page.url()}`);
  return match[1];
}

/** Select an element on the open screen and open the structure tab. */
async function openStructureTab(
  page: Page,
  elementText: string,
): Promise<void> {
  await page
    .getByRole(ROLE.button, { name: EDITOR.pick })
    .filter({ visible: true })
    .click();
  await page.getByText(elementText).filter({ visible: true }).first().click();
  await expect(panel(page)).toBeVisible();
  await panel(page)
    .getByRole(ROLE.tab, { name: EDITOR.structure })
    .filter({ visible: true })
    .click();
}

/** Structure tab → the Catalog button → the picker's catalog tab. */
async function openCatalogPicker(page: Page): Promise<void> {
  await panel(page)
    .getByRole(ROLE.button, { name: CATALOG.open })
    .filter({ visible: true })
    .click();
  await expect(picker(page)).toBeVisible();
}

/** The install/insert click target for one asset, addressed by name. */
function catalogRowOption(page: Page, name: string) {
  return page
    .locator("[data-catalog-row]")
    .filter({ hasText: name })
    .filter({ visible: true });
}

/** The FULL row: the option plus its action buttons (siblings of the
 *  option inside the `presentation` container), addressed by name. */
function catalogRow(page: Page, name: string) {
  return page
    .locator("div[role='presentation']")
    .filter({ has: catalogRowOption(page, name) })
    .filter({ visible: true });
}

test.describe("ui catalog (066)", () => {
  test.skip(
    !hasAdminAuth,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — catalog suites skip",
  );
  test.skip(
    skipMutating,
    "another e2e run holds the lock — refusing to run state-mutating suites",
  );
  test.skip(
    !canSeed,
    "SUPABASE_SERVICE_ROLE_KEY not set — catalog suites need seeded rows",
  );

  test("two projects install v1; a later v2 leaves both rendering v1", async ({
    page,
  }) => {
    // Two projects + installs + a publish + reloads exceed the 30s default.
    test.setTimeout(180_000);
    const suffix = randomUUID();
    const assetName = `E2E catalog screen ${suffix}`;
    const promptA = `E2E catalog host A ${suffix}`;
    const promptB = `E2E catalog host B ${suffix}`;
    const projectNameA = `E2E catalog project A ${suffix}`;
    const projectNameB = `E2E catalog project B ${suffix}`;
    const v1Title = `E2E catalog v1 ${suffix}`;
    const v2Title = `E2E catalog v2 ${suffix}`;
    let assetId: string | undefined;
    let v1VersionId: string | undefined;
    let projectIdA: string | undefined;
    let projectIdB: string | undefined;
    let installedA: string | undefined;
    let installedB: string | undefined;
    try {
      // The asset exists BEFORE the first page load so the session's initial
      // sync pull adopts it — no UI creates screen assets (Task 5 decision).
      const owner = await resolveUserByEmail(e2eEnv.adminEmail);
      expect(owner).not.toBeNull();
      const seeded = await seedCatalogAsset({
        ownerId: owner!.id,
        name: assetName,
        type: CATALOG_TYPES.screen,
        visibility: CATALOG_VISIBILITIES.public,
        spec: cardSpec(v1Title),
      });
      assetId = seeded.assetId;
      v1VersionId = seeded.versionId;

      // --- Project A installs v1 through the real catalog tab ---
      projectIdA = await generateInProject(page, projectNameA, promptA);
      // catalog_installs.project_id FKs to projects — the install push must
      // not race the project's own (debounced) push, or it is rejected.
      await waitForRemoteProject(projectNameA);
      const hostA = uiIdFromUrl(page);
      await openStructureTab(page, UI.mockHeading);
      await openCatalogPicker(page);
      const rowA = catalogRowOption(page, assetName);
      await expect(rowA).toBeVisible({ timeout: 30_000 });
      await rowA.click();
      // Only the installed copy renders v1 — that wait IS the navigation.
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible({ timeout: 15_000 });
      installedA = uiIdFromUrl(page);
      expect(installedA).not.toBe(hostA);
      expect(
        (await waitForRemoteCatalogInstall(assetId!, projectIdA!)).versionId,
      ).toBe(v1VersionId);

      // --- Project B installs v1 as well (a second, independent pin) ---
      projectIdB = await generateInProject(page, projectNameB, promptB);
      await waitForRemoteProject(projectNameB);
      const hostB = uiIdFromUrl(page);
      await openStructureTab(page, UI.mockHeading);
      await openCatalogPicker(page);
      const rowB = catalogRowOption(page, assetName);
      await expect(rowB).toBeVisible({ timeout: 30_000 });
      await rowB.click();
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible({ timeout: 15_000 });
      installedB = uiIdFromUrl(page);
      expect(installedB).not.toBe(hostB);
      expect(installedB).not.toBe(installedA);
      expect(
        (await waitForRemoteCatalogInstall(assetId!, projectIdB!)).versionId,
      ).toBe(v1VersionId);

      // --- The author publishes v2 (DB layer — no UI creates versions here) ---
      await publishSeededCatalogVersion(assetId!, cardSpec(v2Title));

      // B's copy is a SNAPSHOT — it never moved off v1 (decision 1)…
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();

      // …and neither did A's, reached by its own URL.
      await page.goto(`/ui/${installedA}`);
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();

      // Both account rows still pin v1 after the v2 bump.
      expect(
        (await waitForRemoteCatalogInstall(assetId!, projectIdA!)).versionId,
      ).toBe(v1VersionId);
      expect(
        (await waitForRemoteCatalogInstall(assetId!, projectIdB!)).versionId,
      ).toBe(v1VersionId);

      // A fresh pull offers the update on the row (v1 → v2 + Update action).
      await page.reload();
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();
      await openStructureTab(page, v1Title);
      await openCatalogPicker(page);
      const updatedRow = catalogRow(page, assetName);
      await expect(updatedRow).toBeVisible({ timeout: 30_000 });
      await expect(
        updatedRow.locator(`[title="${CATALOG.updateAvailable}"]`),
      ).toBeVisible();
      await expect(
        updatedRow.getByRole(ROLE.button, {
          name: CATALOG.update,
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await deleteSeededCatalogAsset(assetId);
      await deleteTestRow(installedA);
      await deleteTestRow(installedB);
      await deleteTestProject(projectIdA);
      await deleteTestProject(projectIdB);
    }
  });

  test("fork in project A leaves project B's install untouched", async ({
    page,
  }) => {
    // Two installs + an RPC fork + remote re-reads exceed the 30s default.
    test.setTimeout(180_000);
    const suffix = randomUUID();
    const assetName = `E2E catalog screen ${suffix}`;
    const promptA = `E2E fork host A ${suffix}`;
    const promptB = `E2E fork host B ${suffix}`;
    const projectNameA = `E2E fork project A ${suffix}`;
    const projectNameB = `E2E fork project B ${suffix}`;
    const v1Title = `E2E fork v1 ${suffix}`;
    let assetId: string | undefined;
    let v1VersionId: string | undefined;
    let projectIdA: string | undefined;
    let projectIdB: string | undefined;
    let installedA: string | undefined;
    let installedB: string | undefined;
    let forkUisId: string | undefined;
    try {
      const owner = await resolveUserByEmail(e2eEnv.adminEmail);
      expect(owner).not.toBeNull();
      const seeded = await seedCatalogAsset({
        ownerId: owner!.id,
        name: assetName,
        type: CATALOG_TYPES.screen,
        visibility: CATALOG_VISIBILITIES.public,
        spec: cardSpec(v1Title),
      });
      assetId = seeded.assetId;
      v1VersionId = seeded.versionId;

      // Both projects pin v1 of the SAME asset.
      projectIdA = await generateInProject(page, projectNameA, promptA);
      await waitForRemoteProject(projectNameA);
      await openStructureTab(page, UI.mockHeading);
      await openCatalogPicker(page);
      const rowA = catalogRowOption(page, assetName);
      await expect(rowA).toBeVisible({ timeout: 30_000 });
      await rowA.click();
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible({ timeout: 15_000 });
      installedA = uiIdFromUrl(page);
      expect(
        (await waitForRemoteCatalogInstall(assetId!, projectIdA!)).versionId,
      ).toBe(v1VersionId);

      projectIdB = await generateInProject(page, projectNameB, promptB);
      await waitForRemoteProject(projectNameB);
      await openStructureTab(page, UI.mockHeading);
      await openCatalogPicker(page);
      const rowB = catalogRowOption(page, assetName);
      await expect(rowB).toBeVisible({ timeout: 30_000 });
      await rowB.click();
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible({ timeout: 15_000 });
      installedB = uiIdFromUrl(page);
      const installB = await waitForRemoteCatalogInstall(assetId!, projectIdB!);
      expect(installB.versionId).toBe(v1VersionId);
      expect(installB.targetUiId).toBe(installedB);

      // --- Fork from A's context (the RPC swaps A's install only) ---
      await page.goto(`/ui/${installedA}`);
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();
      await openStructureTab(page, v1Title);
      await openCatalogPicker(page);
      const forkRow = catalogRow(page, assetName);
      await expect(forkRow).toBeVisible({ timeout: 30_000 });
      await forkRow
        .getByRole(ROLE.button, { name: CATALOG.forkEdit, exact: true })
        .click();
      // Fork navigates to the NEW working copy immediately (decision 4).
      const beforeFork = installedA;
      await page.waitForURL(
        (url) =>
          /\/ui\/[0-9a-f-]{36}$/.test(url.pathname) &&
          !url.pathname.endsWith(beforeFork),
      );
      forkUisId = uiIdFromUrl(page);
      expect(forkUisId).not.toBe(installedA);
      // The fork is a copy of the pinned v1 spec at revision 0.
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();

      // A's pin now targets the fork, still on v1.
      const installA = await waitForRemoteCatalogInstall(assetId!, projectIdA!);
      expect(installA.targetUiId).toBe(forkUisId);
      expect(installA.versionId).toBe(v1VersionId);

      // B's install is untouched: same target, same pinned version…
      const installBAgain = await waitForRemoteCatalogInstall(
        assetId!,
        projectIdB!,
      );
      expect(installBAgain.targetUiId).toBe(installedB);
      expect(installBAgain.versionId).toBe(v1VersionId);

      // …and its screen still renders v1.
      await page.goto(`/ui/${installedB}`);
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible();
      expect(uiIdFromUrl(page)).toBe(installedB);
    } finally {
      await deleteSeededCatalogAsset(assetId);
      await deleteTestRow(forkUisId);
      await deleteTestRow(installedA);
      await deleteTestRow(installedB);
      await deleteTestProject(projectIdA);
      await deleteTestProject(projectIdB);
    }
  });

  test("a foreign PRIVATE asset install is refused at RLS; PUBLIC lands", async ({
    request,
  }) => {
    // REST-level assertion of catalog_installs_insert_own (db/03_rls.sql):
    // the caller owns the project, the ASSET belongs to someone else — the
    // only variable between the control arm (PUBLIC lands) and the denial
    // (PRIVATE refused) is visibility, so a 42501 here is the policy and
    // not an FK or payload mistake.
    const suffix = randomUUID();
    const projectName = `E2E rls project ${suffix}`;
    const publicName = `E2E rls public ${suffix}`;
    const privateName = `E2E rls private ${suffix}`;
    let projectId: string | undefined;
    let publicAssetId: string | undefined;
    let privateAssetId: string | undefined;
    try {
      const caller = await resolveUserByEmail(e2eEnv.adminEmail);
      const foreign = await resolveUserByEmail(e2eEnv.fixtureEmail);
      expect(caller).not.toBeNull();
      expect(foreign).not.toBeNull();

      ({ projectId } = await seedOwnedProject({
        ownerId: caller!.id,
        name: projectName,
      }));
      const publicSeeded = await seedCatalogAsset({
        ownerId: foreign!.id,
        name: publicName,
        type: CATALOG_TYPES.screen,
        visibility: CATALOG_VISIBILITIES.public,
        spec: cardSpec(`E2E rls public title ${suffix}`),
      });
      publicAssetId = publicSeeded.assetId;
      const privateSeeded = await seedCatalogAsset({
        ownerId: foreign!.id,
        name: privateName,
        type: CATALOG_TYPES.screen,
        visibility: CATALOG_VISIBILITIES.private,
        spec: cardSpec(`E2E rls private title ${suffix}`),
      });
      privateAssetId = privateSeeded.assetId;

      // Caller's own session token — the policy keys off auth.uid(), so the
      // service role would bypass the very check under test.
      const tokenResponse = await request.post(
        `${e2eEnv.supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          headers: {
            apikey: e2eEnv.anonKey,
            "Content-Type": "application/json",
          },
          data: { email: e2eEnv.adminEmail, password: e2eEnv.adminPassword },
        },
      );
      expect(tokenResponse.ok()).toBeTruthy();
      const { access_token: accessToken } = (await tokenResponse.json()) as {
        access_token?: string;
      };
      expect(accessToken).toBeTruthy();

      const insertHeaders = {
        apikey: e2eEnv.anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
      const table = `${e2eEnv.supabaseUrl}/rest/v1/catalog_installs`;
      const rowFor = (assetId: string, versionId: string) => ({
        id: randomUUID(),
        owner_id: caller!.id,
        project_id: projectId!,
        asset_id: assetId,
        version_id: versionId,
      });

      // Control arm first: identical shape, foreign PUBLIC asset → lands.
      const control = await request.post(table, {
        headers: insertHeaders,
        data: rowFor(publicAssetId!, publicSeeded.versionId),
      });
      expect(control.status()).toBe(201);

      // Denial arm: only visibility changed → the WITH CHECK refuses.
      const denial = await request.post(table, {
        headers: insertHeaders,
        data: rowFor(privateAssetId!, privateSeeded.versionId),
      });
      expect(denial.status()).toBe(403);
      const body = (await denial.json()) as {
        code?: string;
        message?: string;
      };
      expect(body.code).toBe("42501");
      expect(body.message).toContain("row-level security");

      // No row landed for the private asset (the refusal was complete).
      const svc = serviceClient();
      const { data: leaked } = await svc
        .from("catalog_installs")
        .select("id")
        .eq("asset_id", privateAssetId!);
      expect(leaked ?? []).toEqual([]);
    } finally {
      // Deleting the asset cascades its versions AND installs (control row).
      await deleteSeededCatalogAsset(publicAssetId);
      await deleteSeededCatalogAsset(privateAssetId);
      await deleteTestProject(projectId);
    }
  });

  test("an install made on device A appears on device B (064 pattern)", async ({
    page,
    browser,
  }) => {
    // Device A installs, device B (fresh context, empty localStorage) must
    // receive BOTH the installed screen and the install row from the account
    // — a true server roundtrip, not a local echo (064 pattern, decision 9).
    test.setTimeout(180_000);
    const suffix = randomUUID();
    const assetName = `E2E xdevice screen ${suffix}`;
    const prompt = `E2E xdevice host ${suffix}`;
    const projectName = `E2E xdevice project ${suffix}`;
    const v1Title = `E2E xdevice v1 ${suffix}`;
    let assetId: string | undefined;
    let projectId: string | undefined;
    let installedA: string | undefined;
    try {
      const owner = await resolveUserByEmail(e2eEnv.adminEmail);
      expect(owner).not.toBeNull();
      const seeded = await seedCatalogAsset({
        ownerId: owner!.id,
        name: assetName,
        type: CATALOG_TYPES.screen,
        visibility: CATALOG_VISIBILITIES.public,
        spec: cardSpec(v1Title),
      });
      assetId = seeded.assetId;

      // --- Device A: project + install through the real catalog tab ---
      projectId = await generateInProject(page, projectName, prompt);
      await waitForRemoteProject(projectName);
      await openStructureTab(page, UI.mockHeading);
      await openCatalogPicker(page);
      const rowA = catalogRowOption(page, assetName);
      await expect(rowA).toBeVisible({ timeout: 30_000 });
      await rowA.click();
      await expect(
        page.getByText(v1Title).filter({ visible: true }),
      ).toBeVisible({ timeout: 15_000 });
      installedA = uiIdFromUrl(page);
      const install = await waitForRemoteCatalogInstall(assetId!, projectId!);
      expect(install.targetUiId).toBe(installedA);
      // The membership row groups the installed screen under the project on
      // DEVICE A — device B adopts that row and pointer-aligns from it, so
      // its push must land before B opens (otherwise B waits on a row that
      // does not exist yet).
      await waitForRemoteMembership(installedA);

      // --- Device B: fresh context, same account ---
      const fresh = await browser.newContext({
        baseURL: BASE_URL,
        storageState: statePath("admin.json"),
      });
      try {
        const freshPage = await fresh.newPage();
        // The installed screen itself rendered from the account rows…
        await freshPage.goto(`/ui/${installedA}`);
        await expect(
          freshPage.getByText(v1Title).filter({ visible: true }),
        ).toBeVisible({ timeout: 30_000 });

        // …and the install ROW pulled too: its picker action (bound to
        // install.targetUiId) only exists when the install is present.
        await openStructureTab(freshPage, v1Title);
        await openCatalogPicker(freshPage);
        const rowB = catalogRow(freshPage, assetName);
        await expect(rowB).toBeVisible({ timeout: 30_000 });
        // Install-bound action: only renders once the install row (with its
        // target) reached this device — the sync pull is the assertion.
        await expect(
          rowB.getByRole(ROLE.button, {
            name: CATALOG.publishUpdate,
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 });
      } finally {
        await fresh.close();
      }
    } finally {
      await deleteSeededCatalogAsset(assetId);
      await deleteTestRow(installedA);
      await deleteTestProject(projectId);
    }
  });

  test("the local template library migrates into catalog assets exactly once", async ({
    page,
  }) => {
    // Decision 5: a template's uuid BECOMES the asset id, so the migration
    // can never duplicate — proven here in the browser across all three
    // paths: first seed, marker-skipped reload, and a marker-CLEARED
    // re-seed (the id-keyed dedupe alone must hold).
    test.setTimeout(120_000);
    const suffix = randomUUID();
    const templateName = `E2E seed template ${suffix}`;
    const templateId = randomUUID();

    // The pre-catalog state a real user brings to their first signed-in
    // session: a populated LOCAL library, no seed marker. Installed before
    // any app script runs, so the module-level library read sees it.
    // The marker is REMOVED ONCE (first navigation only — init scripts run
    // before every load, and a per-load removal would skip the marker-path
    // assertion below): the shared storage state carries
    // `genui-catalog-seeded = 1` from an earlier session, which would
    // otherwise short-circuit the migration before it ever runs.
    await page.addInitScript(
      ({ key, markerKey, flagKey, value }) => {
        window.localStorage.setItem(key, value);
        if (window.sessionStorage.getItem(flagKey) === null) {
          window.localStorage.removeItem(markerKey);
          window.sessionStorage.setItem(flagKey, "1");
        }
      },
      {
        key: TEMPLATE_STORAGE_KEY,
        markerKey: CATALOG_SEEDED_STORAGE_KEY,
        flagKey: "e2e-seed-marker-cleared",
        value: JSON.stringify([
          {
            id: templateId,
            name: templateName,
            createdAt: Date.now(),
            subtree: {
              rootKey: "root",
              elements: { root: { type: "Card", props: { title: "seed" } } },
            },
          },
        ]),
      },
    );

    /** This template's own rows — never a global count (the account owns
     *  other assets from other runs; rows are addressed by id). */
    const readSeed = () =>
      page.evaluate(
        ({ catalogKey, markerKey, id }) => {
          const state = JSON.parse(
            localStorage.getItem(catalogKey) ?? "{}",
          ) as {
            assets?: Array<{ id: string; name: string }>;
            versions?: Array<{ assetId: string; version: number }>;
          };
          const assets = (state.assets ?? []).filter(
            (asset) => asset.id === id,
          );
          const versions = (state.versions ?? []).filter(
            (version) => version.assetId === id,
          );
          return {
            marker: localStorage.getItem(markerKey),
            assetCount: assets.length,
            name: assets[0]?.name ?? null,
            versionCount: versions.length,
            version: versions[0]?.version ?? null,
          };
        },
        {
          catalogKey: CATALOG_STORAGE_KEY,
          markerKey: CATALOG_SEEDED_STORAGE_KEY,
          id: templateId,
        },
      );

    try {
      await mockGenerate(page);
      await page.goto(PATHS.ui);
      await waitForMsw(page);

      // 1. Session start migrates the library: one asset (its own uuid) +
      //    one version, and the one-time marker is set.
      await expect
        .poll(async () => (await readSeed()).assetCount, { timeout: 30_000 })
        .toBe(1);
      let seed = await readSeed();
      expect(seed.marker).toBe("1");
      expect(seed.name).toBe(templateName);
      expect(seed.versionCount).toBe(1);
      expect(seed.version).toBe(1);

      // 2. Reload: the marker skips the seed — still exactly one row.
      await page.reload();
      await waitForMsw(page);
      await expect
        .poll(async () => (await readSeed()).marker, { timeout: 30_000 })
        .toBe("1");
      seed = await readSeed();
      expect(seed.assetCount).toBe(1);
      expect(seed.versionCount).toBe(1);

      // 3. Marker CLEARED → the migration runs AGAIN: only the id-keying
      //    stands between this and a duplicate row.
      await page.evaluate(
        (key) => localStorage.removeItem(key),
        CATALOG_SEEDED_STORAGE_KEY,
      );
      await page.reload();
      await waitForMsw(page);
      await expect
        .poll(async () => (await readSeed()).marker, { timeout: 30_000 })
        .toBe("1");
      seed = await readSeed();
      expect(seed.assetCount).toBe(1);
      expect(seed.versionCount).toBe(1);
    } finally {
      // The asset may have pushed to the account (ownerId "" is pushable);
      // the name-scoped sweep is the safety net if this races the debounce.
      await deleteSeededCatalogAsset(templateId);
    }
  });
});
