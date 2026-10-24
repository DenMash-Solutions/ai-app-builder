/**
 * DATA_SOURCE_RULES (plan 053) — the prompt section that teaches the three
 * top-level data blocks (`dataSources` / `resources` / `queries`).
 *
 * The block shapes were taught only by STYLING_RULES' pre-050 paragraph,
 * which contradicted 050/051/052 ("authenticated APIs are unsupported"); the
 * keyed `auth` shape appeared nowhere, so generations improvised and dropped
 * `auth` (direct fetch → 401), wrote bare pointers, parked `params`/
 * `pagination` on `repeat` (inert), and seeded 1-based page state. Field
 * descriptions are DERIVED from the zod schemas in lib/data-sources/types.ts
 * — the same `.describe()` strings validation diagnostics quote, so prompt
 * and runtime cannot drift (D1). The placement / pointer / page-convention
 * / schema-semantics rules are literals because no schema field owns them.
 *
 * Every worked example is GENERIC (plan 053 D7): no deployment-specific
 * hosts, refs, or domain names — a prompt that leaks the test target's
 * shapes would make generation verification circular ("cheating"), and
 * every unrelated generation shares this system prompt.
 */
import {
  dataSourceDefSchema,
  queryDefSchema,
  resourceDefSchema,
} from "@/lib/data-sources/types";

type Documented = { description?: string | undefined };

/** The zod `.describe()` text of a field. */
const doc = (field: Documented): string => field.description ?? "";

const dataSourceFields = dataSourceDefSchema.shape;
const resourceFields = resourceDefSchema.shape;
const queryFields = queryDefSchema.shape;
// paginationSchema.optional() wraps the object — unwrap for inner fields.
const paginationObject = ((
  queryFields.pagination as unknown as { def?: { innerType?: unknown } }
)?.def?.innerType ?? queryFields.pagination) as {
  shape: Record<string, Documented>;
};
const paginationFields = paginationObject.shape;

export const DATA_SOURCE_RULES = `
DATA SOURCES — declare data in three TOP-LEVEL spec blocks:

"dataSources": { "apiSource": { "provider": "api", "config": { "baseUrl": "https://api.example.com", "itemsPath": "/data", "itemDetail": { "path": "/records/{id}" }, "auth": { "type": "bearer", "ref": "<key-name>" } } } }
- provider: ${doc(dataSourceFields.provider)}
- config: ${doc(dataSourceFields.config)}

"resources": { "items": { "dataSource": "apiSource", "schema": { "id": "string", "title": "string" } } }
- dataSource: ${doc(resourceFields.dataSource)}
- schema: ${doc(resourceFields.schema)}

"queries": { "itemsQuery": { "resource": "items", "operation": "list", "params": { "page": { "$state": "/page" }, "limit": { "$state": "/limit" } }, "pagination": { "pageParam": "offset", "totalPath": "/count" } } }
  NOTE: params key is ALWAYS "page" (never "offset" or other API names — pageParam handles the conversion).
- resource: ${doc(queryFields.resource)}
- operation: ${doc(queryFields.operation)}
- params: ${doc(queryFields.params)}
- pagination (only for paged lists): { "pageParam": "${doc(paginationFields.pageParam)}", "totalPath": "${doc(paginationFields.totalPath)}" }

"urlSync": ["page", "limit"] — a TOP-LEVEL array (a sibling of "root"/"elements"/"state"/"dataSources"/"resources"/"queries"), never inside dataSources. EVERY paged spec declares it so the current page is shareable in the URL.

Rules — these are the runtime contract, not style:
- \`params\` and \`pagination\` live ONLY on the query declaration
  (\`queries.<name>\`) — never inside an element's \`repeat\`, never in
  \`data_read\` params (whose entire input is \`{ "query": "<name>" }\`; the
  action re-runs the query WITH its declared params).
- Bind params DIRECTLY to state (\`"page": { "$state": "/page" }\`) — never
  compute offsets manually (\`$math multiply\` for params is wrong; the
  \`pageParam\` setting on \`pagination\` handles the conversion).
- State variable MUST be named \`/page\` (0-based) — never \`/offset\` or other
  API-native names. The \`pageParam\` setting (e.g. \`"pageParam": "offset"\`)
  converts the 0-based page to the API's param name.
- For Next/Prev buttons, use \`stepPage\` in \`setState\` with ALL FIVE args
  — never manual \`$math add/subtract\` with the limit value:
  \`\`\`json
  { "action": "setState", "params": { "statePath": "/page",
    "value": { "$computed": "stepPage", "args": {
      "source": { "$state": "/queries/<name>/data" },
      "page": { "$state": "/page" },
      "limit": 12,
      "delta": 1,
      "maxPage": { "$state": "/queries/<name>/maxPage" } } } } }
  \`\`\`
  \`maxPage\` comes from the pagination mirror (\`/queries/<name>/maxPage\`)
  and is REQUIRED: without it \`stepPage\` clamps against the rows you
  loaded — with 12 rows and limit 12 the ceiling is page 0, so Next
  always snaps back and pagination silently does nothing.
- Page buttons ONLY move state (\`setState\` + \`stepPage\`); the refetch
  comes from a watcher on the page state — put
  \`"watch": { "/page": { "action": "data_read", "params": { "query": "<name>" } } }\`
  on one element. Without it, Next/Prev move the label but the list
  never reloads.
- COMPLETENESS: every string in an element's \`children\` MUST have a
  matching element defined in "elements" — emit each definition in the
  same pass; a referenced-but-missing child silently does not render.
- \`itemsPath\` and \`totalPath\` are JSON pointers INTO THE RESPONSE
  body — NOT request paths: for an envelope \`{count, next, results}\`
  the row array lives at \`itemsPath: "/results"\` and the total at
  \`totalPath: "/count"\` — NEVER the request URL path (a list fetched
  from \`/records?offset=0&limit=20\` still unwraps at \`/results\`).
  Only \`itemDetail.path\` is a REQUEST path template
  (\`"/records/{id}"\`, literal "{id}" required). All are "/"-prefixed —
  bare \`"results"\` fails validation.
- \`schema\` is OPTIONAL and validates EVERY read row, not just writes:
  declare only fields you are certain exist in the response as plain
  primitives ("string" | "number" | "boolean" — no array type). Omit
  arrays and unsure fields: one missing or mistyped declared field fails
  the whole query (status "error") — declaring no schema at all is always
  safe.
- With \`config.auth\` the source routes through the server proxy that
  injects the deployment-held key; WITHOUT \`auth\` the browser calls
  \`baseUrl\` directly (protected APIs answer 401). Declare auth as
  \`{ "type": "bearer", "ref": "<ref>" }\` or
  \`{ "type": "header", "header": "X-API-Key", "ref": "<ref>" }\` — SHAPE
  ONLY: the ref names a configured key, never a value; specs never carry
  credentials.
- PAGE STATE: seed \`"state": { "page": 0, "limit": 20 }\` — the spec's
  \`/page\` is 0-BASED. \`pageLabel\` and the browser URL (\`?page=\`) are
  1-based; \`urlSync\` converts between them (URL \`?page=2\` ↔ state \`1\`),
  so a deep link opens straight on the right page.
`;
