/**
 * Generates `db/07_project_templates.sql` from the committed ecommerce demo
 * (plan 073, decision 4: seeding happens at the DB layer — browse reads
 * `catalog_assets` directly, and `owner_id` is per-user, so client-side
 * fixed-id seeding would collide across accounts).
 *
 * Run: `bun run seed:templates` — then apply the file with the Supabase SQL
 * editor or MCP. Output is idempotent (`on conflict do nothing`) and skips
 * every row when the admin account does not exist yet.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isProjectManifest } from "@/lib/catalog/manifest";
import { ecommerceTemplateSeed } from "@/demo/ecommerce/load-template";

/** Owner of the seeded rows — the promoted e2e admin account. */
const OWNER_EMAIL = "admin@e2e.com";
const OUTPUT = resolve(import.meta.dir, "../db/07_project_templates.sql");
const DOLLAR_TAG = "$seed$";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function ownerSelect(): string {
  return `from (select id from auth.users where email = ${sqlString(OWNER_EMAIL)}) as owner`;
}

function assetInsert(row: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  visibility: string;
  latestVersionId: string;
}): string {
  return [
    "insert into public.catalog_assets",
    "  (id, owner_id, name, description, type, visibility, latest_version_id)",
    "select",
    `  ${sqlString(row.id)}, owner.id, ${sqlString(row.name)},`,
    `  ${row.description === null ? "null" : sqlString(row.description)},`,
    `  ${sqlString(row.type)}, ${sqlString(row.visibility)},`,
    `  ${sqlString(row.latestVersionId)}`,
    ownerSelect(),
    "on conflict (id) do nothing;",
  ].join("\n");
}

function versionInsert(row: {
  id: string;
  assetId: string;
  version: number;
  spec: unknown;
  changelog: string | null;
}): string {
  const json = JSON.stringify(row.spec);
  return [
    "insert into public.catalog_asset_versions",
    "  (id, asset_id, owner_id, version, spec, changelog)",
    "select",
    `  ${sqlString(row.id)}, ${sqlString(row.assetId)}, owner.id, ${row.version},`,
    `  ${DOLLAR_TAG}${json}${DOLLAR_TAG}::jsonb,`,
    `  ${row.changelog === null ? "null" : sqlString(row.changelog)}`,
    ownerSelect(),
    "on conflict (id) do nothing;",
  ].join("\n");
}

function main(): void {
  const seed = ecommerceTemplateSeed();
  if (!isProjectManifest(seed.version.spec)) {
    throw new Error("generated manifest failed isProjectManifest");
  }

  const statements: string[] = [
    assetInsert({ ...seed.asset, latestVersionId: seed.version.id }),
  ];
  statements.push(
    versionInsert({
      id: seed.version.id,
      assetId: seed.asset.id,
      version: 1,
      spec: seed.version.spec,
      changelog: null,
    }),
  );

  // Component assets first in their own block, then the template — the order
  // only matters for readability (no cross-row FK on latest_version_id).
  for (const component of seed.components) {
    statements.push(
      assetInsert({
        id: component.id,
        name: component.name,
        description: component.description,
        type: "component",
        visibility: "public",
        latestVersionId: component.versionId,
      }),
    );
    statements.push(
      versionInsert({
        id: component.versionId,
        assetId: component.id,
        version: 1,
        spec: component.spec,
        changelog: null,
      }),
    );
  }

  const header = [
    "-- First-party project template (plan 073) — GENERATED, do not edit.",
    "-- Regenerate: bun run seed:templates (scripts/generate-template-seed.ts).",
    `-- ${seed.asset.name}: ${seed.version.spec.screens.length} screens,`,
    `-- ${seed.components.length} components. Owner: ${OWNER_EMAIL}.`,
    "-- Re-runnable: every insert is `on conflict do nothing` and is skipped",
    "-- entirely when the owner account does not exist.",
    "",
    "begin;",
    "",
  ].join("\n");

  writeFileSync(
    OUTPUT,
    `${header}${statements.join("\n\n")}\n\ncommit;\n`,
    "utf8",
  );
  console.log(
    `[seed] wrote ${OUTPUT} — 1 template, ${seed.components.length} components, ` +
      `${seed.version.spec.screens.length} screens`,
  );
}

main();
