import { getTranslations } from "next-intl/server";
import type { BakedArtifact } from "@/lib/publish/artifacts";

/**
 * Server-rendered shell for a baked `content`-kind page (plan §5): the baked
 * spec HTML + compiled CSS are injected verbatim, and the "Open playground"
 * pill is a plain anchor (no client components — the whole subtree stays
 * server-rendered, so the page paints styled with JavaScript disabled and no
 * runtime Tailwind hop). The pill routes back to the playground for the same
 * locale the page was served in.
 */
export async function StaticLive({
  artifact,
  locale,
}: {
  artifact: BakedArtifact;
  locale: string;
}) {
  const t = await getTranslations({ locale });
  return (
    <main className="relative w-full">
      {/* Baked utilities for the spec's class tokens — replaces the runtime
          /api/tailwind compile the client engine does. */}
      <style>{artifact.css}</style>
      <div dangerouslySetInnerHTML={{ __html: artifact.html }} />
      <a
        href={`/${locale}/ui`}
        className="fixed bottom-4 right-4 z-50 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
        >
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </svg>
        {t("preview.openPlayground")}
      </a>
    </main>
  );
}
