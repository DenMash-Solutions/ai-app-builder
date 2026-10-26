import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ThemeInit } from "@/components/theme-init";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";
import { LOCALES, routing } from "@/lib/i18n/routing";
import "../globals.css";

/**
 * The root layout derives `<html lang>` and the next-intl messages from the
 * locale param, and a document root can't sit inside `<Suspense>` — the
 * framework's own guidance for root-element attributes (they "can't be
 * wrapped in `<Suspense>`", `blocking-prerender-runtime`) is to keep them out
 * of the boundary. Bare-segment serving is decided per request in
 * `proxy.ts` (DB-live 200/307/404), so content locales render on request by
 * design; the app locales from `generateStaticParams` still prerender — this
 * export disables instant-navigation validation, not prerendering.
 */
export const instant = false;

/**
 * This layout IS the root layout (no `app/layout.tsx`), so `locale` is a root
 * param: Cache Components' build validation (E622) requires at least one value
 * per root param. Unlisted locales still render on request.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // Canonicalized because this root layout also renders Next's synthetic
  // `/_not-found` route, whose `locale` param ("_not-found") is not a
  // BCP-47 tag and would make next-intl warn on every render.
  const t = await getTranslations({
    locale: canonicalizeTag(locale) ?? routing.defaultLocale,
  });
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;

  // Any BCP-47-shaped or not may pass THIS layer (decisions 11 and 12): the
  // routes below validate the tags they serve — content routes require a
  // canonical tag, the root resolves any bare segment (serve / redirect the
  // published slug / 404), and app surfaces re-gate to the app locales in
  // (app)/layout.tsx. The html lang stays honest for the canonical form.
  const lang = canonicalizeTag(locale) ?? routing.defaultLocale;

  // Messages load for the canonical tag (or the default) — same synthetic
  // /_not-found guard as generateMetadata above.
  const messages = await getMessages({ locale: lang });

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInit />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>{props.children}</AuthProvider>
        </NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
