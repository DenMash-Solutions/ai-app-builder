import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ThemeInit } from "@/components/theme-init";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SyncEngine } from "@/components/sync/sync-engine";
import { UploadNudge } from "@/components/sync/upload-nudge";
import { Toaster } from "@/components/ui/sonner";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";
import "../globals.css";

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
  const t = await getTranslations({ locale });
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;

  // Any canonical BCP-47 tag may pass (content routes serve their own
  // language, decision 11); app surfaces re-gate to the app locales in
  // (app)/layout.tsx, and garbage tags never render.
  if (canonicalizeTag(locale) === null) {
    notFound();
  }

  const messages = await getMessages({ locale });

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeInit />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <SyncEngine />
            <UploadNudge />
            {props.children}
          </AuthProvider>
        </NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
