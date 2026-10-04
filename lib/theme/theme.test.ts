import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

type ThemeModule = typeof import("./theme");

let theme: ThemeModule;
let storage: Map<string, string>;

beforeAll(async () => {
  storage = new Map();
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
  theme = await import("./theme");
});

describe("theme store", () => {
  beforeEach(() => {
    storage.clear();
    theme.setTheme(theme.THEMES.light);
  });

  test("starts light when nothing is stored", () => {
    expect(theme.getTheme()).toBe(theme.THEMES.light);
    expect(theme.getServerTheme()).toBe(theme.THEMES.light);
  });

  test("toggling flips the theme, persists it, and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = theme.subscribeTheme(() => {
      notified += 1;
    });

    theme.toggleTheme();
    expect(theme.getTheme()).toBe(theme.THEMES.dark);
    expect(storage.get(theme.THEME_STORAGE_KEY)).toBe("dark");
    expect(notified).toBe(1);

    theme.toggleTheme();
    expect(theme.getTheme()).toBe(theme.THEMES.light);
    expect(storage.get(theme.THEME_STORAGE_KEY)).toBe("light");
    expect(notified).toBe(2);

    unsubscribe();
  });

  test("setTheme is a no-op when the theme is unchanged", () => {
    let notified = 0;
    const unsubscribe = theme.subscribeTheme(() => {
      notified += 1;
    });

    theme.setTheme(theme.THEMES.light);
    expect(notified).toBe(0);
    unsubscribe();
  });

  test("server snapshot stays light regardless of client state", () => {
    theme.setTheme(theme.THEMES.dark);
    expect(theme.getServerTheme()).toBe(theme.THEMES.light);
  });
});
