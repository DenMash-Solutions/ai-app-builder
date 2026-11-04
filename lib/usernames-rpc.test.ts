import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimIssue,
  claimUsername,
  fetchUsernameAvailable,
  USERNAME_RPCS,
} from "@/lib/usernames-rpc";
import { USERNAME_ISSUES } from "@/lib/usernames";

/** Minimal stand-in: records the call and answers with a canned result. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return result;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("username RPCs (068)", () => {
  test("maps Postgres failures to the issue the UI explains", () => {
    expect(claimIssue(null)).toBeNull();
    expect(claimIssue({ code: "23505" })).toBe(USERNAME_ISSUES.taken);
    expect(claimIssue({ code: "23514" })).toBe(USERNAME_ISSUES.pattern);
    // A session/network/server failure is not a username verdict.
    expect(claimIssue({ code: "42501" })).toBeNull();
    expect(claimIssue({ code: null })).toBeNull();
  });

  test("availability is asked with the normalized handle, null on failure", async () => {
    const ok = fakeClient({ data: true, error: null });
    expect(await fetchUsernameAvailable(ok.client, "ana-lopez")).toBe(true);
    expect(ok.calls).toEqual([
      { fn: USERNAME_RPCS.available, params: { p_username: "ana-lopez" } },
    ]);

    const failed = fakeClient({ data: null, error: { code: "" } });
    expect(await fetchUsernameAvailable(failed.client, "ana-lopez")).toBeNull();
  });

  test("a successful claim returns the stored handle", async () => {
    const { client, calls } = fakeClient({ data: "ana-lopez", error: null });
    expect(await claimUsername(client, "ana-lopez")).toEqual({
      ok: true,
      username: "ana-lopez",
    });
    expect(calls[0]).toEqual({
      fn: USERNAME_RPCS.claim,
      params: { p_username: "ana-lopez" },
    });
  });

  test("a taken handle fails with the taken issue, not a generic error", async () => {
    const { client } = fakeClient({ data: null, error: { code: "23505" } });
    expect(await claimUsername(client, "taken-name")).toEqual({
      ok: false,
      issue: USERNAME_ISSUES.taken,
    });
  });

  test("an unexplained failure leaves the issue open for a generic message", async () => {
    const { client } = fakeClient({ data: null, error: { code: "XX000" } });
    expect(await claimUsername(client, "some-name")).toEqual({
      ok: false,
      issue: null,
    });
  });
});
