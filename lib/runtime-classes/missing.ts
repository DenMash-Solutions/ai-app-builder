/**
 * Session store of class tokens the runtime compiler reported as having no
 * emitted rule (invalid utility names). The compile hook publishes; the
 * editor's className token rows subscribe and badge them.
 */
const missing = new Set<string>();
const listeners = new Set<() => void>();

export function reportMissing(tokens: readonly string[]): void {
  let changed = false;
  for (const token of tokens) {
    if (!missing.has(token)) {
      missing.add(token);
      changed = true;
    }
  }
  if (changed) {
    for (const listener of listeners) listener();
  }
}

export function getMissing(): ReadonlySet<string> {
  return missing;
}

export function subscribeMissing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
