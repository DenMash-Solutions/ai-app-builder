import type {
  AdapterContext,
  AdapterFactory,
  DataSourceAdapter,
} from "./adapter";
import { createLocalStorageAdapter } from "./local-storage-adapter";
import { DATA_SOURCE_PROVIDERS, DATA_ERROR_CODES, DataError } from "./types";
import type { DataSourceDef, DataSourceProvider } from "./types";

/**
 * Adapter registry (plan T4): a per-document singleton mapping provider
 * names to factories, with one adapter instance per
 * `(dataSource name, namespace)` pair — instances are disposed when their
 * namespace detaches (entry switched, surface unmounted). Factories are
 * injectable so tests register fakes without a DOM.
 */

const FACTORIES: Record<DataSourceProvider, AdapterFactory> = {
  [DATA_SOURCE_PROVIDERS.localStorage]: createLocalStorageAdapter,
};

export class AdapterRegistry {
  private readonly factories: Partial<Record<string, AdapterFactory>>;
  private readonly instances = new Map<string, DataSourceAdapter>();

  constructor(factories: Partial<Record<string, AdapterFactory>> = FACTORIES) {
    this.factories = factories;
  }

  /** The (cached) adapter for one data source inside one namespace. */
  get(
    name: string,
    def: DataSourceDef,
    context: AdapterContext,
  ): DataSourceAdapter {
    const key = `${name}::${context.namespace}`;
    const cached = this.instances.get(key);
    if (cached) return cached;
    const factory = this.factories[def.provider];
    if (!factory) {
      throw new DataError(
        DATA_ERROR_CODES.unknownProvider,
        `No adapter for provider "${def.provider}" (data source "${name}").`,
      );
    }
    const adapter = factory(def, context);
    this.instances.set(key, adapter);
    return adapter;
  }

  /** Dispose and forget every adapter of one namespace (D6). */
  disposeNamespace(namespace: string): void {
    for (const [key, adapter] of this.instances) {
      if (!key.endsWith(`::${namespace}`)) continue;
      this.instances.delete(key);
      void adapter.dispose();
    }
  }

  /** Test/diagnostic hook: currently cached instance count. */
  get size(): number {
    return this.instances.size;
  }
}

/** The app's per-document singleton registry. */
export const adapterRegistry = new AdapterRegistry();
