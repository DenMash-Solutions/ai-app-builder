import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ComponentTemplate } from "./templates";
import type { Spec } from "@json-render/core";

type TemplatesModule = typeof import("./templates");

let store: TemplatesModule;
let storage: Map<string, string>;
/** Library stored before the module was imported — proves hydration + sanitizing. */
let hydratedAtImport: ComponentTemplate[];

const readRaw = (): unknown => {
  const raw = storage.get("genui-component-templates");
  return raw ? (JSON.parse(raw) as unknown) : null;
};

/** A valid stored template plus entries that must be filtered out on hydration. */
const VALID_ENTRY = {
  id: "tpl-1",
  name: "Hero",
  createdAt: 1,
  subtree: {
    rootKey: "card-1",
    elements: { "card-1": { type: "Card", props: {} } },
  },
};

function makeSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["stack-1"] },
      "stack-1": {
        type: "Stack",
        props: { direction: "vertical" },
        children: ["text-1"],
        slots: { footer: ["button-1"] },
        visible: { $state: "/show", eq: true },
        on: { click: { action: "noop" } },
      },
      "text-1": {
        type: "Text",
        props: { text: "Body" },
        repeat: { statePath: "/items", key: "id" },
      },
      "button-1": { type: "Button", props: { label: "Go" } },
    },
  };
}

describe("template library store", () => {
  beforeAll(async () => {
    storage = new Map();
    storage.set(
      "genui-component-templates",
      JSON.stringify([
        VALID_ENTRY,
        // Junk the sanitizer must drop: missing subtree, rootKey not in
        // elements, non-object entry, empty id.
        { id: "bad", name: "No subtree", createdAt: 2 },
        {
          id: "bad-2",
          name: "Root missing",
          createdAt: 3,
          subtree: { rootKey: "ghost", elements: {} },
        },
        "not-an-object",
        {
          id: "",
          name: "Empty id",
          createdAt: 4,
          subtree: { rootKey: "a", elements: { a: { type: "Card" } } },
        },
      ]),
    );
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    (globalThis as { window?: unknown }).window = {
      localStorage: localStorageMock,
    } as unknown as Window & typeof globalThis;
    // Cache-busted: another test file may have imported `lib/editor/templates`
    // (via the `@/lib/editor` barrel) before this storage was seeded, which
    // would hand back the already-hydrated (empty) instance.
    const hydratedSpecifier = "./templates.ts?hydrated";
    store = (await import(hydratedSpecifier)) as TemplatesModule;
    hydratedAtImport = store.getTemplates();
  });

  beforeEach(() => {
    // Reset the module store to an empty library through its own API.
    for (const template of store.getTemplates()) {
      store.removeTemplate(template.id);
    }
    storage.clear();
  });

  test("hydration keeps only valid entries — junk never reaches the UI", () => {
    expect(hydratedAtImport).toHaveLength(1);
    expect(hydratedAtImport[0].id).toBe("tpl-1");
    expect(hydratedAtImport[0].name).toBe("Hero");
    expect(store.getTemplates()).toHaveLength(0);
    expect(store.getServerTemplates()).toEqual([]);
  });

  test("corrupt stored JSON falls back to an empty library", async () => {
    storage.set("genui-component-templates", "not json at all");
    // Cache-busted import — a fresh module instance re-reads storage.
    const specifier = "./templates.ts?corrupt";
    const fresh = (await import(specifier)) as TemplatesModule;
    expect(fresh.getTemplates()).toEqual([]);
    // And a write still works over the corrupt value.
    const saved = fresh.saveTemplate("Recovered", makeSpec(), "text-1");
    expect(saved).not.toBeNull();
    expect(
      JSON.parse(storage.get("genui-component-templates") ?? "[]"),
    ).toHaveLength(1);
  });

  test("save snapshots the subtree, detached from the source spec", () => {
    const spec = makeSpec();
    const saved = store.saveTemplate("  Nested card  ", spec, "stack-1");
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe("Nested card"); // trimmed
    expect(saved?.id).toBeTypeOf("string");
    expect(saved?.id).not.toBe("");
    expect(saved?.createdAt).toBeTypeOf("number");

    // Exactly root + children + slot members, deep-cloned with every field.
    expect(Object.keys(saved!.subtree.elements).sort()).toEqual([
      "button-1",
      "stack-1",
      "text-1",
    ]);
    expect(saved!.subtree.rootKey).toBe("stack-1");
    expect(saved!.subtree.elements["stack-1"]).toEqual(
      spec.elements["stack-1"],
    );
    expect(saved!.subtree.elements["text-1"]).toEqual(spec.elements["text-1"]);

    // Detachment: mutating the source never touches the saved template.
    spec.elements["text-1"].props.text = "Changed";
    spec.elements["stack-1"].children!.push("button-1");
    expect(saved!.subtree.elements["text-1"].props.text).toBe("Body");
    expect(saved!.subtree.elements["stack-1"].children).toEqual(["text-1"]);
  });

  test("save rejects empty names and unknown keys, persists valid ones", () => {
    const spec = makeSpec();
    expect(store.saveTemplate("   ", spec, "text-1")).toBeNull();
    expect(store.saveTemplate("Name", spec, "ghost")).toBeNull();
    expect(store.getTemplates()).toHaveLength(0);

    let notified = 0;
    const unsubscribe = store.subscribeTemplates(() => {
      notified += 1;
    });
    const saved = store.saveTemplate("Card", spec, "root")!;
    expect(store.getTemplates()).toHaveLength(1);
    expect(notified).toBe(1);
    expect(readRaw()).toBeInstanceOf(Array);
    expect((readRaw() as ComponentTemplate[])[0].id).toBe(saved.id);
    unsubscribe();
  });

  test("rename updates name and persistence; empty/unknown are no-ops", () => {
    const saved = store.saveTemplate("First", makeSpec(), "text-1")!;
    store.renameTemplate(saved.id, "  Renamed  ");
    expect(store.getTemplates()[0].name).toBe("Renamed");
    expect((readRaw() as ComponentTemplate[])[0].name).toBe("Renamed");

    store.renameTemplate(saved.id, "   ");
    expect(store.getTemplates()[0].name).toBe("Renamed");
    store.renameTemplate("nope", "Ignored");
    expect(store.getTemplates()).toHaveLength(1);
  });

  test("remove drops the template and notifies subscribers", () => {
    const saved = store.saveTemplate("Doomed", makeSpec(), "text-1")!;
    let notified = 0;
    const unsubscribe = store.subscribeTemplates(() => {
      notified += 1;
    });
    store.removeTemplate(saved.id);
    expect(store.getTemplates()).toHaveLength(0);
    expect(readRaw()).toEqual([]);
    expect(notified).toBe(1);
    // Unknown id → no write, no notification.
    store.removeTemplate("nope");
    expect(notified).toBe(1);
    unsubscribe();
  });
});
