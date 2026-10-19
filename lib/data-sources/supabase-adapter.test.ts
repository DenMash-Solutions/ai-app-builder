import { describe, expect, test } from "bun:test";
import { GENUI_RECORDS_TABLE, createSupabaseAdapter } from "./supabase-adapter";
import type {
  PostgrestErrorLike,
  PostgrestQueryBuilder,
  SupabaseLike,
} from "./supabase-adapter";
import { DATA_ERROR_CODES, DataError } from "./types";
import type { AdapterContext } from "./adapter";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * A fake PostgREST over an in-memory row store. Executes the adapter's
 * actual chain semantics (eq filters, insert/update/delete, single vs
 * list returns) so CRUD tests exercise the real filtering logic.
 */

type FakeRow = {
  app_id: string;
  resource: string;
  id: string;
  data: unknown;
  created_at: string;
};

const context: AdapterContext = { namespace: "entry-1" };
const def: DataSourceDef = {
  provider: "supabase",
  config: {},
};
const resource: NamedResourceDef = {
  name: "todos",
  dataSource: "db",
  schema: { title: "string", done: "boolean" },
};

let clock = 0;

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private action: "select" | "insert" | "update" | "delete" | "none" = "none";
  private values: Record<string, unknown> | null = null;
  private terminate: "none" | "single" | "maybeSingle" | "list" = "none";
  private ordered = false;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(): FakeQuery {
    // Read entry (nothing started yet) — or RETURNING after a write, in
    // which case the write resolves with its rows (`.delete().select()`
    // in real postgrest). Like the real builder, filters are NOT part of
    // this phase transition — they arrive on the returned request.
    if (this.action === "none") this.action = "select";
    if (this.action !== "select") this.terminate = "list";
    return this;
  }
  eq(column: string, value: unknown): FakeQuery {
    this.filters.push([column, value]);
    return this;
  }
  order(): FakeQuery {
    this.ordered = true;
    return this;
  }
  insert(values: Record<string, unknown>): FakeQuery {
    this.action = "insert";
    this.values = values;
    return this;
  }
  update(values: Record<string, unknown>): FakeQuery {
    this.action = "update";
    this.values = values;
    return this;
  }
  delete(): FakeQuery {
    this.action = "delete";
    return this;
  }
  single(): PromiseLike<{
    data: Record<string, unknown> | null;
    error: PostgrestErrorLike | null;
  }> {
    this.terminate = "single";
    return this as PromiseLike<{
      data: Record<string, unknown> | null;
      error: PostgrestErrorLike | null;
    }>;
  }
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null;
    error: PostgrestErrorLike | null;
  }> {
    this.terminate = "maybeSingle";
    return this as PromiseLike<{
      data: Record<string, unknown> | null;
      error: PostgrestErrorLike | null;
    }>;
  }

  then<
    TResult1 = {
      data: Record<string, unknown>[] | null;
      error: PostgrestErrorLike | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: Record<string, unknown>[] | null;
          error: PostgrestErrorLike | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    // single/maybeSingle awaits also land here — their casts declare the
    // narrower {data: T | null} shape while execute() produces exactly
    // that object for those terminates. The regular await always gets the
    // postgrest list shape below.
    return Promise.resolve(this.execute()).then(
      (value) =>
        onfulfilled!(
          value as {
            data: Record<string, unknown>[] | null;
            error: PostgrestErrorLike | null;
          },
        ),
      onrejected,
    );
  }

  private execute(): {
    data: Record<string, unknown>[] | Record<string, unknown> | null;
    error: PostgrestErrorLike | null;
  } {
    const injected = this.client.popError();
    if (injected) return { data: null, error: injected };
    const readStatus = this.statusFilter();
    if (readStatus !== null) return readStatus;
    const writeStatus = this.writeAction();
    if (writeStatus !== null) return writeStatus;
    return {
      data: null,
      error: { code: "test", message: "unconfigured fake action" },
    };
  }

  private statusFilter(): {
    data: Record<string, unknown>[] | Record<string, unknown> | null;
    error: PostgrestErrorLike | null;
  } | null {
    if (this.action !== "select") return null;
    let rows = this.matching();
    if (this.ordered)
      rows = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (this.terminate === "maybeSingle") {
      return {
        data: (rows[0] as unknown as Record<string, unknown>) ?? null,
        error: null,
      };
    }
    if (this.terminate === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "Expected 1 row, got 0" },
        };
      }
      return {
        data: rows[0] as unknown as Record<string, unknown>,
        error: null,
      };
    }
    return {
      data: rows as unknown as Record<string, unknown>[],
      error: null,
    };
  }

  private writeAction(): {
    data: Record<string, unknown>[] | Record<string, unknown> | null;
    error: PostgrestErrorLike | null;
  } | null {
    if (this.action === "insert") {
      const row = this.values as unknown as FakeRow;
      const duplicate = this.client.rows.some(
        (r) =>
          r.app_id === row.app_id &&
          r.resource === row.resource &&
          r.id === row.id,
      );
      if (duplicate) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key" },
        };
      }
      this.client.rows.push({
        ...row,
        created_at: new Date(++clock).toISOString(),
      });
      if (this.terminate === "single")
        return { data: { data: row.data }, error: null };
      return { data: null, error: null };
    }
    if (this.action === "update") {
      const merged = (this.values as Record<string, unknown>).data;
      const victims = this.matching();
      if (victims.length !== 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: `Expected 1 row, got ${victims.length}`,
          },
        };
      }
      victims[0].data = merged;
      if (this.terminate === "single")
        return { data: { data: merged }, error: null };
      return { data: null, error: null };
    }
    if (this.action === "delete") {
      const victims = this.matching();
      this.client.rows = this.client.rows.filter((r) => !victims.includes(r));
      if (this.terminate === "list") {
        // select() on delete — return the deleted rows' shape
        return {
          data: victims.map((r) => ({ id: r.id })) as unknown as Record<
            string,
            unknown
          >[],
          error: null,
        };
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  private matching(): FakeRow[] {
    return this.client.rows.filter((row) =>
      this.filters.every(
        ([column, value]) => row[column as keyof FakeRow] === value,
      ),
    );
  }
}

/**
 * What `from()` returns in real supabase-js: entry points ONLY — no
 * `eq`/`order`/terminators. Calling `from().eq()` throws "is not a
 * function" here exactly as it does against the real client (the bug
 * this phase split exists to keep caught).
 */
class FakeFrom {
  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}
  select(): FakeQuery {
    return new FakeQuery(this.client, this.table).select();
  }
  insert(values: Record<string, unknown>): FakeQuery {
    return new FakeQuery(this.client, this.table).insert(values);
  }
  update(values: Record<string, unknown>): FakeQuery {
    return new FakeQuery(this.client, this.table).update(values);
  }
  delete(): FakeQuery {
    return new FakeQuery(this.client, this.table).delete();
  }
}

