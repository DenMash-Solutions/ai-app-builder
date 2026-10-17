import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

type SpecThemeModule = typeof import("./spec-theme");
type ThemeModule = typeof import("./theme");

let specTheme: SpecThemeModule;
let theme: ThemeModule;
let storage: Map<string, string>;
let htmlClassList: Set<string>;

beforeAll(async () => {
  storage = new Map();
  htmlClassList = new Set();
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
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      classList: {
        add: (name: string) => {
          htmlClassList.add(name);
        },
        remove: (name: string) => {
          htmlClassList.delete(name);
        },
        toggle: (name: string, force?: boolean) => {
          if (force) htmlClassList.add(name);
          else htmlClassList.delete(name);
        },
      },
    },
  };
  theme = await import("./theme");
  specTheme = await import("./spec-theme");
});

beforeEach(() => {
  storage.clear();
  htmlClassList.clear();
});

describe("spec theme state convention", () => {
  test("reads a valid seeded theme and rejects everything else", () => {
    expect(specTheme.specTheme({ theme: "dark" })).toBe("dark");
    expect(specTheme.specTheme({ theme: "light" })).toBe("light");
    expect(specTheme.specTheme({ theme: "blue" })).toBeNull();
    expect(specTheme.specTheme({})).toBeNull();
    expect(specTheme.specTheme(null)).toBeNull();
    expect(specTheme.specTheme(undefined)).toBeNull();
  });

  test("reads the visitor's stored decision from the app's theme key", () => {
    expect(specTheme.readStoredDecision()).toBeNull();
    storage.set(theme.THEME_STORAGE_KEY, "dark");
    expect(specTheme.readStoredDecision()).toBe("dark");
    storage.set(theme.THEME_STORAGE_KEY, "junk");
    expect(specTheme.readStoredDecision()).toBe("junk");
  });

  test("effective theme: stored decision > spec default > light", () => {
    expect(specTheme.effectiveTheme("dark", "light")).toBe("dark");
    expect(specTheme.effectiveTheme("light", "dark")).toBe("light");
    expect(specTheme.effectiveTheme(null, "dark")).toBe("dark");
    expect(specTheme.effectiveTheme(null, null)).toBe("light");
    // A junk stored value is no decision.
    expect(specTheme.effectiveTheme("blue", "dark")).toBe("dark");
  });
});

describe("public theme persistence", () => {
  test("persists the decision to the theme key and applies it to <html>", () => {
    specTheme.persistThemeDecision("dark");
    expect(storage.get(theme.THEME_STORAGE_KEY)).toBe("dark");
    expect(htmlClassList.has("dark")).toBe(true);

    specTheme.persistThemeDecision("light");
    expect(storage.get(theme.THEME_STORAGE_KEY)).toBe("light");
    expect(htmlClassList.has("dark")).toBe(false);
  });

  test("persists even when the app's own snapshot already matches (setTheme would early-return)", () => {
    // Spec default dark applied pre-paint, visitor picks light: `current` is
    // still light (nothing was stored), so setTheme would no-op — the very
    // decision that must stick.
    specTheme.persistThemeDecision("light");
    expect(storage.get(theme.THEME_STORAGE_KEY)).toBe("light");
  });
});

describe("pre-paint spec-default script", () => {
  test("applies the dark default only when no decision is stored", () => {
    const script = specTheme.specThemeInitScript("dark");
    expect(script).toContain(theme.THEME_STORAGE_KEY);
    expect(script).toContain('"dark"');
    expect(script).toContain("classList.add");
    expect(script).toContain("getItem");
  });

  test("no dark default → nothing to run (light is the page default)", () => {
    expect(specTheme.specThemeInitScript("light")).toBe("");
    expect(specTheme.specThemeInitScript(null)).toBe("");
  });
});
