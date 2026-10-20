import type { AdapterContext, DataSourceAdapter } from "./adapter";
import type { AdapterCapabilities } from "./adapter";
import { validateRecord } from "./record-validate";
import { DATA_SOURCE_PROVIDERS, DATA_ERROR_CODES, DataError } from "./types";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * Milestone 2 adapter (docs/plan/046-database-provider): Supabase Postgres
 * behind the same provider-independent contract. Records live as `data`
 * jsonb rows in the single approved table `genui_records`, scoped to one
 * design (app_id = the D6 namespace) and owned by the visiting session
 * (user_id, enforced by RLS — DB-07). Config is always empty: project URL
 * and keys come from the app environment, never from a spec.
 *
 * The Supabase client is structured — a tiny surface mock keeps unit tests
 * free of network and lets the app swap the real `@supabase/ssr` client in.
 */

/**
 * The single table generated UIs are allowed to touch. Mapping resources
 * to arbitrary named tables would let a spec name any table in the
 * project (auth.users, publish internals) and require schema provisioning
 * per app — the generic records table keeps both closed off.
 */
export const GENUI_RECORDS_TABLE = "genui_records";

/** Postgrest error shape (supabase-js normalizes server errors to this). */
export interface PostgrestErrorLike {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Anything awaiting a Postgrest result — every builder method chains. */
export interface PostgrestFilterRequest<T> extends PromiseLike<{
  data: T[] | null;
  error: PostgrestErrorLike | null;
}> {
  /** `S` is the projected row shape, e.g. `{ data: unknown }` for `select("data")`. */
  eq(column: string, value: unknown): PostgrestFilterRequest<T>;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): PostgrestFilterRequest<T>;
  /** Projection / RETURNING after `select`-first reads or `insert|update|delete` writes. */
  select<S extends Record<string, unknown>>(
    columns?: string,
  ): PostgrestFilterRequest<S>;
  single(): PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>;
  maybeSingle(): PromiseLike<{
    data: T | null;
    error: PostgrestErrorLike | null;
  }>;
}

/**
 * What `.from()` itself offers in real supabase-js: entry points ONLY —
 * `eq`/`order`/single-row terminators exist on the FILTER phase, i.e.
 * after `select()` (reads) or `insert|update|delete` (writes). Modeling
 * this faithfully is load-bearing: an earlier M2 pass put `eq` on
 * `from()`, which the fake happily mirrored while every real call
 * crashed with `eq is not a function`.
 */
export interface PostgrestQueryBuilder {
  select<S extends Record<string, unknown>>(
    columns?: string,
  ): PostgrestFilterRequest<S>;
  insert(
    values: Record<string, unknown>,
  ): PostgrestFilterRequest<Record<string, unknown>>;
  update(
    values: Record<string, unknown>,
  ): PostgrestFilterRequest<Record<string, unknown>>;
  delete(): PostgrestFilterRequest<Record<string, unknown>>;
}

interface AuthSessionLike {
  user: { id: string };
}

/** The slice of supabase-js the adapter uses — mockable, network-free. */
export interface SupabaseLike {
  from(table: string): PostgrestQueryBuilder;
  auth: {
    getSession(): PromiseLike<{
      data: { session: AuthSessionLike | null } | null;
      error: { message: string } | null;
    }>;
    signInAnonymously(): PromiseLike<{
      data: { session: AuthSessionLike | null } | null;
      error: { message: string } | null;
    }>;
  };
}

const CAPABILITIES: AdapterCapabilities = {
  list: true,
  get: true,
  create: true,
  update: true,
  delete: true,
};

const resolveCollection = (resource: NamedResourceDef): string =>
  resource.collection ?? resource.name;

const resolvePrimaryKey = (resource: NamedResourceDef): string =>
  resource.primaryKey ?? "id";

const humanize = (error: PostgrestErrorLike): string =>
  `${error.code}: ${error.message}${error.details ? ` (${error.details})` : ""}`;

