"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  GitFork,
  Globe,
  Lock,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ComponentTemplate } from "@/lib/editor";
import type { PickerItem } from "@/lib/playground/catalog";
import {
  CATALOG_TYPES,
  CATALOG_VISIBILITIES,
  isSpecPayload,
  type CatalogAsset,
  type CatalogAssetVersion,
  type CatalogInstall,
  type CatalogVisibility,
} from "@/lib/catalog/catalog";
import { CatalogUpdateDialog } from "./catalog-update-dialog";

export const PICKER_MODES = {
  insert: "insert",
  group: "group",
  templates: "templates",
  catalog: "catalog",
} as const;

export type PickerMode = (typeof PICKER_MODES)[keyof typeof PICKER_MODES];

/** Filter modes as object constants (the no-string-literals rule) — the
 *  visibility scopes share their values with CATALOG_VISIBILITIES so the
 *  filter can never drift from the domain it filters on. */
const CATALOG_SCOPES = {
  all: "all",
  mine: "mine",
  public: CATALOG_VISIBILITIES.public,
  private: CATALOG_VISIBILITIES.private,
} as const;
type CatalogScope = (typeof CATALOG_SCOPES)[keyof typeof CATALOG_SCOPES];

const CATALOG_TYPE_FILTERS = {
  all: "all",
  screen: CATALOG_TYPES.screen,
  component: CATALOG_TYPES.component,
} as const;
type CatalogTypeFilter =
  (typeof CATALOG_TYPE_FILTERS)[keyof typeof CATALOG_TYPE_FILTERS];

interface ComponentPickerProps {
  mode: PickerMode;
  open: boolean;
  /** Injected by the caller so this component stays a pure catalog view. */
  items: PickerItem[];
  /** Templates mode only — the saved library to list (also injected). */
  templates?: ComponentTemplate[];
  /** Catalog mode only — the three store collections (also injected, the
   *  `templates` discipline). Rows derive from these + the context below. */
  catalogAssets?: CatalogAsset[];
  catalogVersions?: CatalogAssetVersion[];
  catalogInstalls?: CatalogInstall[];
  /** Active project — install rows and their status are scoped to it. */
  catalogProjectId?: string;
  /** Session user id — keys the "mine" filter and own-row actions; `""`
   *  when signed out (locally-created rows carry ownerId ""). */
  catalogOwnerId?: string;
  onOpenChange: (open: boolean) => void;
  onPick: (type: string) => void;
  /** Templates mode only — insert the picked template by id. */
  onPickTemplate?: (id: string) => void;
  /** Catalog components (plan 066): install + insert the picked asset's
   *  version. The catalog mode is its first caller. */
  onPickCatalogAsset?: (assetId: string, versionId: string) => void;
  /** Tab strip (decision 7): switch Templates ↔ Catalog in the same
   *  dialog without closing it. */
  onModeChange?: (mode: PickerMode) => void;
  /** Catalog screen row: install a fresh copy — the caller navigates to
   *  the new screen (Task 4). */
  onInstallCatalogScreen?: (assetId: string, versionId: string) => void;
  /** Catalog row fork/edit: the caller runs the RPC and navigates. */
  onForkCatalogAsset?: (assetId: string, versionId: string) => void;
  /** Own-row visibility toggle — flip only, installations never change. */
  onToggleCatalogVisibility?: (
    assetId: string,
    visibility: CatalogVisibility,
  ) => void;
  /** Confirmed update/rollback from the dialog — PROJECT-scoped: every copy of
   *  the asset in the active project moves (plan 071). */
  onUpdateCatalogInstalls?: (
    assetId: string,
    projectId: string,
    versionId: string,
  ) => void;
  /** Publish the working copy's current spec as the next version. */
  onPublishCatalogUpdate?: (installId: string) => void;
  /** Templates mode only — rename (trimmed, non-empty) / delete a row. */
  onRenameTemplate?: (id: string, name: string) => void;
  onDeleteTemplate?: (id: string) => void;
}

