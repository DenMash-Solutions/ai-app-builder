"use client";

import { getByPath } from "@json-render/core";
import type { Spec, StateModel } from "@json-render/core";
import { useActions, useStateStore } from "@json-render/react";
import { useEffect } from "react";
import { adapterRegistry } from "@/lib/data-sources/adapter-registry";
import {
  queryManager,
  resolveRecordId,
} from "@/lib/data-sources/query-manager";
import {
  DATA_ERROR_CODES,
  DATA_MUTATE_ACTION,
  DATA_READ_ACTION,
  DataError,
  MUTATION_OPS,
  dataMutateParamsSchema,
  dataReadParamsSchema,
  hasDataBlocks,
  withDataBlocks,
} from "@/lib/data-sources/types";

/**
 * Data-source runtime (plan T6/T7): renders nothing but wires the spec's
 * data blocks into the provider it sits in — attaches the query manager
 * (reads → `/queries/<name>` mirrors, storage-event refresh) and
 * registers the `data_mutate` action at runtime (D2 rev 1.2: this app's
 * registry actions are inert; `registerHandler` is the provider-generic
 * registration path, same as auth/admin actions). Mounted once per
 * surface inside its `JSONUIProvider` (D8): playground, preview-client,
 * live-page, spec-page.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecordId = (
  id: unknown,
  getSnapshot: () => StateModel,
): string => {
  const recordId = resolveRecordId(id, getSnapshot());
  if (recordId === undefined) {
    throw new DataError(
      DATA_ERROR_CODES.notFound,
      'update/delete need a record id — bind params.id to {"$item": "id"} inside a repeat.',
    );
  }
  return recordId;
};

interface QueryLoaderProps {
  spec: Spec;
  /** Design scope for storage keys (D6): entry id / slug per surface. */
  namespace: string;
}

export function QueryLoader({ spec, namespace }: QueryLoaderProps) {
  // `set`/`getSnapshot` are stable useCallback identities on the provider —
  // safe as effect deps (the context VALUE changes with state, these don't).
  const { set, getSnapshot } = useStateStore();
  const { registerHandler } = useActions();

  useEffect(() => {
    if (!hasDataBlocks(spec)) return;
    const { dataSources, resources, queries } = withDataBlocks(spec);
    return queryManager.attach({
      namespace,
      dataSources: dataSources ?? {},
      resources: resources ?? {},
      queries: queries ?? {},
      write: (path, value) => set(path, value),
      // Paged params resolve here (052): {"$state": "/page"} on a query
      // def reads the provider's live state at run time.
      read: (path) => getByPath(getSnapshot(), path),
    });
  }, [spec, namespace, set, getSnapshot]);

  useEffect(() => {
    if (!hasDataBlocks(spec)) return;
    registerHandler(DATA_MUTATE_ACTION, async (params) => {
      const parsed = dataMutateParamsSchema.safeParse(params);
      if (!parsed.success) {
        console.warn(
          "[data-sources] data_mutate received invalid params",
          parsed.error.issues,
        );
        return;
      }
      const { op, resource: resourceName, input, id } = parsed.data;
      const config = queryManager.configFor(namespace);
      const resource = config?.resources[resourceName];
      if (!config || !resource) {
        console.warn(
          `[data-sources] data_mutate for undeclared resource "${resourceName}" (namespace "${namespace}")`,
        );
        return;
      }
      // Busy flag first: pending covers the adapter op AND the refresh
      // below (cleared in finally — action-loading-states plan).
      queryManager.setPending(namespace, resourceName, true);
      try {
        const dataSource = config.dataSources[resource.dataSource];
        if (!dataSource) {
          throw new DataError(
            DATA_ERROR_CODES.resourceNotFound,
            `Unknown dataSource "${resource.dataSource}" for resource "${resourceName}".`,
          );
        }
        const adapter = adapterRegistry.get(resource.dataSource, dataSource, {
          namespace,
        });
        await adapter.initialize();
        const namedResource = { ...resource, name: resourceName };
        if (op === MUTATION_OPS.create) {
          if (!isRecord(input)) {
            throw new DataError(
              DATA_ERROR_CODES.invalidRecord,
              'create needs an object input, e.g. {"title": "Buy milk"}.',
            );
          }
          await adapter.create(namedResource, input);
        } else if (op === MUTATION_OPS.update) {
          await adapter.update(
            namedResource,
            requireRecordId(id, getSnapshot),
            isRecord(input) ? input : {},
          );
        } else {
          await adapter.delete(namedResource, requireRecordId(id, getSnapshot));
        }
      } catch (error) {
        console.error("[data-sources] data_mutate failed:", error);
      }
      try {
        // Every component bound to this resource re-renders off the refreshed
        // mirror (D1) — also after a failed mutation, so the UI shows stored
        // truth rather than the optimistic input.
        await queryManager.refreshResource(namespace, resourceName);
      } finally {
        // Pending covers the write AND the refresh; cleared last so a failed
        // refresh can never leave the resource's mirrors stuck busy.
        queryManager.setPending(namespace, resourceName, false);
      }
    });
    // Server pagination (052, D2): re-run one declared query — the
    // watcher on a page-state path fires it; params resolve fresh, and a
    // read already in flight coalesces into one trailing run.
    registerHandler(DATA_READ_ACTION, async (params) => {
      const parsed = dataReadParamsSchema.safeParse(params);
      if (!parsed.success) {
        console.warn(
          "[data-sources] data_read received invalid params",
          parsed.error.issues,
        );
        return;
      }
      await queryManager.runQuery(namespace, parsed.data.query);
    });
  }, [registerHandler, namespace, getSnapshot, spec]);

  return null;
}
