import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  RATE_LIMIT_PATTERN,
  findModel,
  isAvailableModel,
  resolveModel,
} from "./models";

type ModelStoreModule = typeof import("./model-store");

let store: ModelStoreModule;
let storage: Map<string, string>;

describe("models", () => {
  test("contains eight curated models with unique ids", () => {
    expect(AVAILABLE_MODELS).toHaveLength(8);
    const ids = new Set(AVAILABLE_MODELS.map((model) => model.id));
    expect(ids.size).toBe(AVAILABLE_MODELS.length);
  });

  test("resolveModel keeps valid ids and falls back otherwise", () => {
    expect(resolveModel("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(resolveModel("gpt-4o")).toBe(DEFAULT_MODEL_ID);
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL_ID);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL_ID);
    expect(resolveModel(42)).toBe(DEFAULT_MODEL_ID);
  });

  test("isAvailableModel narrows only known ids", () => {
    expect(isAvailableModel("gemini-3.8-flash")).toBe(true);
    expect(isAvailableModel("gemini-999-ultra")).toBe(false);
    expect(isAvailableModel(undefined)).toBe(false);
  });

  test("findModel returns the record for every catalog id", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(findModel(model.id).label).toBe(model.label);
    }
  });

  test("RATE_LIMIT_PATTERN matches quota failures", () => {
    expect(
      RATE_LIMIT_PATTERN.test("Rate limit reached for gemini-3.8-flash"),
    ).toBe(true);
    expect(RATE_LIMIT_PATTERN.test("429 Too Many Requests")).toBe(true);
    expect(
      RATE_LIMIT_PATTERN.test("Google Generative AI Error: RESOURCE_EXHAUSTED"),
    ).toBe(true);
    expect(RATE_LIMIT_PATTERN.test("daily quota exhausted")).toBe(true);
    expect(RATE_LIMIT_PATTERN.test("internal server error")).toBe(false);
    expect(RATE_LIMIT_PATTERN.test("boom")).toBe(false);
  });
});

describe("model store", () => {
  let hydratedAtImport: string;

  beforeAll(async () => {
    storage = new Map();
    storage.set("genui-model", "gemini-3.7-flash");
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
    store = await import("./model-store");
    hydratedAtImport = store.getModel();
  });

  beforeEach(() => {
    storage.clear();
    store.setModel(DEFAULT_MODEL_ID);
  });

  test("hydrates the persisted model on load", () => {
    expect(hydratedAtImport).toBe("gemini-3.7-flash");
  });

  test("server snapshot stays on the default model", () => {
    store.setModel("gemini-3.5-flash-lite");
    expect(store.getServerModel()).toBe(DEFAULT_MODEL_ID);
  });

  test("setModel persists and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = store.subscribeModel(() => {
      notified += 1;
    });

    store.setModel("gemini-3.5-flash-lite");
    expect(store.getModel()).toBe("gemini-3.5-flash-lite");
    expect(storage.get(store.MODEL_STORAGE_KEY)).toBe("gemini-3.5-flash-lite");
    expect(notified).toBe(1);

    store.setModel("gemini-3.5-flash-lite");
    expect(notified).toBe(1);

    unsubscribe();
  });
});
