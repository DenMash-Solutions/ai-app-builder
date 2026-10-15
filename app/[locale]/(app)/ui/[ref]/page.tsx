"use client";

import { useParams } from "next/navigation";
import { Playground } from "@/components/playground";

/**
 * Deep-linkable UI route: the param selects the history entry (resolved
 * client-side inside Playground — the store is localStorage-only) by id
 * first, then by slug, so both /ui/<uuid> and /ui/<slug> open the editor.
 * Unknown refs render the not-found gate instead of an empty canvas.
 */
export default function UiRoutePage() {
  const { ref } = useParams<{ ref: string }>();
  return <Playground initialRef={ref} />;
}
