"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("localeSwitcher.label")}
      className="flex items-center gap-0.5 rounded-md border p-0.5"
    >
      {LOCALES.map((candidate) => (
        <Link
          key={candidate}
          href={pathname}
          locale={candidate}
          aria-current={candidate === locale ? "true" : undefined}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            candidate === locale
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {LOCALE_LABELS[candidate]}
        </Link>
      ))}
    </nav>
  );
}
