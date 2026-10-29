/**
 * Cross-realm element guard (plan 059 R3).
 *
 * The canvas layers (scroller, pick/x-ray/dnd overlays, hover badge) travel
 * together into the device frame's document, so event targets that originate
 * there belong to the IFRAME's realm. `target instanceof Element` tests
 * against the parent window's constructor and is therefore `false` for those
 * nodes — a guard written that way silently disables the listener whenever the
 * canvas lives in a frame. Duck-type on `closest` instead: it exists on every
 * `Element`, in every realm, and works cross-realm when called (methods are
 * looked up on the node's own prototype).
 *
 * Mirrors the existing `container.ownerDocument.elementFromPoint` pattern for
 * realm-correct globals (R3): keep the check on the node, not on the window
 * that created it.
 */
export function asElement(target: EventTarget | null): Element | null {
  if (target !== null && typeof (target as Element).closest === "function") {
    return target as Element;
  }
  return null;
}
