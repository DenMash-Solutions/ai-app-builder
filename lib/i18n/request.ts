import * as rootParams from "next/root-params";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  if (!locale) {
    const paramValue = await rootParams.locale();
    locale =
      typeof paramValue === "string" && paramValue.length > 0
        ? paramValue
        : routing.defaultLocale;
  }

  // App locales carry the full UI catalog; content-only locales (live-page
  // tags beyond the app languages, decision 11) reuse the default catalog —
  // their pages render baked content, so only the shell's strings leak
  // through. Garbage tags are safe too: the routes validate what they serve
  // (canonical tags on content routes, resolution on the root), and any
  // render that survives falls back to this default catalog.
  const catalog = hasLocale(routing.locales, locale)
    ? locale
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./locale/${catalog}.json`)).default,
  };
});
