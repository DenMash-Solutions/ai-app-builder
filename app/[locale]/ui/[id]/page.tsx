"use client";

import { useParams } from "next/navigation";
import { Playground } from "@/components/playground";

/**
 * Deep-linkable UI route: the param selects the history entry (resolved
 * client-side inside Playground — the store is localStorage-only). Unknown
 * ids render the not-found gate instead of an empty canvas.
 */
export default function UiRoutePage() {
  const { id } = useParams<{ id: string }>();
  return <Playground initialId={id} />;
}
