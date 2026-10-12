/**
 * Return path for post-auth navigation (`?next=…`, e.g. from the `/admin`
 * guard). Only same-site absolute paths qualify — an external URL or a
 * protocol-relative `//host` falls back to the default destination.
 * Read from `window` at call time: `useSearchParams` would force the auth
 * pages into a Suspense-wrapped CSR bailout for no benefit.
 */
export function safeNextPath(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
