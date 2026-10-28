"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

/**
 * Device frame (plan 059 step 1): a same-origin iframe sized to the preset
 * viewport, with the canvas subtree portaled into its body.
 *
 * Lifecycle (R2): `inactive` (no frame — playground renders inline) →
 * `initializing` (this component mounted, document being configured) →
 * `ready` (document + base + mirrored styles applied → portal mounts) →
 * `disposed` (unmount — generation token invalidates pending work).
 *
 * Stylesheet mirroring (R4): delta reconcile of the parent head's
 * `<style>`/`<link rel=stylesheet>` nodes into the frame head — create missing,
 * refresh attributes/content (catches in-place CSS mutations via observer on
 * childList+subtree+characterData), drop stale, re-enforce source order after
 * `<base>`. Coalesced to one pass per animation frame; observer exists only
 * while the frame is mounted (safeguards 2–3).
 */

type FrameStatus = "initializing" | "ready" | "error";

interface DeviceFrameProps {
  width: number;
  height: number;
  /** Called with the frame's window when ready and null on teardown so the
   * playground can mirror its keydown handling into the frame (R3). */
  onFrameWindow?: (frameWindow: Window | null) => void;
  children: ReactNode;
}

const isMirrorable = (node: Element): boolean =>
  node instanceof HTMLStyleElement ||
  (node instanceof HTMLLinkElement && node.rel === "stylesheet");

interface DeviceFrameHostProps {
  /** null = Desktop (children render inline exactly as before). */
  frameSize: { width: number; height: number } | null;
  onFrameWindow?: (frameWindow: Window | null) => void;
  children: ReactNode;
}

/**
 * Renders its children inline (Desktop) or inside a device frame (any preset).
 * The canvas layers — scroller + pick/x-ray overlays — always travel together,
 * so every rect pair stays inside one document (plan 059, R3).
 */
export function DeviceFrameHost({
  frameSize,
  onFrameWindow,
  children,
}: DeviceFrameHostProps) {
  if (!frameSize) return <>{children}</>;
  return (
    <DeviceFrame
      width={frameSize.width}
      height={frameSize.height}
      onFrameWindow={onFrameWindow}
    >
      {children}
    </DeviceFrame>
  );
}

