import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROFILE_PAGE_COLUMNS,
  PROFILE_RPC,
  readPublicProfile,
} from "@/lib/profile/public-profile";

/**
 * Records the two reads the profile makes. The page query chain mirrors
 * PostgREST's builder shape closely enough for the assertions below.
 */
function fakeClient(options: {
  profileRows?: { id: string; username: string | null }[] | null;
  profileError?: { message: string } | null;
  pages?: Record<string, unknown>[];
  pagesError?: { message: string } | null;
}) {
  const calls: {
    rpc?: { fn: string; params: Record<string, unknown> };
    select?: string;
    filters: { column: string; value: unknown }[];
    order?: { column: string; ascending: boolean };
  } = { filters: [] };

  const builder = {
    select(columns: string) {
      calls.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.filters.push({ column, value });
      return builder;
    },
    order(column: string, opts: { ascending: boolean }) {
      calls.order = { column, ascending: opts.ascending };
      return Promise.resolve({
        data: options.pagesError ? null : (options.pages ?? []),
        error: options.pagesError ?? null,
      });
    },
  };

  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.rpc = { fn, params };
      return {
        data: options.profileError ? null : (options.profileRows ?? []),
        error: options.profileError ?? null,
      };
    },
    from: () => builder,
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe("readPublicProfile (068)", () => {
  test("resolves the handle through the RPC and lists that owner's pages", async () => {
    const { client, calls } = fakeClient({
      profileRows: [{ id: "owner-1", username: "ana-lopez" }],
      pages: [
        {
          ui_id: "ui-1",
          slug: "ana-landing",
          name: "Ana landing",
          version: 2,
          published_at: "2026-11-01T00:00:00Z",
        },
      ],
    });

    const profile = await readPublicProfile(client, "Ana-Lopez");

    expect(profile).toEqual({
      id: "owner-1",
      username: "ana-lopez",
      pages: [
        {
          ui_id: "ui-1",
          slug: "ana-landing",
          name: "Ana landing",
          version: 2,
          published_at: "2026-11-01T00:00:00Z",
        },
      ],
    });
    // The raw path segment goes to the RPC, which lowercases server-side.
    expect(calls.rpc).toEqual({
      fn: PROFILE_RPC,
      params: { p_username: "Ana-Lopez" },
    });
    // Explicit projection — the spec body is never selected.
    expect(calls.select).toBe(PROFILE_PAGE_COLUMNS);
    expect(calls.select).not.toContain("spec");
    expect(calls.filters).toEqual([{ column: "owner_id", value: "owner-1" }]);
    expect(calls.order).toEqual({
      column: "published_at",
      ascending: false,
    });
  });

  test("an unknown handle resolves to null (the route answers 404)", async () => {
    const { client, calls } = fakeClient({ profileRows: [] });
    expect(await readPublicProfile(client, "nobody-here")).toBeNull();
    // No second read when the profile does not exist.
    expect(calls.select).toBeUndefined();
  });

  test("a failed profile read is not an empty profile", async () => {
    const { client } = fakeClient({ profileError: { message: "boom" } });
    expect(await readPublicProfile(client, "ana-lopez")).toBeNull();
  });

  test("a failed page read does not masquerade as a profile with no pages", async () => {
    const { client } = fakeClient({
      profileRows: [{ id: "owner-1", username: "ana-lopez" }],
      pagesError: { message: "boom" },
    });
    expect(await readPublicProfile(client, "ana-lopez")).toBeNull();
  });

  test("an owner with nothing published has an empty list", async () => {
    const { client } = fakeClient({
      profileRows: [{ id: "owner-1", username: "ana-lopez" }],
      pages: [],
    });
    expect(await readPublicProfile(client, "ana-lopez")).toMatchObject({
      username: "ana-lopez",
      pages: [],
    });
  });

  test("falls back to the requested handle if the RPC omits the name", async () => {
    const { client } = fakeClient({
      profileRows: [{ id: "owner-1", username: null }],
      pages: [],
    });
    expect(await readPublicProfile(client, "ana-lopez")).toMatchObject({
      id: "owner-1",
      username: "ana-lopez",
    });
  });
});
