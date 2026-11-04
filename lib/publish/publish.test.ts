import { beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { createEntry } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import {
  getPublishedState,
  isSlugAvailable,
  publishEntry,
  unpublishEntry,
} from "./publish";
import type { PublishClient } from "./publish";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

interface FakeState {
  versions: Array<{ ui_id: string; version: number }>;
  pages: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
  upserts: Array<Record<string, unknown>>;
  deletes: Array<string>;
  /** Message to fail the next upsert with (simulates the slug constraint). */
  upsertError?: string;
  /** `route_claims` rows the `route_available` arbiter consults. */
  claims: Array<{ value: string; owner_id: string; kind: string }>;
  /** The JWT subject the RPC runs as (`null` = anonymous). */
  callerId: string | null;
  /** Message to fail the next `route_available` RPC with. */
  rpcError?: string;
  /** Every RPC the code under test issued (fn name + params). */
  rpcCalls: Array<{ fn: string; params: Record<string, unknown> }>;
}

function makeClient(state: FakeState): PublishClient {
  type Resolved = { data: unknown; error: { message: string } | null };

  /** Uniform chainable builder: eq/in/order/limit are pass-throughs. */
  function chain(
    resolved: () => Resolved,
    onEq?: (value: string) => void,
  ): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.eq = (_column: string, value: string) => {
      onEq?.(value);
      return c;
    };
    c.in = () => c;
    c.order = () => c;
    c.limit = () => c;
    c.maybeSingle = async () => resolved();
    c.then = (onOk: unknown, onErr: unknown) =>
      Promise.resolve(resolved()).then(onOk as never, onErr as never);
    return c;
  }

  function table(name: string): ReturnType<PublishClient["from"]> {
    if (name === "page_versions") {
      return {
        select: () =>
          chain(() => ({ data: state.versions[0] ?? null, error: null })),
        insert: (row: Record<string, unknown>) => {
          state.inserts.push(row);
          return chain(() => ({ data: row, error: null }));
        },
      } as unknown as ReturnType<PublishClient["from"]>;
    }
    if (name === "published_pages") {
      return {
        select: (columns: string) => {
          // The only remaining select shape is getPublishedState's mapping;
          // the availability probe moved to the `route_available` RPC.
          if (!columns.includes("ui_id, slug, version")) {
            throw new Error(`unexpected published_pages select: ${columns}`);
          }
          return chain(() => ({
            data: state.pages.map((row) => ({ ...row })),
            error: null,
          }));
        },
        upsert: (row: Record<string, unknown>) => {
          const upsertError = state.upsertError;
          if (upsertError) {
            return chain(() => ({
              data: null,
              error: { message: upsertError },
            }));
          }
          state.upserts.push(row);
          return chain(() => ({ data: row, error: null }));
        },
        delete: () => ({
          eq: (_column: string, value: string) => {
            state.deletes.push(value);
            return Promise.resolve({ error: null });
          },
        }),
      } as unknown as ReturnType<PublishClient["from"]>;
    }
    return {
      select: () => chain(() => ({ data: null, error: null })),
    } as unknown as ReturnType<PublishClient["from"]>;
  }

  /**
   * Mini-implementation of `route_available(p_value, p_kind)` — the same
   * contract as the definer function: a claim blocks unless it is the
   * caller's OWN claim of the SAME kind; an unknown kind or an empty value
   * answers false rather than loosening the check.
   */
  async function rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: boolean | null; error: { message: string } | null }> {
    state.rpcCalls.push({ fn, params });
    if (state.rpcError)
      return { data: null, error: { message: state.rpcError } };
    const value = String(params.p_value ?? "")
      .trim()
      .toLowerCase();
    const kind = String(params.p_kind ?? "");
    if ((kind !== "screen" && kind !== "handle") || value === "") {
      return { data: false, error: null };
    }
    const claim = state.claims.find((row) => row.value === value);
    if (!claim) return { data: true, error: null };
    const blocked =
      claim.kind !== kind || claim.owner_id !== (state.callerId ?? null);
    return { data: !blocked, error: null };
  }

  return { from: table, rpc };
}

let state: FakeState;