/**
 * Normalizes any failure that already carries a Postgrest error. Numeric
 * pg codes come from SQL-level failures (42501 = RLS denial), PGRST ones
 * from the REST layer (auth expired, not found). Everything maps onto the
 * shared codes the manager already understands — the UI branches stay
 * provider-blind (M2 plan decision 6).
 */
function toDataError(error: PostgrestErrorLike): DataError {
  if (!error.code) {
    // supabase-js reports fetch/network failures as postgrest errors with
    // an empty code — nothing reached the database, so it is unavailable.
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      "The database is unreachable right now.",
    );
  }
  if (error.code === "42501" || error.code === "403") {
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      "The database refused the operation (row-level security) — rows are scoped to the signed-in visitor.",
    );
  }
  if (error.code.startsWith("PGRST3") || error.code === "401") {
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      "The visitor session expired — reload the page to sign in again.",
    );
  }
  if (error.code === "23505") {
    return new DataError(
      DATA_ERROR_CODES.unknown,
      "A record with this id already exists (duplicate key).",
    );
  }
  return new DataError(DATA_ERROR_CODES.unknown, humanize(error));
}

/**
 * The production client hookup. Created lazily inside initialize so unit
 * tests (which inject fakes) never touch `@supabase/ssr` — and so the
 * adapter graph keeps its import cost off non-database specs.
 */
async function defaultResolveClient(): Promise<SupabaseLike | null> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    return (await createClient()) as unknown as SupabaseLike;
  } catch {
    return null;
  }
}

/**
 * Document-wide in-flight guard for session establishment (observed in
 * the M2 e2e): StrictMode's mount → detach → mount spins up a second
 * adapter instance while the first is still signing the fresh visitor in
 * — both see "no session" and mint TWO anonymous users. Concurrent
 * ensures share one operation; the slot clears on settle so later checks
 * re-read the (possibly changed) session state — never memoized results.
 */
let sessionInFlight: Promise<void> | null = null;

