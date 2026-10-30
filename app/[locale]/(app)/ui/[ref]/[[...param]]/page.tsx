"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Playground } from "@/components/playground";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Deep-linkable UI route: the param selects the history entry (resolved
 * client-side inside Playground — the store is localStorage-only) by id
 * first, then by slug, so both /ui/<uuid> and /ui/<slug> open the editor.
 * Unknown refs render the not-found gate instead of an empty canvas.
 *
 * The optional `[[...param]]` catch-all carries the record path a
 * `navigate` built for this screen (`/ui/<ref>/4`) — Playground overlays it
 * onto the canvas seed exactly like the preview route does, so the editor
 * mirrors a previewed deep link (061-3, §B).
 *
 * `ref` is an arbitrary param (no generateStaticParams), so it's unknown
 * during prerendering: `useParams` suspends and must sit inside Suspense
 * or the Cache Components build fails (dynamic-routes.md, "Without
 * generateStaticParams").
 */
function PlaygroundWithRef() {
  const { ref, param } = useParams<{ ref: string; param?: string[] }>();
  return <Playground initialRef={ref} initialParam={param} />;
}

export default function UiRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center p-8">
          <Skeleton className="h-64 w-full max-w-3xl rounded-md" />
        </div>
      }
    >
      <PlaygroundWithRef />
    </Suspense>
  );
}
