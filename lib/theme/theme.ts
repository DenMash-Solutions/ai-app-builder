export const THEMES = {
  light: "light",
  dark: "dark",
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

export const THEME_STORAGE_KEY = "genui-theme";

const listeners = new Set<() => void>();

function isTheme(value: unknown): value is Theme {
  return value === THEMES.light || value === THEMES.dark;
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage unavailable — fall back to light.
  }
  return THEMES.light;
}

let current: Theme =
  typeof window === "undefined" ? THEMES.light : readStoredTheme();

/** Client snapshot for useSyncExternalStore. */
export function getTheme(): Theme {
  return current;
}

/** Server snapshot — the client re-renders with the stored theme after hydration. */
export function getServerTheme(): Theme {
  return THEMES.light;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Theme is an external system beside React state: persist it and sync the
 * `dark` class on <html> in the same step (no effect round trip).
 */
export function setTheme(next: Theme): void {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Quota exceeded or storage unavailable — theme stays for this session.
  }
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle(
      THEMES.dark,
      next === THEMES.dark,
    );
  }
  for (const listener of listeners) listener();
}

export function toggleTheme(): void {
  setTheme(current === THEMES.dark ? THEMES.light : THEMES.dark);
}

/**
 * Re-sync the `dark` class on <html> from storage. The pre-paint script sets
 * it during parsing, but React's dev Strict Mode remount resets attributes it
 * manages from JSX (including className) — call this before paint to restore.
 */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(
    THEMES.dark,
    readStoredTheme() === THEMES.dark,
  );
}