export function ComponentPicker({
  mode,
  open,
  items,
  templates = [],
  catalogAssets = [],
  catalogVersions = [],
  catalogInstalls = [],
  catalogProjectId = "",
  catalogOwnerId = "",
  onOpenChange,
  onPick,
  onPickTemplate,
  onPickCatalogAsset,
  onModeChange,
  onInstallCatalogScreen,
  onForkCatalogAsset,
  onToggleCatalogVisibility,
  onUpdateCatalogInstalls,
  onPublishCatalogUpdate,
  onRenameTemplate,
  onDeleteTemplate,
}: ComponentPickerProps) {
  const t = useTranslations();
  // The caller unmounts this dialog on close, so the query resets on reopen.
  const [query, setQuery] = useState("");
  // Inline rename (plan 060 step 3): draft wins over the stored name
  // (`draft ?? name`), Escape cancels without committing.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // Set on Escape so a follow-up blur (stale closure) cannot commit the draft.
  const skipBlurRef = useRef(false);
  // Catalog filters (Task 4) — reset with the rest on reopen.
  const [scope, setScope] = useState<CatalogScope>(CATALOG_SCOPES.all);
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>(
    CATALOG_TYPE_FILTERS.all,
  );
  // The ASSET whose confirmation dialog is open (null = closed): the dialog
  // speaks for every copy in the project (plan 071).
  const [updating, setUpdating] = useState<CatalogAsset | null>(null);

  const startRename = (template: ComponentTemplate) => {
    setRenamingId(template.id);
    setDraft(template.name);
    skipBlurRef.current = false;
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraft(null);
    skipBlurRef.current = false;
  };

  const commitRename = (template: ComponentTemplate) => {
    const next = (draft ?? template.name).trim();
    if (next !== "" && next !== template.name) {
      onRenameTemplate?.(template.id, next);
    }
    cancelRename();
  };

  const isTemplates = mode === PICKER_MODES.templates;
  const isCatalog = mode === PICKER_MODES.catalog;
  const needle = query.trim().toLowerCase();

  // Two typed rows — a single union array would defeat narrowing in render.
  const filteredItems = useMemo(() => {
    if (isTemplates || isCatalog) return [];
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle),
    );
  }, [isCatalog, isTemplates, items, needle]);

  const filteredTemplates = useMemo(() => {
    if (!isTemplates) return [];
    if (!needle) return templates;
    return templates.filter((template) =>
      template.name.toLowerCase().includes(needle),
    );
  }, [isTemplates, needle, templates]);

  /** Catalog rows: asset + its latest version + EVERY copy installed in the
   *  active project (the update is project-scoped, plan 071), filtered by
   *  search/scope/type. */
  const catalogRows = useMemo(() => {
    if (!isCatalog) return [];
    const versionsById = new Map(
      catalogVersions.map((version) => [version.id, version] as const),
    );
    return (
      catalogAssets
        .map((asset) => {
          const latest = asset.latestVersionId
            ? (versionsById.get(asset.latestVersionId) ?? null)
            : null;
          const installs =
            catalogProjectId === ""
              ? []
              : catalogInstalls.filter(
                  (row) =>
                    row.projectId === catalogProjectId &&
                    row.assetId === asset.id,
                );
          const pinnedVersions = installs
            .map((row) => versionsById.get(row.versionId)?.version ?? 0)
            .filter((version) => version > 0);
          return {
            asset,
            latest,
            installs,
            // The LOWEST pinned version is what an update moves away from.
            pinnedVersion:
              pinnedVersions.length > 0 ? Math.min(...pinnedVersions) : null,
            // A single up-to-date copy must not make a project with stale
            // ones look current.
            behind:
              latest !== null &&
              pinnedVersions.some((version) => version !== latest.version),
          };
        })
        .filter((row) => {
          // Plan 073: project templates are discovery-only — the picker stays
          // contextual (insert into THIS screen), so a manifest never lands
          // in an insert flow.
          if (row.asset.type === CATALOG_TYPES.project) return false;
          const mine =
            row.asset.ownerId === "" || row.asset.ownerId === catalogOwnerId;
          if (scope === CATALOG_SCOPES.mine && !mine) return false;
          if (
            scope === CATALOG_SCOPES.public &&
            row.asset.visibility !== CATALOG_VISIBILITIES.public
          ) {
            return false;
          }
          if (
            scope === CATALOG_SCOPES.private &&
            row.asset.visibility !== CATALOG_VISIBILITIES.private
          ) {
            return false;
          }
          if (
            typeFilter !== CATALOG_TYPE_FILTERS.all &&
            row.asset.type !== typeFilter
          ) {
            return false;
          }
          if (needle) {
            const haystack =
              `${row.asset.name} ${row.asset.description ?? ""}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          return true;
        })
        // Newest first — the browse's own ordering (updatedAt = publish).
        .sort((a, b) => b.asset.updatedAt - a.asset.updatedAt)
    );
  }, [
    isCatalog,
    catalogAssets,
    catalogVersions,
    catalogInstalls,
    catalogProjectId,
    catalogOwnerId,
    scope,
    typeFilter,
    needle,
  ]);

  const rowCount = isTemplates
    ? filteredTemplates.length
    : isCatalog
      ? catalogRows.length
      : filteredItems.length;

  const title = isTemplates
    ? t("editor.picker.templatesTitle")
    : isCatalog
      ? t("editor.picker.catalogTitle")
      : mode === PICKER_MODES.group
        ? t("editor.picker.groupTitle")
        : t("editor.picker.title");

  const description = isTemplates
    ? t("editor.picker.templatesDescription")
    : isCatalog
      ? t("editor.picker.catalogDescription")
      : t("editor.picker.description");

  const emptyHint = isTemplates
    ? templates.length === 0
      ? t("editor.picker.templatesEmpty")
      : t("editor.picker.noMatches")
    : isCatalog
      ? catalogAssets.length === 0
        ? t("editor.picker.catalogEmpty")
        : t("editor.picker.noMatches")
      : t("editor.picker.noMatches");

  const filterChipClass = (active: boolean) =>
    `rounded px-2 py-0.5 text-[10px] transition-colors ${
      active
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-accent/60"
    }`;

  const tabClass = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-accent/60"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-component-picker
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          // Radix listens for Escape CAPTURE-phase on document — before React's
          // input handler runs — so an inline rename can only be protected
          // here: block the dismiss while renaming (Radix honors
          // defaultPrevented). The input's own handler then clears the draft;
          // a second Escape (no rename active) closes the picker.
          if (renamingId !== null) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {(isTemplates || isCatalog) && (
          <div
            role="tablist"
            aria-label={t("editor.picker.tabsLabel")}
            className="flex gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isTemplates}
              data-templates-tab
              className={tabClass(isTemplates)}
              onClick={() => onModeChange?.(PICKER_MODES.templates)}
            >
              {t("editor.picker.tabTemplates")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isCatalog}
              data-catalog-tab
              className={tabClass(isCatalog)}
              onClick={() => onModeChange?.(PICKER_MODES.catalog)}
            >
              {t("editor.picker.tabCatalog")}
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isCatalog
                ? t("editor.picker.catalogSearch")
                : t("editor.picker.search")
            }
            aria-label={
              isCatalog
                ? t("editor.picker.catalogSearch")
                : t("editor.picker.search")
            }
            className="pl-8"
          />
        </div>

        {isCatalog && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div
              role="group"
              aria-label={t("editor.picker.scopeFilterLabel")}
              className="flex items-center gap-1"
            >
              <button
                type="button"
                aria-pressed={scope === CATALOG_SCOPES.all}
                className={filterChipClass(scope === CATALOG_SCOPES.all)}
                onClick={() => setScope(CATALOG_SCOPES.all)}
              >
                {t("editor.picker.scopeAll")}
              </button>
              <button
                type="button"
                aria-pressed={scope === CATALOG_SCOPES.mine}
                className={filterChipClass(scope === CATALOG_SCOPES.mine)}
                onClick={() => setScope(CATALOG_SCOPES.mine)}
              >
                {t("editor.picker.scopeMine")}
              </button>
              <button
                type="button"
                aria-pressed={scope === CATALOG_SCOPES.public}
                className={filterChipClass(scope === CATALOG_SCOPES.public)}
                onClick={() => setScope(CATALOG_SCOPES.public)}
              >
                {t("editor.picker.scopePublic")}
              </button>
              <button
                type="button"
                aria-pressed={scope === CATALOG_SCOPES.private}
                className={filterChipClass(scope === CATALOG_SCOPES.private)}
                onClick={() => setScope(CATALOG_SCOPES.private)}
              >
                {t("editor.picker.scopePrivate")}
              </button>
            </div>
            <span aria-hidden className="h-3 w-px bg-border" />
            <div
              role="group"
              aria-label={t("editor.picker.typeFilterLabel")}
              className="flex items-center gap-1"
            >
              <button
                type="button"
                aria-pressed={typeFilter === CATALOG_TYPE_FILTERS.all}
                className={filterChipClass(
                  typeFilter === CATALOG_TYPE_FILTERS.all,
                )}
                onClick={() => setTypeFilter(CATALOG_TYPE_FILTERS.all)}
              >
                {t("editor.picker.scopeAll")}
              </button>
              <button
                type="button"
                aria-pressed={typeFilter === CATALOG_TYPE_FILTERS.screen}
                className={filterChipClass(
                  typeFilter === CATALOG_TYPE_FILTERS.screen,
                )}
                onClick={() => setTypeFilter(CATALOG_TYPE_FILTERS.screen)}
              >
                {t("editor.picker.screensFilter")}
              </button>
              <button
                type="button"
                aria-pressed={typeFilter === CATALOG_TYPE_FILTERS.component}
                className={filterChipClass(
                  typeFilter === CATALOG_TYPE_FILTERS.component,
                )}
                onClick={() => setTypeFilter(CATALOG_TYPE_FILTERS.component)}
              >
                {t("editor.picker.componentsFilter")}
              </button>
            </div>
          </div>
        )}

        <div
          role="listbox"
          aria-label={title}
          className="max-h-72 overflow-y-auto rounded-md border"
        >
          {rowCount === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyHint}
            </p>
          )}
          {isCatalog &&
            catalogRows.map((row) => {
              const { asset, latest, installs, pinnedVersion, behind } = row;
              const mine =
                asset.ownerId === "" || asset.ownerId === catalogOwnerId;
              // Publishing reads ONE materialized copy; the first that still
              // has a host is the honest choice for "publish what shows".
              const publishable = installs.find((row) => row.targetUiId);
              return (
                <div
                  key={asset.id}
                  role="presentation"
                  className="flex items-center gap-1 pr-1"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    data-catalog-row
                    disabled={!latest}
                    onClick={() => {
                      if (!latest) return;
                      if (asset.type === CATALOG_TYPES.screen) {
                        onInstallCatalogScreen?.(asset.id, latest.id);
                      } else {
                        onPickCatalogAsset?.(asset.id, latest.id);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="truncate font-mono text-xs font-medium">
                      {asset.name}{" "}
                    </span>
                    {latest && (
                      <>
                        <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400">
                          {asset.type === CATALOG_TYPES.screen
                            ? t("editor.picker.typeScreen")
                            : t("editor.picker.typeComponent")}{" "}
                          ·{" "}
                          {t("editor.picker.templateCount", {
                            count: isSpecPayload(latest.spec)
                              ? Object.keys(latest.spec.elements).length
                              : 0,
                          })}
                        </span>
                        <span className="shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {t("editor.picker.versionChip", {
                            version: latest.version,
                          })}
                        </span>
                      </>
                    )}
                    <span
                      className="shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      title={mine ? undefined : asset.ownerId}
                      aria-label={
                        mine
                          ? undefined
                          : t("editor.picker.ownerLabel", { id: asset.ownerId })
                      }
                    >
                      {mine
                        ? t("editor.picker.ownerYou")
                        : asset.ownerId.slice(0, 8)}
                    </span>
                    {behind && pinnedVersion !== null && latest && (
                      <span
                        className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400"
                        title={t("editor.picker.updateAvailable")}
                      >
                        {t("editor.picker.versionChip", {
                          version: pinnedVersion,
                        })}{" "}
                        →{" "}
                        {t("editor.picker.versionChip", {
                          version: latest.version,
                        })}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label={t("editor.picker.forkEdit")}
                      title={t("editor.picker.forkEdit")}
                      disabled={!latest}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-40"
                      onClick={() => {
                        if (latest) {
                          onForkCatalogAsset?.(asset.id, latest.id);
                        }
                      }}
                    >
                      <GitFork className="h-3 w-3" />
                    </button>
                    {mine && (
                      <button
                        type="button"
                        aria-label={
                          asset.visibility === CATALOG_VISIBILITIES.public
                            ? t("editor.picker.makePrivate")
                            : t("editor.picker.makePublic")
                        }
                        title={
                          asset.visibility === CATALOG_VISIBILITIES.public
                            ? t("editor.picker.makePrivate")
                            : t("editor.picker.makePublic")
                        }
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        onClick={() =>
                          onToggleCatalogVisibility?.(
                            asset.id,
                            asset.visibility === CATALOG_VISIBILITIES.public
                              ? CATALOG_VISIBILITIES.private
                              : CATALOG_VISIBILITIES.public,
                          )
                        }
                      >
                        {asset.visibility === CATALOG_VISIBILITIES.public ? (
                          <Globe className="h-3 w-3" />
                        ) : (
                          <Lock className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    {mine && publishable && (
                      <button
                        type="button"
                        aria-label={t("editor.picker.publishUpdate")}
                        title={t("editor.picker.publishUpdate")}
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400"
                        onClick={() => onPublishCatalogUpdate?.(publishable.id)}
                      >
                        <Upload className="h-3 w-3" />
                      </button>
                    )}
                    {installs.length > 0 && behind && (
                      <button
                        type="button"
                        aria-label={t("editor.picker.update")}
                        title={t("editor.picker.update")}
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-amber-400"
                        onClick={() => setUpdating(asset)}
                      >
                        <ArrowUpCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          {!isCatalog &&
            (isTemplates
              ? filteredTemplates.map((template) => {
                  const renaming = renamingId === template.id;
                  return (
                    <div
                      key={template.id}
                      role="presentation"
                      className="flex items-center gap-1 pr-1"
                    >
                      {renaming ? (
                        <Input
                          autoFocus
                          data-template-rename-input
                          value={draft ?? template.name}
                          aria-label={t("editor.picker.renameTemplate")}
                          className="h-8 flex-1 border-0 bg-accent px-3 font-mono text-xs focus-visible:ring-1"
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(template);
                            if (event.key === "Escape") {
                              // Cancel the rename ONLY — the dialog's own Escape
                              // handling was already blocked above, so the picker
                              // stays open.
                              skipBlurRef.current = true;
                              cancelRename();
                            }
                          }}
                          onBlur={() => {
                            if (skipBlurRef.current) {
                              skipBlurRef.current = false;
                              return;
                            }
                            commitRename(template);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => onPickTemplate?.(template.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <span className="truncate font-mono text-xs font-medium">
                            {template.name}{" "}
                          </span>
                          <span className="ml-auto shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {t("editor.picker.templateCount", {
                              count: Object.keys(template.subtree.elements)
                                .length,
                            })}
                          </span>
                        </button>
                      )}
                      {!renaming && (
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            aria-label={t("editor.picker.renameTemplate")}
                            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                            onClick={() => startRename(template)}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={t("editor.picker.deleteTemplate")}
                            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                            onClick={() => onDeleteTemplate?.(template.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              : filteredItems.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => onPick(item.name)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    {/* Trailing space keeps text runs word-separated for assistive
                        tech and text-based matchers; trimmed visually at the line
                        end, so layout is unaffected. */}
                    <span className="font-mono text-xs font-medium">
                      {item.name}{" "}
                    </span>
                    {item.container && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        {t("editor.picker.containerChip")}
                      </span>
                    )}
                    {item.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </button>
                )))}
        </div>

        {updating && (
          <CatalogUpdateDialog
            open
            asset={updating}
            installs={catalogInstalls.filter(
              (row) =>
                row.projectId === catalogProjectId &&
                row.assetId === updating.id,
            )}
            versions={catalogVersions.filter(
              (version) => version.assetId === updating.id,
            )}
            onOpenChange={(open) => {
              if (!open) setUpdating(null);
            }}
            onConfirm={(versionId) => {
              onUpdateCatalogInstalls?.(
                updating.id,
                catalogProjectId,
                versionId,
              );
              setUpdating(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
