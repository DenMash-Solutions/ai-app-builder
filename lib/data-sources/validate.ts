import type { Spec } from "@json-render/core";
import { checkApiAuth } from "./api-auth";
import { checkApiBaseUrl } from "./api-url";
import {
  API_CONFIG_KEYS,
  CREDENTIAL_CONFIG_KEYS,
  DATA_SOURCE_PROVIDERS,
  dataSourceDefSchema,
  queryDefSchema,
  resourceDefSchema,
  withDataBlocks,
} from "./types";

/**
 * Data-source validation (plan D3): runs at the three write seams —
 * generate completion, JSON import (`parseSpecJson`), and publish — so a
 * spec with dangling references, an unsupported provider, or
 * credential-shaped config never becomes an entry/revision. Diagnostics
 * are developer-facing English (surfaced as the toast/dialog description
 * under one friendly i18n headline); the schemas double as prompt
 * documentation via their `.describe()` text.
 */

/** One actionable problem, addressed by its spec path. */
export interface DataSourceIssue {
  path: string;
  message: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates the three top-level blocks of `spec`. Returns an empty array
 * when the spec declares no data blocks at all (the common case) or when
 * every block parses and all references resolve.
 */
export function validateDataSources(spec: Spec): DataSourceIssue[] {
  const { dataSources, resources, queries } = withDataBlocks(spec);
  const issues: DataSourceIssue[] = [];

  // --- dataSources: shape + credential-shaped config keys (D3) -----------
  const dataSourceNames = new Set<string>();
  if (dataSources !== undefined) {
    if (!isPlainObject(dataSources)) {
      issues.push({
        path: "dataSources",
        message:
          '"dataSources" must be an object mapping names to { provider, config } definitions.',
      });
    } else {
      for (const [name, def] of Object.entries(dataSources)) {
        const path = `dataSources.${name}`;
        const parsed = dataSourceDefSchema.safeParse(def);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              path: `${path}.${issue.path.join(".")}`,
              message: issue.message,
            });
          }
          continue;
        }
        dataSourceNames.add(name);
        const config = parsed.data.config ?? {};
        for (const key of Object.keys(config)) {
          if (
            CREDENTIAL_CONFIG_KEYS.includes(
              key.toLowerCase() as (typeof CREDENTIAL_CONFIG_KEYS)[number],
            )
          ) {
            issues.push({
              path: `${path}.config.${key}`,
              message: `"${key}" looks like a credential — specs never carry secrets; remove it (the visiting browser is the only "auth" a client-side provider needs).`,
            });
          }
        }
        // Per-provider config policy (M2 plan T4): the supabase provider is
        // fully app-configured — project URL and keys come from the app's
        // environment and rows are scoped by RLS — so any spec-level config
        // field is either a mistake or an attempt to smuggle credentials in.
        if (
          parsed.data.provider === DATA_SOURCE_PROVIDERS.supabase &&
          Object.keys(config).length > 0
        ) {
          issues.push({
            path: `${path}.config`,
            message:
              'The "supabase" provider takes no config — omit "config" (project URL and keys come from the app environment); rows are scoped to the signed-in visitor by RLS.',
          });
        }
        // Per-provider config policy (api-data-source plan D2, extended by
        // keyed-api-lane plan 050): the api provider accepts the validated
        // endpoint, the optional itemsPath pointer, and the shape-only
        // `auth` ref — headers and query values stay impossible, and key
        // VALUES are rejected by construction (auth carries only
        // type/ref/header; anything else fails checkApiAuth).
        if (parsed.data.provider === DATA_SOURCE_PROVIDERS.api) {
          const allowed = (API_CONFIG_KEYS as readonly string[])
            .map((key) => `"${key}"`)
            .join(", ");
          for (const key of Object.keys(config)) {
            if (!(API_CONFIG_KEYS as readonly string[]).includes(key)) {
              issues.push({
                path: `${path}.config.${key}`,
                message: `The "api" provider takes only ${allowed} — remove "${key}".`,
              });
            }
          }
          const baseUrlProblem = checkApiBaseUrl(config.baseUrl);
          if (baseUrlProblem) {
            issues.push({
              path: `${path}.config.baseUrl`,
              message: baseUrlProblem,
            });
          }
          const { itemsPath } = config;
          if (
            itemsPath !== undefined &&
            (typeof itemsPath !== "string" || !itemsPath.startsWith("/"))
          ) {
            issues.push({
              path: `${path}.config.itemsPath`,
              message:
                '"itemsPath" must be a JSON pointer into the response, e.g. "/data".',
            });
          }
          if (config.auth !== undefined) {
            const authProblem = checkApiAuth(config.auth);
            if (authProblem) {
              issues.push({
                path: `${path}.config.auth`,
                message: authProblem,
              });
            }
          }
        }
      }
    }
  }

  // --- resources: shape + dataSource references --------------------------
  const resourceNames = new Set<string>();
  if (resources !== undefined) {
    if (!isPlainObject(resources)) {
      issues.push({
        path: "resources",
        message:
          '"resources" must be an object mapping names to { dataSource, collection?, schema? } definitions.',
      });
    } else {
      for (const [name, def] of Object.entries(resources)) {
        const path = `resources.${name}`;
        const parsed = resourceDefSchema.safeParse(def);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              path: `${path}.${issue.path.join(".")}`,
              message: issue.message,
            });
          }
          continue;
        }
        resourceNames.add(name);
        if (!dataSourceNames.has(parsed.data.dataSource)) {
          issues.push({
            path: `${path}.dataSource`,
            message: `Unknown dataSource "${parsed.data.dataSource}" — declare it under "dataSources" (declared: ${
              dataSourceNames.size > 0
                ? [...dataSourceNames].map((n) => `"${n}"`).join(", ")
                : "none"
            }).`,
          });
        }
      }
    }
  }

  // --- queries: shape + resource references ------------------------------
  if (queries !== undefined) {
    if (!isPlainObject(queries)) {
      issues.push({
        path: "queries",
        message:
          '"queries" must be an object mapping names to { resource, operation?, params? } definitions.',
      });
    } else {
      for (const [name, def] of Object.entries(queries)) {
        const path = `queries.${name}`;
        const parsed = queryDefSchema.safeParse(def);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              path: `${path}.${issue.path.join(".")}`,
              message: issue.message,
            });
          }
          continue;
        }
        if (!resourceNames.has(parsed.data.resource)) {
          issues.push({
            path: `${path}.resource`,
            message: `Unknown resource "${parsed.data.resource}" — declare it under "resources" (declared: ${
              resourceNames.size > 0
                ? [...resourceNames].map((n) => `"${n}"`).join(", ")
                : "none"
            }).`,
          });
        }
      }
    }
  }

  return issues;
}

/** Human-readable one-liner for failure surfaces (first issue + count). */
export function describeDataIssues(issues: DataSourceIssue[]): string {
  const first = issues[0];
  if (!first) return "";
  const more = issues.length - 1;
  return more > 0
    ? `${first.path}: ${first.message} (+${more} more issue${more > 1 ? "s" : ""})`
    : `${first.path}: ${first.message}`;
}