export function DeviceFrame({
  width,
  height,
  onFrameWindow,
  children,
}: DeviceFrameProps) {
  const t = useTranslations();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mirrorsRef = useRef<Map<Element, Element>>(new Map());
  const baseRef = useRef<HTMLBaseElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const rafRef = useRef(0);
  /** Bumped on every setup/teardown — pending rAF work checks it (R2). */
  const genRef = useRef(0);
  const initedGenRef = useRef(-1);
  const onFrameWindowRef = useRef(onFrameWindow);
  useEffect(() => {
    onFrameWindowRef.current = onFrameWindow;
  }, [onFrameWindow]);

  const [status, setStatus] = useState<FrameStatus>("initializing");
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);

  useLayoutEffect(() => {
    const gen = ++genRef.current;
    const iframe = iframeRef.current;
    const parentDoc = document;
    const mirrors = mirrorsRef.current;
    if (!iframe) return;

    /** Full reconcile of frame head + root attributes against the parent. */
    const sync = () => {
      if (gen !== genRef.current) return;
      const doc = iframe.contentDocument;
      const base = baseRef.current;
      if (!doc || !base?.parentNode) return;

      // 1. Drop mirrors whose source left the parent head.
      for (const [src, mirror] of mirrors) {
        if (!src.isConnected) {
          mirror.remove();
          mirrors.delete(src);
        }
      }

      // 2. Create missing mirrors and refresh attributes/content in place
      //    (href/media/integrity/media-query updates, in-place CSS edits).
      const sources = Array.from(parentDoc.head.children).filter(isMirrorable);
      for (const src of sources) {
        let mirror = mirrors.get(src);
        if (!mirror) {
          mirror = src.cloneNode(false) as Element;
          if (mirror instanceof HTMLStyleElement) mirror.textContent = "";
          mirrors.set(src, mirror);
        }
        for (const attr of Array.from(mirror.attributes)) {
          if (!src.hasAttribute(attr.name)) mirror.removeAttribute(attr.name);
        }
        for (const attr of Array.from(src.attributes)) {
          if (mirror.getAttribute(attr.name) !== attr.value) {
            mirror.setAttribute(attr.name, attr.value);
          }
        }
        if (mirror instanceof HTMLStyleElement) {
          const css = src.textContent ?? "";
          if (mirror.textContent !== css) mirror.textContent = css;
        }
      }

      // 3. Enforce parent order directly after <base> (order = cascade).
      let anchor: ChildNode = base;
      for (const _src of sources) {
        const mirror = mirrors.get(_src)!;
        if (anchor.nextSibling !== mirror) {
          anchor.parentNode?.insertBefore(mirror, anchor.nextSibling);
        }
        anchor = mirror;
      }

      // 4. Root attributes: theme class / lang / dir on <html>, skin on <body>.
      const parentHtml = parentDoc.documentElement;
      for (const name of ["lang", "dir", "class"]) {
        const value = parentHtml.getAttribute(name);
        if (value === null) doc.documentElement.removeAttribute(name);
        else if (doc.documentElement.getAttribute(name) !== value) {
          doc.documentElement.setAttribute(name, value);
        }
      }
      const bodyClass = parentDoc.body.className;
      if (doc.body.className !== bodyClass) doc.body.className = bodyClass;
      const bodyStyle = parentDoc.body.getAttribute("style") ?? "";
      if (doc.body.getAttribute("style") !== bodyStyle) {
        if (bodyStyle === "") doc.body.removeAttribute("style");
        else doc.body.setAttribute("style", bodyStyle);
      }
    };

    const scheduleSync = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        sync();
      });
    };

    const init = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) throw new Error("frame document unavailable");
        if (initedGenRef.current === gen) return; // idempotent per generation
        // Fresh head: wipe mirrors left by a previous Strict-Mode run.
        for (const mirror of mirrors.values()) mirror.remove();
        mirrors.clear();
        doc.head.replaceChildren();
        const base = doc.createElement("base");
        base.href = parentDoc.URL;
        doc.head.appendChild(base);
        baseRef.current = base;
        const charset = doc.createElement("meta");
        charset.setAttribute("charset", "utf-8");
        doc.head.appendChild(charset);

        observerRef.current?.disconnect();
        const observer = new MutationObserver(scheduleSync);
        // Head stylesheets (incl. in-place content edits and attr changes) …
        observer.observe(parentDoc.head, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["media", "href", "rel", "class"],
        });
        // … plus the root attributes that carry the theme (html class/lang/dir).
        observer.observe(parentDoc.documentElement, {
          attributes: true,
          attributeFilter: ["class", "lang", "dir"],
        });
        observer.observe(parentDoc.body, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        observerRef.current = observer;

        sync();
        initedGenRef.current = gen;
        if (gen !== genRef.current) return;
        setStatus("ready");
        setFrameDoc(doc);
        onFrameWindowRef.current?.(iframe.contentWindow);
      } catch (error) {
        console.error("[device-preview] frame init failed", error);
        if (gen === genRef.current) setStatus("error");
      }
    };

    // Chrome serves about:blank synchronously, but load fires (and other
    // engines may need it) — init is idempotent per generation either way.
    iframe.addEventListener("load", init);
    init();

    return () => {
      genRef.current += 1; // invalidate pending rAF/late loads
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      iframe.removeEventListener("load", init);
      observerRef.current?.disconnect();
      observerRef.current = null;
      for (const mirror of mirrors.values()) mirror.remove();
      mirrors.clear();
      baseRef.current = null;
      initedGenRef.current = -1;
      onFrameWindowRef.current?.(null);
      setFrameDoc(null);
      setStatus("initializing");
    };
  }, []);

  return (
    // Stage policy (R5 as revised 2026-10-27, user request): a frame larger
    // than the stage SCROLLS instead of clipping, so a fixed-size artboard
    // (Desktop 1440×900, large Custom) stays fully reachable in a smaller
    // window. Flexbox + `m-auto` (not `place-items-center`, which clips the
    // start edge on overflow) keeps the frame centered while scrolling from
    // both edges; the fit-to-screen zoom of plan 059 step 2 will scale the
    // frame down as the first line of defense, scroll as the fallback.
    <div
      data-device-frame
      className="absolute inset-0 flex overflow-auto px-6 pb-28 pt-20"
    >
      <div className="relative m-auto" data-device-frame-box>
        <iframe
          ref={iframeRef}
          title={t("playground.devicePreview.label")}
          data-device-frame-iframe
          className="block rounded-xl border border-border bg-background shadow-md"
          // content-box: the border must NOT shrink the CSS viewport — the
          // whole point is that innerWidth === the preset width exactly.
          style={{ width, height, boxSizing: "content-box" }}
        />
        {status === "ready" && frameDoc
          ? createPortal(children, frameDoc.body)
          : null}
        <span
          data-device-frame-label
          className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/90 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm"
        >
          {t("playground.devicePreview.sizeLabel", { width, height })}
        </span>
        {status === "error" && (
          <div
            data-device-frame-error
            role="alert"
            className="absolute inset-0 grid place-items-center rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive"
          >
            {t("playground.devicePreview.failed")}
          </div>
        )}
      </div>
    </div>
  );
}
