/**
 * Device-preview selection (plan 059): which viewport preset the canvas renders
 * in. Responsive (the default) renders inline and follows the browser window;
 * the other presets mount a device frame with a true CSS viewport (see
 * `device-frame.tsx`) — Desktop is a fixed 1440×900 artboard, so resizing the
 * window never reflows it (the stage scrolls instead, scope change 2026-10-27).
 *
 * Follows the `model-store.ts` module-store pattern: `getServerDevicePreview()`
 * returns the default so SSR/hydration never mismatches, and localStorage is
 * best-effort (quota/unavailable → selection stays for the session).
 */

export const DEVICE_PREVIEW_STORAGE_KEY = "genui-device-preview";

/** Preset dimensions in CSS px. `null` = state-driven (responsive fills the window, custom reads the state). */
export const DEVICE_PRESETS = {
  responsive: { width: null, height: null },
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  custom: { width: null, height: null },
} as const;

export type DevicePresetKey = keyof typeof DEVICE_PRESETS;

/** Picker display order. */
export const DEVICE_PRESET_ORDER: readonly DevicePresetKey[] = [
  "responsive",
  "desktop",
  "mobile",
  "tablet",
  "custom",
];

export const DEVICE_MIN_SIZE = 320;
export const DEVICE_MAX_SIZE = 4096;

/** Manual zoom steps in percent (plan 059 step 2). `null` zoom = fit-to-screen. */
export const ZOOM_STEPS = [50, 75, 100, 125, 150] as const;
export type ZoomStep = (typeof ZOOM_STEPS)[number];

export interface DevicePreviewState {
  preset: DevicePresetKey;
  /** Custom preset viewport, clamped to [DEVICE_MIN_SIZE, DEVICE_MAX_SIZE]. */
  customWidth: number;
  customHeight: number;
  /** Manual zoom percent (a ZOOM_STEPS entry) or null = fit-to-screen (default). */
  zoom: number | null;
}

export const DEFAULT_DEVICE_PREVIEW: DevicePreviewState = {
  preset: "responsive",
  customWidth: 420,
  customHeight: 900,
  zoom: null,
};

export function isDevicePresetKey(value: unknown): value is DevicePresetKey {
  return typeof value === "string" && Object.hasOwn(DEVICE_PRESETS, value);
}

export function clampDeviceSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(
    DEVICE_MAX_SIZE,
    Math.max(DEVICE_MIN_SIZE, Math.round(value)),
  );
}

function validateZoom(value: unknown): number | null {
  if (value === null || value === undefined) return DEFAULT_DEVICE_PREVIEW.zoom;
  return typeof value === "number" &&
    (ZOOM_STEPS as readonly number[]).includes(value)
    ? value
    : DEFAULT_DEVICE_PREVIEW.zoom;
}

function validate(raw: Partial<DevicePreviewState>): DevicePreviewState {
  return {
    preset: isDevicePresetKey(raw.preset)
      ? raw.preset
      : DEFAULT_DEVICE_PREVIEW.preset,
    customWidth: clampDeviceSize(
      raw.customWidth,
      DEFAULT_DEVICE_PREVIEW.customWidth,
    ),
    customHeight: clampDeviceSize(
      raw.customHeight,
      DEFAULT_DEVICE_PREVIEW.customHeight,
    ),
    zoom: validateZoom(raw.zoom),
  };
}

function readStored(): DevicePreviewState {
  try {
    const stored = window.localStorage.getItem(DEVICE_PREVIEW_STORAGE_KEY);
    if (!stored) return DEFAULT_DEVICE_PREVIEW;
    return validate(JSON.parse(stored) as Partial<DevicePreviewState>);
  } catch {
    // Unreadable/corrupt value — fall back to the defaults.
    return DEFAULT_DEVICE_PREVIEW;
  }
}

const listeners = new Set<() => void>();

let current: DevicePreviewState =
  typeof window === "undefined" ? DEFAULT_DEVICE_PREVIEW : readStored();

/** Client snapshot for `useSyncExternalStore`. */
export function getDevicePreview(): DevicePreviewState {
  return current;
}

/** Server snapshot — the client re-renders with the stored preset after hydration. */
export function getServerDevicePreview(): DevicePreviewState {
  return DEFAULT_DEVICE_PREVIEW;
}

export function subscribeDevicePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merge a partial update, validate, persist, and notify subscribers. */
export function setDevicePreview(next: Partial<DevicePreviewState>): void {
  const resolved = validate({ ...current, ...next });
  if (
    resolved.preset === current.preset &&
    resolved.customWidth === current.customWidth &&
    resolved.customHeight === current.customHeight &&
    resolved.zoom === current.zoom
  ) {
    return;
  }
  current = resolved;
  try {
    window.localStorage.setItem(
      DEVICE_PREVIEW_STORAGE_KEY,
      JSON.stringify(current),
    );
  } catch {
    // Quota exceeded or storage unavailable — selection stays for this session.
  }
  for (const listener of listeners) listener();
}

export interface DeviceFrameSize {
  width: number;
  height: number;
}

/**
 * Effective frame scale (plan 059 step 2, R5 policy): fit and fixed percent
 * are mutually exclusive modes. Fit = `min(stage / device)` from the
 * UNSCALED stage content box (the transform never feeds back into layout,
 * so the ResizeObserver can't loop); a fixed percent applies directly.
 * Pure so the math is unit-testable; degenerate inputs fall back to 1:1.
 */
export function computeFrameScale(
  zoom: number | null,
  stageWidth: number,
  stageHeight: number,
  deviceWidth: number,
  deviceHeight: number,
): number {
  if (
    !Number.isFinite(stageWidth) ||
    !Number.isFinite(stageHeight) ||
    !Number.isFinite(deviceWidth) ||
    !Number.isFinite(deviceHeight) ||
    stageWidth <= 0 ||
    stageHeight <= 0 ||
    deviceWidth <= 0 ||
    deviceHeight <= 0
  ) {
    return 1;
  }
  if (zoom === null) {
    return Math.min(stageWidth / deviceWidth, stageHeight / deviceHeight);
  }
  return zoom / 100;
}

/**
 * Viewport the frame must render at, or `null` when the canvas renders inline
 * (Responsive — no iframe at all, per design decision 2 as revised 2026-10-27).
 */
export function deviceFrameSize(
  state: DevicePreviewState,
): DeviceFrameSize | null {
  if (state.preset === "responsive") return null;
  if (state.preset === "custom") {
    return { width: state.customWidth, height: state.customHeight };
  }
  const preset = DEVICE_PRESETS[state.preset];
  // Non-desktop presets are fixed-size by construction; the null branch only
  // guards against a future state-driven preset being added without updating
  // this function.
  if (preset.width === null || preset.height === null) return null;
  return { width: preset.width, height: preset.height };
}