beforeEach(() => {
  state = {
    versions: [],
    pages: [],
    inserts: [],
    upserts: [],
    deletes: [],
    claims: [],
    callerId: null,
    rpcCalls: [],
  };
});

describe("publishEntry", () => {
  test("snapshots version 1 and upserts the public projection", async () => {
    const entry: HistoryEntry = createEntry("my page", makeSpec("v0"));
    const client = makeClient(state);

    const result = await publishEntry(client, "owner-1", entry, "my-page");

    expect(result).toMatchObject({ ok: true, slug: "my-page", version: 1 });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      ui_id: entry.id,
      owner_id: "owner-1",
      version: 1,
    });
    expect(state.upserts[0]).toMatchObject({
      ui_id: entry.id,
      slug: "my-page",
      version: 1,
    });
  });

  test("increments the version when snapshots already exist", async () => {
    const entry = createEntry("my page", makeSpec("v0"));
    state.versions.push({ ui_id: entry.id, version: 2 });

    const result = await publishEntry(
      makeClient(state),
      "owner-1",
      entry,
      "s2",
    );

    expect(result.version).toBe(3);
    expect(state.inserts[0].version).toBe(3);
  });

  test("reports the slug as taken on the unique-constraint error", async () => {
    const entry = createEntry("my page", makeSpec("v0"));
    state.upsertError =
      'duplicate key value violates unique constraint "published_pages_slug_key"';

    const result = await publishEntry(
      makeClient(state),
      "owner-1",
      entry,
      "s3",
    );

    expect(result.ok).toBe(false);
    expect(result.slugTaken).toBe(true);
  });
});

describe("isSlugAvailable (route_available, decision 11)", () => {
  test("a value nobody claims is available", async () => {
    expect(await isSlugAvailable(makeClient(state), "free")).toBe(true);
  });

  test("asks the arbiter for the SCREEN kind, never the pages table", async () => {
    await isSlugAvailable(makeClient(state), "my-slug");

    expect(state.rpcCalls).toEqual([
      {
        fn: "route_available",
        params: { p_value: "my-slug", p_kind: "screen" },
      },
    ]);
    expect(state.pages).toHaveLength(0);
  });

  test("a foreign claim blocks", async () => {
    state.callerId = "owner-1";
    state.claims = [
      { value: "taken", owner_id: "someone-else", kind: "screen" },
    ];

    expect(await isSlugAvailable(makeClient(state), "taken")).toBe(false);
  });

  test("our own screen claim stays available (republish is not taken)", async () => {
    state.callerId = "owner-1";
    state.claims = [{ value: "mine", owner_id: "owner-1", kind: "screen" }];

    expect(await isSlugAvailable(makeClient(state), "mine")).toBe(true);
  });

  test("our own HANDLE claim blocks the screen slug (decision 10)", async () => {
    state.callerId = "owner-1";
    state.claims = [{ value: "blog", owner_id: "owner-1", kind: "handle" }];

    expect(await isSlugAvailable(makeClient(state), "blog")).toBe(false);
  });

  test("an anonymous caller sees every claim as taken", async () => {
    state.callerId = null;
    state.claims = [{ value: "mine", owner_id: "owner-1", kind: "screen" }];

    expect(await isSlugAvailable(makeClient(state), "mine")).toBe(false);
  });

  test("fails closed when the arbiter errors", async () => {
    state.rpcError = "function route_available does not exist";

    expect(await isSlugAvailable(makeClient(state), "anything")).toBe(false);
  });
});

describe("getPublishedState", () => {
  test("maps rows for the visible entries", async () => {
    state.pages.push({ ui_id: "a", slug: "x", version: 2 });

    const pages = await getPublishedState(makeClient(state), ["a", "b"]);

    expect(pages).toEqual([{ uiId: "a", slug: "x", version: 2 }]);
  });

  test("skips the query when there is nothing to ask for", async () => {
    expect(await getPublishedState(makeClient(state), [])).toEqual([]);
  });
});

describe("unpublishEntry", () => {
  test("deletes the public row by ui id, versions untouched", async () => {
    const result = await unpublishEntry(makeClient(state), "ui-9");

    expect(result.ok).toBe(true);
    expect(state.deletes).toEqual(["ui-9"]);
    expect(state.inserts).toHaveLength(0);
  });
});
