/**
 * Applies the first-party ecommerce template seed (plan 073, P5) through the
 * service role. The rows come from the same builder that generates
 * `db/07_project_templates.sql`, so the two can never disagree; this script
 * exists for the SQL-editor-free path (crash-safe, re-runnable, no huge query
 * payload). Inserts are `ignore duplicates`, so a second run is a no-op.
 *
 * Run: `bun run seed:templates:apply`
 */
import { resolveUserByEmail, serviceClient } from "../e2e/db";
import { e2eEnv } from "../e2e/env";
import { ecommerceTemplateSeed } from "../demo/ecommerce/load-template";

type AssetRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: string;
  visibility: string;
  latest_version_id: string;
};

type VersionRow = {
  id: string;
  asset_id: string;
  owner_id: string;
  version: number;
  spec: unknown;
  changelog: string | null;
};

async function main(): Promise<void> {
  const email = e2eEnv.adminEmail;
  if (email === "") {
    throw new Error(
      "E2E_ADMIN_EMAIL is not set — the seed rows need the admin owner",
    );
  }
  const owner = await resolveUserByEmail(email);
  if (!owner) throw new Error(`no auth user for ${email}`);

  const seed = ecommerceTemplateSeed();
  const svc = serviceClient();

  const assets: AssetRow[] = [
    {
      id: seed.asset.id,
      owner_id: owner.id,
      name: seed.asset.name,
      description: seed.asset.description,
      type: seed.asset.type,
      visibility: seed.asset.visibility,
      latest_version_id: seed.version.id,
    },
    ...seed.components.map((component) => ({
      id: component.id,
      owner_id: owner.id,
      name: component.name,
      description: component.description,
      type: "component",
      visibility: "public",
      latest_version_id: component.versionId,
    })),
  ];

  const versions: VersionRow[] = [
    {
      id: seed.version.id,
      asset_id: seed.asset.id,
      owner_id: owner.id,
      version: 1,
      spec: seed.version.spec,
      changelog: null,
    },
    ...seed.components.map((component) => ({
      id: component.versionId,
      asset_id: component.id,
      owner_id: owner.id,
      version: 1,
      spec: component.spec,
      changelog: null,
    })),
  ];

  const assetWrite = await svc
    .from("catalog_assets")
    .upsert(assets, { onConflict: "id", ignoreDuplicates: true });
  if (assetWrite.error) {
    throw new Error(`catalog_assets seed failed: ${assetWrite.error.message}`);
  }
  const versionWrite = await svc
    .from("catalog_asset_versions")
    .upsert(versions, { onConflict: "id", ignoreDuplicates: true });
  if (versionWrite.error) {
    throw new Error(
      `catalog_asset_versions seed failed: ${versionWrite.error.message}`,
    );
  }

  const ids = assets.map((row) => row.id);
  const check = await svc
    .from("catalog_assets")
    .select("id, name, type, visibility, latest_version_id")
    .in("id", ids);
  if (check.error)
    throw new Error(`verification failed: ${check.error.message}`);

  const template = (check.data ?? []).find((row) => row.id === seed.asset.id);
  console.log(
    `[seed] ${check.data?.length ?? 0}/${assets.length} asset rows present — ` +
      `template latest_version_id ${
        template?.latest_version_id === seed.version.id ? "ok" : "MISMATCH"
      }`,
  );

  const versionCount = await svc
    .from("catalog_asset_versions")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      versions.map((row) => row.id),
    );
  if (versionCount.error) {
    throw new Error(`version count failed: ${versionCount.error.message}`);
  }
  console.log(
    `[seed] ${versionCount.count ?? 0}/${versions.length} version rows present`,
  );
}

await main();