export function createSupabaseAdapter(
  def: DataSourceDef,
  context: AdapterContext,
  resolveClient: (
    context: AdapterContext,
  ) => Promise<SupabaseLike | null> = defaultResolveClient,
): DataSourceAdapter {
  let client: SupabaseLike | null | undefined;

  const requireClient = (): SupabaseLike => {
    if (client === undefined || client === null) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        "Supabase is not configured in this app (missing project URL or key).",
      );
    }
    return client;
  };

  /** Entry point — the table only; filters belong to the write/read chain. */
  const fromTable = (): PostgrestQueryBuilder =>
    requireClient().from(GENUI_RECORDS_TABLE);

  /**
   * The (app_id, resource) WHERE scope every read and update/delete
   * applies. `create` carries the scope in its VALUES instead — PostgREST
   * has no WHERE clause on INSERT.
   */
  const scope = <T>(
    resource: NamedResourceDef,
    request: PostgrestFilterRequest<T>,
  ): PostgrestFilterRequest<T> =>
    request
      .eq("app_id", context.namespace)
      .eq("resource", resolveCollection(resource));

  const validateAll = (
    resource: NamedResourceDef,
    rows: Array<{ data: unknown }>,
  ): Record<string, unknown>[] => {
    return rows.map((row) => {
      const record = row.data;
      if (record === null || typeof record !== "object") {
        throw new DataError(
          DATA_ERROR_CODES.malformed,
          `Stored data in resource "${resource.name}" is not a JSON record.`,
        );
      }
      validateRecord(resource, record as Record<string, unknown>);
      return record as Record<string, unknown>;
    });
  };

  /**
   * The visitor session IS the authorization identity (M2 plan decision
   * 3): a signed-in visitor keeps their real user id, a fresh visitor is
   * anonymously signed in once and the session persists in the browser —
   * both are rows' `user_id = auth.uid()` under RLS.
   */
  async function ensureSession(): Promise<void> {
    if (sessionInFlight) return sessionInFlight;
    sessionInFlight = establishSession();
    try {
      await sessionInFlight;
    } finally {
      sessionInFlight = null;
    }
  }

  async function establishSession(): Promise<void> {
    const supabase = requireClient();
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        `Session check failed: ${error.message}`,
      );
    }
    if (sessionData?.session?.user) return;
    const { data: anonData, error: anonError } =
      await supabase.auth.signInAnonymously();
    if (anonError || !anonData?.session?.user) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        "Could not establish a visitor session — anonymous sign-in may be disabled for this project.",
      );
    }
  }

  return {
    provider: DATA_SOURCE_PROVIDERS.supabase,
    capabilities: CAPABILITIES,

    async initialize(): Promise<void> {
      if (client === undefined || client === null) {
        // Defense in depth: validation rejects non-empty configs at the
        // spec level; the runtime repeats it in case a spec slipped in.
        if (Object.keys(def.config ?? {}).length > 0) {
          throw new DataError(
            DATA_ERROR_CODES.malformed,
            'The "supabase" provider takes no config — project URL and keys come from the app environment.',
          );
        }
        const resolved = await resolveClient(context);
        if (!resolved) {
          throw new DataError(
            DATA_ERROR_CODES.unavailable,
            "Supabase is not configured in this app (missing project URL or key).",
          );
        }
        client = resolved;
      }
      await ensureSession();
    },

    async list(resource: NamedResourceDef): Promise<Record<string, unknown>[]> {
      const { data, error } = await scope(
        resource,
        fromTable().select<{ data: unknown }>("data"),
      ).order("created_at", { ascending: true });
      if (error) throw toDataError(error);
      return validateAll(resource, data ?? []);
    },

    async get(
      resource: NamedResourceDef,
      id: string,
    ): Promise<Record<string, unknown> | null> {
      const { data, error } = await scope(
        resource,
        fromTable().select<{ data: unknown }>("data"),
      )
        .eq("id", id)
        .maybeSingle();
      if (error) throw toDataError(error);
      if (!data) return null;
      return validateAll(resource, [data])[0];
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
      // Scope rides in the VALUES (no WHERE on INSERT).
      const { data, error } = await fromTable()
        .insert({
          app_id: context.namespace,
          resource: resolveCollection(resource),
          id: record[resolvePrimaryKey(resource)],
          data: record,
        })
        .select<{ data: unknown }>("data")
        .single();
      if (error) throw toDataError(error);
      return (data?.data ?? record) as Record<string, unknown>;
    },

    async update(
      resource: NamedResourceDef,
      id: string,
      patch: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      // jsonb column replace — no server-side merge — so read-modify-write
      // gives the contract's documented partial-patch semantics. Two
      // concurrent updates are last-writer-wins (documented limitation).
      const current = await this.get(resource, id);
      if (current === null) {
        throw new DataError(
          DATA_ERROR_CODES.notFound,
          `No record with id "${id}" in resource "${resource.name}".`,
        );
      }
      const merged = { ...current, ...patch };
      validateRecord(resource, merged);
      const { data, error } = await scope(
        resource,
        fromTable().update({ data: merged }),
      )
        .eq("id", id)
        .select<{ data: unknown }>("data")
        .single();
      if (error) throw toDataError(error);
      return (data?.data ?? merged) as Record<string, unknown>;
    },

    async delete(resource: NamedResourceDef, id: string): Promise<void> {
      const { data, error } = await scope(resource, fromTable().delete())
        .eq("id", id)
        .select<{ id: string }>("id");
      if (error) throw toDataError(error);
      if ((data ?? []).length === 0) {
        throw new DataError(
          DATA_ERROR_CODES.notFound,
          `No record with id "${id}" in resource "${resource.name}".`,
        );
      }
    },

    async dispose(): Promise<void> {
      client = null;
    },
  };
}
