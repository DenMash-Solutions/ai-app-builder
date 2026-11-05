import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Route-level tests for the artifacts persist seam (plan 069 task 5): the
 * screen payload keeps writing `published_pages`; the project payload writes
 * `published_entry_points` keyed (project, route, version) — and each branch
 * revalidates its OWN projection tag beside the write (the
 * cache-invalidation-writers lesson). `next/cache` and the cookie-auth
 * Supabase client are mocked; nothing touches a real request store or DB.
 */

const revalidates: Array<{ tag: string; expire: unknown }> = [];
const updates: Array<{
  table: string;
  payload: unknown;
  filters: Array<[string, unknown]>;
}> = [];
let dbError: string | null = null;

interface UpdateDb {
  from(table: string): {
    update(payload: unknown): Record<string, unknown>;
  };
}

let db: UpdateDb;

mock.module("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: (tag: string, expire?: unknown) => {
    revalidates.push({ tag, expire });
  },
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => db,
}));

const { POST } = await import("@/app/api/publish-artifacts/route");

const INVALID_JSON = Symbol("invalid JSON");

const post = (body: unknown): Promise<Response> =>
  POST(
    new Request("http://localhost:3000/api/publish-artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === INVALID_JSON ? "not json" : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  revalidates.length = 0;
  updates.length = 0;
  dbError = null;
  db = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const statement = {
            table,
            payload,
            filters: [] as Array<[string, unknown]>,
          };
          updates.push(statement);
          const wrapped: Record<string, unknown> = {};
          wrapped.eq = (column: string, value: unknown) => {
            statement.filters.push([column, value]);
            return wrapped;
          };
          wrapped.then = (
            onOk: unknown,
          ): Promise<{ data: unknown; error: { message: string } | null }> =>
            Promise.resolve({
              data: null,
              error: dbError === null ? null : { message: dbError },
            }).then(onOk as never);
          return wrapped;
        },
      };
    },
  };
});

const ARTIFACTS = { en: { html: "<p>hi</p>", css: ".x{}" } };

describe("POST /api/publish-artifacts (screen bake)", () => {
  test("stamps published_pages version-guarded and revalidates its tag", async () => {
    const response = await post({
      uiId: "ui-1",
      version: 2,
      artifacts: ARTIFACTS,
    });

    const body = (await response.json()) as { ok?: boolean };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("published_pages");
    expect(updates[0].payload).toEqual({ artifacts: ARTIFACTS });
    expect(Object.fromEntries(updates[0].filters)).toEqual({
      ui_id: "ui-1",
      version: 2,
    });
    expect(revalidates).toEqual([
      { tag: "published_pages", expire: { expire: 0 } },
    ]);
  });
});

describe("POST /api/publish-artifacts (project bake, task 5)", () => {
  test("stamps published_entry_points keyed (project, route, version)", async () => {
    const response = await post({
      projectId: "proj-1",
      route: "",
      version: 1,
      artifacts: ARTIFACTS,
    });

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("published_entry_points");
    expect(updates[0].payload).toEqual({ artifacts: ARTIFACTS });
    // The home route's empty value is a real key — validated, not rejected.
    expect(Object.fromEntries(updates[0].filters)).toEqual({
      project_id: "proj-1",
      route: "",
      version: 1,
    });
    expect(revalidates).toEqual([
      { tag: "published_entry_points", expire: { expire: 0 } },
    ]);
  });

  test("an old bake can never overwrite a re-published entry (version guard)", async () => {
    await post({
      projectId: "proj-1",
      route: "settings",
      version: 7,
      artifacts: ARTIFACTS,
    });

    expect(Object.fromEntries(updates[0].filters)).toEqual({
      project_id: "proj-1",
      route: "settings",
      version: 7,
    });
  });

  test("refuses payloads that name neither surface, or miss version/artifacts", async () => {
    expect(
      (await post({ route: "", version: 1, artifacts: ARTIFACTS })).status,
    ).toBe(400);
    expect(
      (await post({ projectId: "", version: 1, artifacts: ARTIFACTS })).status,
    ).toBe(400);
    expect((await post({ projectId: "p", artifacts: ARTIFACTS })).status).toBe(
      400,
    );
    expect((await post({ projectId: "p", route: "" })).status).toBe(400);
    expect(
      (await post({ projectId: "p", route: "", version: 1, artifacts: [] }))
        .status,
    ).toBe(400);
    expect((await post(INVALID_JSON)).status).toBe(400);
    expect(updates).toHaveLength(0);
    expect(revalidates).toEqual([]);
  });

  test("a write failure answers 500 with the DB message and revalidates nothing", async () => {
    dbError = "row-level security";

    const response = await post({
      projectId: "proj-1",
      route: "settings",
      version: 1,
      artifacts: ARTIFACTS,
    });

    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(500);
    expect(body.error).toBe("row-level security");
    expect(revalidates).toEqual([]);
  });
});
