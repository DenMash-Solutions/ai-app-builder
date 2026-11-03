/**
 * Public browse adoption (066 decision 11): the catalog tab's open runs a
 * public-assets query — RLS scopes it to own + public — and feeds FOREIGN
 * rows through the existing `applyRemote*` adoption path with their real
 * `ownerId` on the entity. From there the normal sync discipline owns them:
 * `SyncSpec.ownedBy` keeps them out of every push and delete, LWW governs
 * re-adoption, and installs of an adopted asset are ordinary local rows.
 *
 * Explicit column lists (the repo's no-`SELECT *` rule) — exactly the
 * columns the sync mappers read. The caller casts the Supabase client to
 * `SyncClient` at its integration point (the TS2589 adapter discipline).
 */
import {
  applyRemoteCatalogAsset,
  applyRemoteCatalogVersion,
  CATALOG_VISIBILITIES,
  getCatalogAssets,
  getCatalogVersions,
} from "@/lib/catalog/catalog";
import {
  rowToCatalogAsset,
  rowToCatalogVersion,
  type SyncClient,
} from "@/lib/history/sync";

/** Column lists live next to the mappers they feed — kept in step with
 *  `catalogAssetsSyncSpec.fullColumns` / `catalogVersionsSyncSpec.fullColumns`. */
const ASSET_COLUMNS =
  "id, owner_id, name, description, type, visibility, latest_version_id, created_at, updated_at";
const VERSION_COLUMNS =
  "id, owner_id, asset_id, version, spec, changelog, created_at, updated_at";

/**
 * One-shot adoption of every foreign public asset (and its versions)
 * visible to the session. Own rows are skipped — the sync loop owns those;
 * a local row that is already as new as the remote copy is skipped (the
 * pull's LWW discipline: browse must never clobber a fresher write).
 * Fire-and-forget: any query error just ends the adoption early with the
 * rows adopted so far (the tab renders from the store regardless).
 * Returns the number of rows adopted (0 = nothing new).
 */
export async function adoptPublicCatalog(
  client: SyncClient,
  userId: string,
): Promise<number> {
  const assets = await client
    .from("catalog_assets")
    .select(ASSET_COLUMNS)
    .eq("visibility", CATALOG_VISIBILITIES.public);
  if (assets.error) return 0;

  let adopted = 0;
  const foreignIds: string[] = [];
  for (const raw of assets.data ?? []) {
    const entity = rowToCatalogAsset(raw);
    if (!entity) continue; // corrupt/partial row — sanitized away
    if (entity.ownerId === "" || entity.ownerId === userId) continue; // ours
    foreignIds.push(entity.id);
    const local = getCatalogAssets().find((row) => row.id === entity.id);
    if (local && local.updatedAt >= entity.updatedAt) continue; // LWW
    applyRemoteCatalogAsset(entity);
    adopted += 1;
  }
  if (foreignIds.length === 0) return adopted;

  const versions = await client
    .from("catalog_asset_versions")
    .select(VERSION_COLUMNS)
    .in("asset_id", foreignIds);
  if (versions.error) return adopted;

  for (const raw of versions.data ?? []) {
    const entity = rowToCatalogVersion(raw);
    if (!entity) continue;
    if (entity.ownerId === "" || entity.ownerId === userId) continue;
    const local = getCatalogVersions().find((row) => row.id === entity.id);
    if (local && local.updatedAt >= entity.updatedAt) continue; // LWW
    applyRemoteCatalogVersion(entity);
    adopted += 1;
  }
  return adopted;
}
