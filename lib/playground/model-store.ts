import { DEFAULT_MODEL_ID, isAvailableModel, type ModelId } from "./models";

export const MODEL_STORAGE_KEY = "genui-model";

const listeners = new Set<() => void>();

function readStoredModel(): ModelId {
  try {
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (isAvailableModel(stored)) return stored;
  } catch {
    // Storage unavailable — fall back to the default model.
  }
  return DEFAULT_MODEL_ID;
}

let current: ModelId =
  typeof window === "undefined" ? DEFAULT_MODEL_ID : readStoredModel();

/** Client snapshot for useSyncExternalStore. */
export function getModel(): ModelId {
  return current;
}

/** Server snapshot — the client re-renders with the stored model after hydration. */
export function getServerModel(): ModelId {
  return DEFAULT_MODEL_ID;
}

export function subscribeModel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persist the selected model and notify subscribers. */
export function setModel(next: ModelId): void {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, next);
  } catch {
    // Quota exceeded or storage unavailable — selection stays for this session.
  }
  for (const listener of listeners) listener();
}
