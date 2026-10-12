import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

// `useSyncExternalStore` instead of the stock setState-in-effect hook — the
// media query is the external store; server snapshot is desktop (false).
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
