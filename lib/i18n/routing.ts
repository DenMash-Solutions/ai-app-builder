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
/**
 * `user` (plan 068) belongs here for a second reason: a content path with two
 * segments whose first segment is not an app segment is rewritten to
 * /_not-found when the second segment is not a canonical language tag
 * (`proxy.ts`), which is exactly `/en/user/<username>/ui`.
 */
export const APP_SEGMENTS = ["ui", "admin", "login", "signup", "user"] as const;

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "en",
  localePrefix: "always",
});
