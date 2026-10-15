import { defineRouting } from "next-intl/routing";

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/**
 * Path segments of app surfaces (`/ui/…`, `/admin/…`, …). They are not
 * locales, but unprefixed deep links into them (`/ui/{ref}`) must keep
 * receiving the usual locale redirect — only paths outside this list and
 * outside LOCALES may be content-only locale paths (decision 11, checked in
 * `proxy.ts`).
 */
export const APP_SEGMENTS = ["ui", "admin", "login", "signup"] as const;

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "en",
  localePrefix: "always",
});
