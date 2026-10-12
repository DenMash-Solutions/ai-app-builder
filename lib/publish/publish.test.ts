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
      const findBySlug = (slug: string) =>
        state.pages.find((row) => row.slug === slug) ?? null;
      return {
        select: (columns: string) => {
          if (columns.includes("ui_id, slug, version")) {
            return chain(() => ({
              data: state.pages.map((row) => ({ ...row })),
              error: null,
            }));
          }
          // Availability probe: resolve the slug captured by the eq() call.
          let slug = "";
          return chain(
            () => ({ data: findBySlug(slug), error: null }),
            (value) => {
              slug = value;
            },
          );
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

  return { from: table };
}

let state: FakeState;

beforeEach(() => {
  state = { versions: [], pages: [], inserts: [], upserts: [], deletes: [] };
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

describe("isSlugAvailable", () => {
  test("free slugs are available", async () => {
    expect(await isSlugAvailable(makeClient(state), "free")).toBe(true);
  });

  test("another owner's live slug is taken", async () => {
    state.pages.push({ ui_id: "other-ui", slug: "taken", version: 1 });
    expect(await isSlugAvailable(makeClient(state), "taken")).toBe(false);
  });

  test("our own live slug stays available (republish keeps it)", async () => {
    state.pages.push({ ui_id: "my-ui", slug: "mine", version: 1 });
    expect(await isSlugAvailable(makeClient(state), "mine", "my-ui")).toBe(
      true,
    );
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
