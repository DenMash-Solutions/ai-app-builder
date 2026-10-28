import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DevicePreviewState } from "./device-preview";

type DevicePreviewModule = typeof import("./device-preview");

let store: DevicePreviewModule;
let storage: Map<string, string>;
/** Preset stored before the module was imported — proves hydration + validation. */
let hydratedAtImport: DevicePreviewState;

const readRaw = (): Record<string, unknown> | null => {
  const raw = storage.get(store.DEVICE_PREVIEW_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

describe("device preview store", () => {
  beforeAll(async () => {
    storage = new Map();
    // Valid-but-fully-custom payload, including an out-of-range size that
    // validation must clamp on the way in.
    storage.set(
      "genui-device-preview",
      JSON.stringify({
        preset: "custom",
        customWidth: 12,
        customHeight: 1400,
      }),
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
    store = await import("./device-preview");
    hydratedAtImport = store.getDevicePreview();
  });

  beforeEach(() => {
    storage.clear();
    store.setDevicePreview({ ...store.DEFAULT_DEVICE_PREVIEW });
    storage.clear();
  });

  test("hydrates the persisted preset and clamps on the way in", () => {
    expect(hydratedAtImport.preset).toBe("custom");
    expect(hydratedAtImport.customWidth).toBe(store.DEVICE_MIN_SIZE);
    expect(hydratedAtImport.customHeight).toBe(1400);
  });

  test("defaults to responsive — no frame, inline canvas", () => {
    expect(store.getDevicePreview()).toEqual(store.DEFAULT_DEVICE_PREVIEW);
    expect(store.getDevicePreview().preset).toBe("responsive");
    expect(store.deviceFrameSize(store.getDevicePreview())).toBeNull();
    expect(store.getServerDevicePreview()).toEqual(
      store.DEFAULT_DEVICE_PREVIEW,
    );
  });

  test("fixed presets map to their device viewport", () => {
    const base = store.DEFAULT_DEVICE_PREVIEW;
    // Desktop is a fixed artboard (not the window) — resizing the browser
    // must never reflow it (scope change 2026-10-27).
    expect(store.deviceFrameSize({ ...base, preset: "desktop" })).toEqual({
      width: 1440,
      height: 900,
    });
    expect(store.deviceFrameSize({ ...base, preset: "mobile" })).toEqual({
      width: 390,
      height: 844,
    });
    expect(store.deviceFrameSize({ ...base, preset: "tablet" })).toEqual({
      width: 768,
      height: 1024,
    });
  });

  test("custom preset reads its validated dimensions", () => {
    expect(
      store.deviceFrameSize({
        ...store.DEFAULT_DEVICE_PREVIEW,
        preset: "custom",
        customWidth: 420,
        customHeight: 900,
      }),
    ).toEqual({ width: 420, height: 900 });
  });

  test("setDevicePreview persists, notifies, and skips no-op updates", () => {
    let notified = 0;
    const unsubscribe = store.subscribeDevicePreview(() => {
      notified += 1;
    });

    store.setDevicePreview({ preset: "mobile" });
    expect(store.getDevicePreview().preset).toBe("mobile");
    expect(readRaw()?.preset).toBe("mobile");
    expect(notified).toBe(1);

    // Same value again → no write, no notification.
    store.setDevicePreview({ preset: "mobile" });
    expect(notified).toBe(1);

    unsubscribe();
    store.setDevicePreview({ preset: "tablet" });
    expect(notified).toBe(1);
    store.setDevicePreview({ preset: "desktop" });
  });

  test("validation clamps and rejects field values", () => {
    expect(store.clampDeviceSize(10, 420)).toBe(store.DEVICE_MIN_SIZE);
    expect(store.clampDeviceSize(99_999, 420)).toBe(store.DEVICE_MAX_SIZE);
    expect(store.clampDeviceSize("wide", 420)).toBe(420);
    expect(store.clampDeviceSize(Number.NaN, 900)).toBe(900);
    expect(store.isDevicePresetKey("responsive")).toBe(true);
    expect(store.isDevicePresetKey("desktop")).toBe(true);
    expect(store.isDevicePresetKey("mobile")).toBe(true);
    expect(store.isDevicePresetKey("hologram")).toBe(false);
    expect(store.isDevicePresetKey(7)).toBe(false);
  });

  test("corrupt stored JSON cannot crash reads or writes", () => {
    storage.set(store.DEVICE_PREVIEW_STORAGE_KEY, "not json at all");
    store.setDevicePreview({ preset: "mobile" });
    expect(store.getDevicePreview().preset).toBe("mobile");
    expect(readRaw()?.preset).toBe("mobile");
    store.setDevicePreview({ preset: "desktop" });
  });
});
