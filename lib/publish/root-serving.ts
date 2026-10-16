import { hasLocale } from "next-intl";
import { LOCALES } from "@/lib/i18n/routing";

export type RootServing = "serve" | "redirect" | "not-found";

/**
 * How the featured root serves a `/{locale}` path (decision 12). App
 * languages always serve; a content-only language serves when the featured
 * design carries its tag (merge falls back per key). Anything else falls
 * through to the published-slug sugar — `/denmash` redirects to
 * `/{default}/denmash` exactly like the old middleware redirect — and
 * finally 404s. The slug lookup is injected and only runs off the serving
 * paths, so normal requests never hit it.
 */
export async function resolveRootServing(
  locale: string,
  carried: readonly string[],
  publishedSlugExists: (slug: string) => Promise<boolean>,
): Promise<RootServing> {
  if (hasLocale(LOCALES, locale) || carried.includes(locale)) return "serve";
  return (await publishedSlugExists(locale)) ? "redirect" : "not-found";
}
