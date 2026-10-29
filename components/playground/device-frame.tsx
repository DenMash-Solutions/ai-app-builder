"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  computeFrameScale,
  getDevicePreview,
  getServerDevicePreview,
  subscribeDevicePreview,
} from "@/lib/playground/device-preview";

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

/** Outer chrome added to the viewport box by the frame border (1px each side). */
const FRAME_BORDER = 2;

/** Frame-open timing tripwire (safeguard 2): dev-only performance marks from
 * init start to the first layout inside the frame after ready. */
const TRIPWIRE_START = "device-frame:init-start";
const TRIPWIRE_MEASURE = "device-frame:open";
const isDev = process.env.NODE_ENV !== "production";

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
  const zoom = useSyncExternalStore(
    subscribeDevicePreview,
    getDevicePreview,
    getServerDevicePreview,
  ).zoom;
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Unscaled stage CONTENT box — the fit measurement base (R5). */
  const [stageSize, setStageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    // Tripwire start = preset activation (plan 059 verification); the stop
    // lands on the first rAF after ready (see the effect below).
    if (isDev) {
      try {
        performance.mark(TRIPWIRE_START);
      } catch {
        // Marks are best-effort — never block frame init on telemetry.
      }
    }
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
      if (isDev) performance.clearMarks(TRIPWIRE_START);
      onFrameWindowRef.current?.(null);
      setFrameDoc(null);
      setStatus("initializing");
    };
  }, []);

  // Tripwire stop: the first rAF after ready is the first layout inside the
  // frame with its stylesheets applied (fonts gated separately — plan 059).
  useEffect(() => {
    if (!isDev || status !== "ready") return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      try {
        performance.measure(TRIPWIRE_MEASURE, TRIPWIRE_START);
      } catch {
        // Start mark was cleared by a Strict-Mode teardown — skip the sample.
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [status]);

  // Fit measurement (step 2, R5): the stage content box, in unscaled px.
  // The transform is visual-only and ResizeObserver watches the stage
  // itself, so the fit output can never re-trigger it (safeguard 5).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const cs = getComputedStyle(stage);
      const width =
        stage.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight);
      const height =
        stage.clientHeight -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom);
      setStageSize((prev) =>
        prev && prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // The device box includes the frame border — fit must fit the OUTER box,
  // or the 2px chrome would overflow the stage at the fitted scale.
  const outerWidth = width + FRAME_BORDER;
  const outerHeight = height + FRAME_BORDER;
  const scale = stageSize
    ? computeFrameScale(
        zoom,
        stageSize.width,
        stageSize.height,
        outerWidth,
        outerHeight,
      )
    : 1;
  const percent = Math.round(scale * 100);

  return (
    // Stage policy (R5 as revised 2026-10-27, user request): a frame larger
    // than the stage SCROLLS instead of clipping, so a fixed-size artboard
    // (Desktop 1440×900, large Custom) stays fully reachable in a smaller
    // window. Flexbox + `m-auto` (not `place-items-center`, which clips the
    // start edge on overflow) keeps the frame centered while scrolling from
    // both edges. Fit-to-screen (step 2) is the first line of defense — it
    // scales the frame down to the stage; scroll is the fallback at 100%+.
    <div
      ref={stageRef}
      data-device-frame
      className="absolute inset-0 flex overflow-auto px-6 pb-28 pt-20"
    >
      {/* R5 scaled-space reservation: the slot reserves the SCALED outer
          size (the transform is visual only and would otherwise report the
          unscaled box to the scroller), the scaler holds the unscaled device
          box with origin top-left so the two map onto each other exactly.
          At 100% no transform is emitted — a 1:1 frame stays pixel-exact. */}
      <div
        className="relative m-auto"
        data-device-frame-box
        style={{ width: outerWidth * scale, height: outerHeight * scale }}
      >
        <div
          data-device-frame-scaler
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: outerWidth,
            height: outerHeight,
            transform: scale === 1 ? undefined : `scale(${scale})`,
          }}
        >
          <iframe
            ref={iframeRef}
            title={t("playground.devicePreview.label")}
            data-device-frame-iframe
            className="block rounded-xl border border-border bg-background shadow-md"
            // content-box: the border must NOT shrink the CSS viewport — the
            // whole point is that innerWidth === the preset width exactly.
            style={{ width, height, boxSizing: "content-box" }}
          />
        </div>
        {status === "ready" && frameDoc
          ? createPortal(children, frameDoc.body)
          : null}
        {/* The chip is a sibling of the scaler: its text stays unscaled (and
            readable) at every zoom step. */}
        <span
          data-device-frame-label
          className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/90 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm"
        >
          {t("playground.devicePreview.sizeLabel", { width, height })} ·{" "}
          <span data-device-frame-zoom>
            {zoom === null
              ? t("playground.devicePreview.fitLabel", { percent })
              : t("playground.devicePreview.percentLabel", { percent })}
          </span>
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
