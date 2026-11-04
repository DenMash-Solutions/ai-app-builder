import { describe, expect, test } from "bun:test";
import {
  localDataKeyPrefix,
  purgeLocalProjectData,
  purgeRemoteProjectData,
  type ProjectDataPurgeClient,
  type PurgeStorage,
} from "./purge-data";

/** In-memory Web Storage with the same contract as `localStorage`. */
function makeStorage(initial: Record<string, string> = {}): PurgeStorage & {
  keys(): string[];
} {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

/** Records the delete scope it was asked for. */
function makePurgeClient(
  error: { message: string } | null = null,
): ProjectDataPurgeClient & { deleted: { table: string; column: string; value: string }[] } {
  const deleted: { table: string; column: string; value: string }[] = [];
  return {
    deleted,
    from: (table) => ({
      delete: () => ({
        eq: (column, value) => {
          deleted.push({ table, column, value });
          return Promise.resolve({ error });
        },
      }),
    }),
  };
}

describe("project data purge (067 decisions 2-4)", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";

  test("local purge removes this project's rows and nothing else", () => {
    const prefix = localDataKeyPrefix(projectId);
    expect(prefix).toBe(`genui-data:${projectId}:`);
    const storage = makeStorage({
      [`${prefix}cart`]: "[1]",
      [`${prefix}orders`]: "[]",
      [`genui-data:${otherId}:cart`]: "[2]",
      [`genui-data:slug-only:cart`]: "[3]",
      "genui-history": "[]",
    });

    expect(purgeLocalProjectData(projectId, storage)).toBe(2);
    expect(storage.keys()).toEqual([
      `genui-data:${otherId}:cart`,
      "genui-data:slug-only:cart",
      "genui-history",
    ]);
  });

  test("local purge without storage (SSR, blocked browser) is a no-op", () => {
    expect(purgeLocalProjectData(projectId, null)).toBe(0);
  });

  test("remote purge deletes only the project's app_id and reports acceptance", async () => {
    const client = makePurgeClient();
    expect(await purgeRemoteProjectData(projectId, client)).toBe(true);
    expect(client.deleted).toEqual([
      { table: "genui_records", column: "app_id", value: projectId },
    ]);
  });

  test("a refused or throwing remote purge resolves false, never throws", async () => {
    expect(
      await purgeRemoteProjectData(projectId, makePurgeClient({ message: "rls" })),
    ).toBe(false);

    const throwing: ProjectDataPurgeClient = {
      from: () => {
        throw new Error("network down");
      },
    };
    expect(await purgeRemoteProjectData(projectId, throwing)).toBe(false);
  });
});