class FakeSupabaseClient implements SupabaseLike {
  rows: FakeRow[] = [];
  private pendingError: PostgrestErrorLike | null = null;
  readonly calls = { signInAnonymously: 0 };
  session: { user: { id: string } } | null = null;
  signInError: { message: string } | null = null;

  from(): PostgrestQueryBuilder {
    // Cast at the boundary only: FakeQuery's self-returning chain is
    // structurally narrower than the generic supabase-js request types.
    return new FakeFrom(
      this,
      GENUI_RECORDS_TABLE,
    ) as unknown as PostgrestQueryBuilder;
  }

  popError(): PostgrestErrorLike | null {
    const error = this.pendingError;
    this.pendingError = null;
    return error;
  }

  failNext(error: PostgrestErrorLike): void {
    this.pendingError = error;
  }

  readonly auth = {
    getSession: () =>
      Promise.resolve({
        data: { session: this.session ? { user: this.session.user } : null },
        error: null,
      }),
    signInAnonymously: () => {
      this.calls.signInAnonymously += 1;
      if (this.signInError)
        return Promise.resolve({
          data: { session: null },
          error: this.signInError,
        });
      this.session = { user: { id: "user-1" } };
      return Promise.resolve({
        data: { session: { user: this.session.user } },
        error: null,
      });
    },
  } as unknown as SupabaseLike["auth"];

  async getUser(): Promise<{ id: string } | null> {
    const { data } = await this.auth.getSession();
    return data?.session?.user ?? null;
  }
}

const makeAdapter = (client: FakeSupabaseClient) =>
  createSupabaseAdapter(def, context, async () => client);

