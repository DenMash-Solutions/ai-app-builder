import { beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  GLOBAL_LANG_KEY,
  copyWriteTarget,
  hasOverlayLayer,
  readPersistedContentLang,
  resolveContentLang,
  writeContentLang,
} from "./content-lang";

const spec: Spec = {
  root: "a",
  elements: { a: { type: "Heading", props: {} } },
  state: {
    locale: "en",
    copy: { title: "Hello" },
    i18n: { es: { title: "Hola" } },
  },
};

const seedlessSpec: Spec = {
  root: "a",
  elements: { a: { type: "Heading", props: {} } },
  state: { locale: "en", copy: { title: "Hello" } },
};

let storage: Map<string, string>;

function mockWindow() {
  storage = new Map();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  } as unknown as Window & typeof globalThis;
}

describe("content-lang storage", () => {
  beforeEach(mockWindow);

  test("read falls back per-entry → global → null", () => {
    expect(readPersistedContentLang("e1")).toBeNull();
    storage.set(GLOBAL_LANG_KEY, "es");
    expect(readPersistedContentLang("e1")).toBe("es");
    storage.set("genui-editor-lang:e1", "fr");
    expect(readPersistedContentLang("e1")).toBe("fr");
    expect(readPersistedContentLang("other")).toBe("es");
    expect(readPersistedContentLang(null)).toBe("es");
  });

  test("write persists global + per-entry", () => {
    writeContentLang("e1", "es");
    expect(storage.get(GLOBAL_LANG_KEY)).toBe("es");
    expect(storage.get("genui-editor-lang:e1")).toBe("es");
    expect(readPersistedContentLang("e2")).toBe("es");
    expect(readPersistedContentLang("e1")).toBe("es");
  });
});

describe("resolveContentLang", () => {
  beforeEach(mockWindow);

  test("no spec → en; spec without stored choice → seed", () => {
    expect(resolveContentLang(null, null)).toBe("en");
    expect(resolveContentLang(seedlessSpec, "e1")).toBe("en");
  });

  test("override wins, then persisted, then seed", () => {
    expect(resolveContentLang(spec, "e1", "es")).toBe("es");
    storage.set(GLOBAL_LANG_KEY, "es");
    expect(resolveContentLang(spec, "e1")).toBe("es");
  });

  test("stale tags fall through to the seed", () => {
    storage.set(GLOBAL_LANG_KEY, "de");
    expect(resolveContentLang(spec, "e1")).toBe("en");
    expect(resolveContentLang(spec, "e1", "pt")).toBe("en");
    // A stale override does not mask a valid persisted tag.
    storage.set(GLOBAL_LANG_KEY, "es");
    expect(resolveContentLang(spec, "e1", "de")).toBe("es");
  });
});

describe("copyWriteTarget", () => {
  test("seed-language copy edits write through to state.copy", () => {
    expect(copyWriteTarget("/copy/title", "en", "en")).toBe("/copy/title");
  });

  test("non-seed copy edits redirect to the i18n overlay", () => {
    expect(copyWriteTarget("/copy/title", "es", "en")).toBe("/i18n/es/title");
  });

  test("non-copy paths are never redirected", () => {
    expect(copyWriteTarget("/auth/email", "es", "en")).toBe("/auth/email");
    expect(copyWriteTarget("/checks/required", "es", "en")).toBe(
      "/checks/required",
    );
  });
});

describe("hasOverlayLayer", () => {
  const withOverlay: Spec["state"] = {
    locale: "en",
    copy: { title: "Hello" },
    i18n: { es: { title: "Hola" }, fr: {} },
  };

  test("false for a language with no overlay", () => {
    expect(hasOverlayLayer(withOverlay, "de")).toBe(false);
    expect(hasOverlayLayer(undefined, "es")).toBe(false);
    expect(hasOverlayLayer({ locale: "en" }, "es")).toBe(false);
  });

  test("false for an empty overlay layer, true when it has keys", () => {
    expect(hasOverlayLayer(withOverlay, "fr")).toBe(false);
    expect(hasOverlayLayer(withOverlay, "es")).toBe(true);
  });
});
