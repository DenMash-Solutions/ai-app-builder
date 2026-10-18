import type { AdapterContext, DataSourceAdapter } from "./adapter";
import type { AdapterCapabilities } from "./adapter";
import {
  DATA_SOURCE_PROVIDERS,
  DATA_ERROR_CODES,
  DataError,
  dataStorageKey,
} from "./types";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * Milestone 1 adapter (plan T5): the visitor's own browser storage, keyed
 * `{prefix}:{namespace}:{collection}` (D6). Each resource is one JSON
 * array of records; `id` (or the resource's `primaryKey`) identifies a
 * record. Reads of a missing key are an empty list, not an error —
 * "nothing saved yet" is the normal first visit; malformed JSON IS an
 * error (the error branch the UI can surface). The `Storage` handle is
 * injectable so tests never need a DOM.
 */

const CAPABILITIES: AdapterCapabilities = {
  list: true,
  get: true,
  create: true,
  update: true,
  delete: true,
};

interface LocalStorageConfig {
  storageKeyPrefix?: string;
}

const resolveCollection = (resource: NamedResourceDef): string =>
  resource.collection ?? resource.name;

const resolvePrimaryKey = (resource: NamedResourceDef): string =>
  resource.primaryKey ?? "id";

/** `undefined` until initialized — guards against use-before-initialize. */
type StorageHandle = Storage | null | undefined;

/**
 * Throws when a record misses a schema-declared field or types it wrongly
 * (D3: schema is validated before any write).
 */
function validateRecord(
  resource: NamedResourceDef,
  record: Record<string, unknown>,
): void {
  if (!resource.schema) return;
  for (const [field, expected] of Object.entries(resource.schema)) {
    const value = record[field];
    if (value === undefined) {
      throw new DataError(
        DATA_ERROR_CODES.invalidRecord,
        `Record is missing schema field "${field}" (expected ${expected}).`,
      );
    }
    if (typeof value !== expected) {
      throw new DataError(
        DATA_ERROR_CODES.invalidRecord,
        `Record field "${field}" must be ${expected}, got ${typeof value}.`,
      );
    }
  }
}

export function createLocalStorageAdapter(
  def: DataSourceDef,
  context: AdapterContext,
  resolveStorage: () => Storage | null = () =>
    typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage,
): DataSourceAdapter {
  const config = (def.config ?? {}) as LocalStorageConfig;
  const keyFor = (resource: NamedResourceDef): string => {
    const collection = resolveCollection(resource);
    return config.storageKeyPrefix
      ? `${config.storageKeyPrefix}:${context.namespace}:${collection}`
      : dataStorageKey(context.namespace, collection);
  };

  let storage: StorageHandle;

  const requireStorage = (): Storage => {
    if (storage === undefined) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        "localStorage is not available in this environment.",
      );
    }
    if (storage === null) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        "localStorage was blocked or is unavailable in this browser.",
      );
    }
    return storage;
  };

  const readAll = (resource: NamedResourceDef): Record<string, unknown>[] => {
    const store = requireStorage();
    const raw = store.getItem(keyFor(resource));
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DataError(
        DATA_ERROR_CODES.malformed,
        `Stored data at "${keyFor(resource)}" is not valid JSON.`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new DataError(
        DATA_ERROR_CODES.malformed,
        `Stored data at "${keyFor(resource)}" is not an array of records.`,
      );
    }
    return parsed as Record<string, unknown>[];
  };

  const writeAll = (
    resource: NamedResourceDef,
    records: Record<string, unknown>[],
  ): void => {
    const store = requireStorage();
    store.setItem(keyFor(resource), JSON.stringify(records));
  };

  const findById = (
    records: Record<string, unknown>[],
    resource: NamedResourceDef,
    id: string,
  ): Record<string, unknown> | undefined => {
    const key = resolvePrimaryKey(resource);
    return records.find((record) => record[key] === id);
  };

  return {
    provider: DATA_SOURCE_PROVIDERS.localStorage,
    capabilities: CAPABILITIES,

    async initialize(): Promise<void> {
      if (storage === undefined) storage = resolveStorage();
    },

    async list(resource: NamedResourceDef): Promise<Record<string, unknown>[]> {
      return readAll(resource);
    },

    async get(
      resource: NamedResourceDef,
      id: string,
    ): Promise<Record<string, unknown> | null> {
      return findById(readAll(resource), resource, id) ?? null;
    },

    async create(
      resource: NamedResourceDef,
      input: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const record = {
        ...input,
        [resolvePrimaryKey(resource)]: crypto.randomUUID(),
      };
      validateRecord(resource, record);
      const records = readAll(resource);
      writeAll(resource, [...records, record]);
      return record;
    },

    async update(
      resource: NamedResourceDef,
      id: string,
      patch: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const records = readAll(resource);
      const index = records.findIndex(
        (record) => record[resolvePrimaryKey(resource)] === id,
      );
      if (index < 0) {
        throw new DataError(
          DATA_ERROR_CODES.notFound,
          `No record with id "${id}" in resource "${resource.name}".`,
        );
      }
      const merged = { ...records[index], ...patch };
      validateRecord(resource, merged);
      writeAll(resource, [
        ...records.slice(0, index),
        merged,
        ...records.slice(index + 1),
      ]);
      return merged;
    },

    async delete(resource: NamedResourceDef, id: string): Promise<void> {
      const records = readAll(resource);
      const next = records.filter(
        (record) => record[resolvePrimaryKey(resource)] !== id,
      );
      if (next.length === records.length) {
        throw new DataError(
          DATA_ERROR_CODES.notFound,
          `No record with id "${id}" in resource "${resource.name}".`,
        );
      }
      writeAll(resource, next);
    },

    async dispose(): Promise<void> {
      storage = null;
    },
  };
}