describe("supabase adapter", () => {
  test("initialize signs a fresh visitor in anonymously, exactly once", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    expect(client.calls.signInAnonymously).toBe(1);
    // A later initialize (the manager calls it before every load) reuses
    // the session — no repeat sign-in round trips.
    await adapter.initialize();
    expect(client.calls.signInAnonymously).toBe(1);
  });

  test("initialize reuses an existing session", async () => {
    const client = new FakeSupabaseClient();
    client.session = { user: { id: "user-42" } };
    const adapter = makeAdapter(client);
    await adapter.initialize();
    expect(client.calls.signInAnonymously).toBe(0);
  });

  test("concurrent instances sign the fresh visitor in exactly once", async () => {
    // StrictMode's mount → detach → mount: two adapter instances race the
    // same cookie session — without the document-wide in-flight guard each
    // one mints its own anonymous user (observed live in the M2 e2e).
    const client = new FakeSupabaseClient();
    const first = makeAdapter(client);
    const second = makeAdapter(client);
    await Promise.all([first.initialize(), second.initialize()]);
    expect(client.calls.signInAnonymously).toBe(1);
    // And the shared session still serves a later, sequential initialize.
    await first.initialize();
    expect(client.calls.signInAnonymously).toBe(1);
  });

  test("anonymous sign-in failure becomes an unavailable error with a friendly message", async () => {
    const client = new FakeSupabaseClient();
    client.signInError = { message: "Anonymous sign-ins are disabled" };
    const adapter = makeAdapter(client);
    const error = await adapter.initialize().catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe(DATA_ERROR_CODES.unavailable);
    expect(error.message).toContain("anonymous sign-in may be disabled");
  });

  test("create generates the id, inserts, and returns the record", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const record = await adapter.create(resource, { title: "a", done: false });
    expect(record.title).toBe("a");
    expect(resource.schema).toEqual({ title: "string", done: "boolean" });
    expect(typeof record.id).toBe("string");
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0].app_id).toBe("entry-1");
    expect(client.rows[0].resource).toBe("todos");
    expect(client.rows[0].data).toEqual(record);
  });

  test("list returns records ordered by created time and validated", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const first = await adapter.create(resource, {
      title: "first",
      done: false,
    });
    const second = await adapter.create(resource, {
      title: "second",
      done: true,
    });
    const records = await adapter.list(resource);
    expect(records.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  test("update patches an existing record with read-modify-write semantics", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const record = await adapter.create(resource, { title: "a", done: false });
    const updated = await adapter.update(resource, record.id as string, {
      done: true,
    });
    expect(updated).toEqual({ ...record, done: true });
    expect((await adapter.list(resource))[0]).toEqual(updated);
  });

  test("update/delete on a missing id become notFound", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const updates = await adapter
      .update(resource, "nope", { done: true })
      .catch((e) => e);
    expect(updates.code).toBe(DATA_ERROR_CODES.notFound);
    const deletes = await adapter.delete(resource, "nope").catch((e) => e);
    expect(deletes.code).toBe(DATA_ERROR_CODES.notFound);
  });

  test("delete removes the scoped row and never reaches another scope", async () => {
    const client = new FakeSupabaseClient();
    // A row in the SAME table, different namespace — the adapter's
    // (app_id, resource) scope must make it unreachable. Representation
    // matters too: `.delete().select()` has to resolve with the removed
    // rows (the fake's first shape never returned any, so delete-success
    // was untestable and only the vacuous notFound path ever ran).
    client.rows.push({
      app_id: "other-entry",
      resource: "todos",
      id: "foreign",
      data: { title: "Not yours", done: false },
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const created = await adapter.create(resource, {
      title: "Bye",
      done: false,
    });

    await adapter.delete(resource, String(created.id));
    expect(await adapter.list(resource)).toEqual([]);
    expect(client.rows.map((row) => row.id)).toEqual(["foreign"]);
  });

  test("get returns null for a missing record", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    expect(await adapter.get(resource, "missing")).toBeNull();
  });

  test("schema violations reject writes before any row is stored", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const error = await adapter
      .create(resource, { title: "a", done: "not-a-boolean" })
      .catch((e) => e);
    expect(error.code).toBe(DATA_ERROR_CODES.invalidRecord);
    expect(client.rows).toHaveLength(0);
  });

  test("malformed stored data becomes malformed, never a crash", async () => {
    const client = new FakeSupabaseClient();
    client.rows.push({
      app_id: "entry-1",
      resource: "todos",
      id: "broken",
      data: "just-a-string",
      created_at: new Date(1).toISOString(),
    });
    const adapter = makeAdapter(client);
    await adapter.initialize();
    const error = await adapter.list(resource).catch((e) => e);
    expect(error.code).toBe(DATA_ERROR_CODES.malformed);
  });

  test("RLS denial normalizes to a friendly unavailable error", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    client.failNext({
      code: "42501",
      message: "new row violates row-level security policy",
    });
    const error = await adapter.list(resource).catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe(DATA_ERROR_CODES.unavailable);
    expect(error.message).toContain("row-level security");
  });

  test("network/reporting gaps (empty postgrest code) normalize to unavailable", async () => {
    const client = new FakeSupabaseClient();
    const adapter = makeAdapter(client);
    await adapter.initialize();
    client.failNext({ code: "", message: "TypeError: Failed to fetch" });
    const error = await adapter.list(resource).catch((e) => e);
    expect(error.code).toBe(DATA_ERROR_CODES.unavailable);
  });

  test("uses the file's configured table name", async () => {
    expect(GENUI_RECORDS_TABLE).toBe("genui_records");
  });

  test("a broken client hookup becomes unavailable, not a crash", async () => {
    const adapter = createSupabaseAdapter(def, context, async () => null);
    const error = await adapter.initialize().catch((e) => e);
    expect(error.code).toBe(DATA_ERROR_CODES.unavailable);
    expect(error.message).toContain("not configured");
  });
});
