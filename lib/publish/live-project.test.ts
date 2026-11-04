import { describe, expect, test } from "bun:test";
import type { PublishClient } from "./publish";
import { getLiveProjectFrom, liveProjectExistsFrom } from "./live-project";

/** An RPC-only fake — `live_project` must never touch a table directly. */
function rpcClient(
  data: unknown,
  error: { message: string } | null = null,
): PublishClient {
  return {
    from: () => {
      throw new Error("live_project reads via rpc, not from()");
    },
    rpc: () => Promise.resolve({ data, error }),
  } as unknown as PublishClient;
}

describe("getLiveProjectFrom (decision 17)", () => {
  test("a published handle answers project id + current handle", async () => {
    const ref = await getLiveProjectFrom(
      rpcClient({ project_id: "proj-1", handle: "dex" }),
      "dex",
    );
    expect(ref).toEqual({ projectId: "proj-1", handle: "dex" });
  });

  test("a redirect answers the CURRENT handle (the caller hops)", async () => {
    const ref = await getLiveProjectFrom(
      rpcClient({ project_id: "proj-1", handle: "newdex" }),
      "olddex",
    );
    expect(ref).toEqual({ projectId: "proj-1", handle: "newdex" });
    expect(ref?.handle).not.toBe("olddex");
  });

  test("no row (unknown value or a draft) answers null", async () => {
    expect(await getLiveProjectFrom(rpcClient(null), "nope")).toBeNull();
  });

  test("a failed read answers null — fail-closed, never a guess", async () => {
    expect(
      await getLiveProjectFrom(rpcClient(null, { message: "boom" }), "dex"),
    ).toBeNull();
  });

  test("malformed rows answer null", async () => {
    expect(await getLiveProjectFrom(rpcClient({}), "dex")).toBeNull();
    expect(
      await getLiveProjectFrom(rpcClient({ project_id: "" }, null), "dex"),
    ).toBeNull();
    expect(
      await getLiveProjectFrom(
        rpcClient({ project_id: "proj-1", handle: 42 }),
        "dex",
      ),
    ).toBeNull();
    expect(await getLiveProjectFrom(rpcClient([]), "dex")).toBeNull();
    expect(await getLiveProjectFrom(rpcClient("dex"), "dex")).toBeNull();
  });
});

describe("liveProjectExistsFrom", () => {
  test("true for a served value, false otherwise", async () => {
    expect(
      await liveProjectExistsFrom(
        rpcClient({ project_id: "p", handle: "dex" }),
        "dex",
      ),
    ).toBe(true);
    expect(await liveProjectExistsFrom(rpcClient(null), "dex")).toBe(false);
    expect(
      await liveProjectExistsFrom(rpcClient(null, { message: "x" }), "dex"),
    ).toBe(false);
  });
});
