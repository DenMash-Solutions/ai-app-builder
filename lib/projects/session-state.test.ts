import { describe, expect, test } from "bun:test";
import { createLocalStorageAdapter } from "@/lib/data-sources/local-storage-adapter";
import type { NamedResourceDef } from "@/lib/data-sources/types";
import { dataNamespaceFor, omitSessionState } from "./session-state";

/** Map-backed Storage double — adapters take storage by injection (no DOM). */
function fakeStorage(): Storage {
  const raw = new Map<string, string>();
  return {
    getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => {
      raw.set(key, value);
    },
    removeItem: (key: string) => {
      raw.delete(key);
    },
    clear: () => raw.clear(),
    key: (index: number) => [...raw.keys()][index] ?? null,
    get length() {
      return raw.size;
    },
  } as Storage;
}

describe("omitSessionState (061-4, A3 seed side)", () => {
  test("strips session so the provider's diff deletes it on every screen change", () => {
    const base = { locale: "en", session: { stale: "from spec" } };
    const seed = omitSessionState(base);
    expect("session" in seed).toBe(false);
    expect(seed.locale).toBe("en");
  });

  test("returns a copy — the spec's own state is never mutated", () => {
    const base = { draft: "local", session: { token: "t" } };
    const seed = omitSessionState(base);
    expect(seed).not.toBe(base);
    expect(base.session).toEqual({ token: "t" });
    expect(seed).toEqual({ draft: "local" });
  });

  test("a seed without session comes back as a copy", () => {
    const base = { page: 2 };
    const seed = omitSessionState(base);
    expect(seed).not.toBe(base);
    expect(seed).toEqual({ page: 2 });
  });
});

describe("dataNamespaceFor (061-4, A3 data side)", () => {
  test("project screens namespace their records by project id", () => {
    expect(dataNamespaceFor({ projectId: "proj-1" }, "entry-id")).toBe(
      "proj-1",
    );
    // The entry id / slug fallback is ignored whenever a project is present.
    expect(dataNamespaceFor({ projectId: "proj-1" }, "slug")).toBe("proj-1");
  });

  test("project-less screens keep the caller's per-screen fallback (043 D6)", () => {
    expect(dataNamespaceFor({ projectId: null }, "slug")).toBe("slug");
    expect(dataNamespaceFor(null, "slug")).toBe("slug");
    expect(dataNamespaceFor(undefined, "slug")).toBe("slug");
    expect(dataNamespaceFor({}, "entry-id")).toBe("entry-id");
  });
});

describe("project data namespace contract (067 decision 3)", () => {
  const resource: NamedResourceDef = {
    name: "cart",
    dataSource: "localCart",
    schema: { title: "string" },
  };

  test("two screens of one project share the namespace; two projects never do", () => {
    const screenA = { projectId: "proj-a" };
    const screenB = { projectId: "proj-a" };
    const otherProject = { projectId: "proj-b" };

    expect(dataNamespaceFor(screenA, "entry-a")).toBe(
      dataNamespaceFor(screenB, "entry-b"),
    );
    // The entry fallback never leaks in once a project owns the screen.
    expect(dataNamespaceFor(screenA, "entry-a")).not.toBe("entry-a");
    expect(dataNamespaceFor(screenA, "entry-a")).not.toBe(
      dataNamespaceFor(otherProject, "entry-c"),
    );
  });

  test("records written through one project's namespace are invisible to another", async () => {
    const storage = fakeStorage();
    const adapterFor = (namespace: string) =>
      createLocalStorageAdapter(
        { provider: "localStorage", config: {} },
        { namespace },
        () => storage,
      );
    const projectA = adapterFor(
      dataNamespaceFor({ projectId: "proj-a" }, "entry-a"),
    );
    const projectB = adapterFor(
      dataNamespaceFor({ projectId: "proj-b" }, "entry-b"),
    );
    await projectA.initialize();
    await projectB.initialize();

    await projectA.create(resource, { title: "written on A" });

    expect(await projectA.list(resource)).toHaveLength(1);
    expect(await projectB.list(resource)).toHaveLength(0);
  });
});
