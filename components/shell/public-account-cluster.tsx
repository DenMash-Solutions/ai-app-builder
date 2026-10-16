"use client";

import { Globe, LayoutGrid, LogOut } from "lucide-react";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "@/lib/i18n/navigation";
import { LOCALES, routing } from "@/lib/i18n/routing";

/**
 * Authed-only account cluster for the public root (featured landing): a
 * small avatar menu — Playground, Live pages (admins), Sign out — so the
 * owner can reach the app chrome from the chrome-less landing. Anonymous
 * visitors see nothing; the landing stays content-only for everyone else.
 * The root serves content-only languages too (decision 12), so the cluster's
 * app routes pin an app language — unprefixed pushes would be prefixed into
 * /{tag}/ui, a 404 (decision 11's pill rule).
 */
export function PublicAccountCluster() {
  const t = useTranslations("shell");
  const { user, role, loading, signOut } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const appLocale = hasLocale(LOCALES, locale) ? locale : routing.defaultLocale;

  if (loading || !user) return null;

  const handleSignOut = async () => {
    await signOut();
    router.push("/", { locale: appLocale });
    router.refresh();
  };

  return (
    <div className="fixed top-3 right-3 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full bg-background/80 shadow-lg backdrop-blur-md"
            aria-label={t("account.menu", { email: user.email ?? "" })}
          >
            <span
              aria-hidden="true"
              className="text-sm font-semibold text-primary"
            >
              {(user.email ?? "?").charAt(0).toUpperCase()}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-56 rounded-lg"
        >
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="grid px-1 py-1.5 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.email}</span>
              {role && (
                <span className="truncate text-xs text-muted-foreground">
                  {role === "admin"
                    ? t("account.roleAdmin")
                    : t("account.roleMember")}
                </span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => router.push("/ui", { locale: appLocale })}
          >
            <LayoutGrid aria-hidden="true" />
            {t("nav.playground")}
          </DropdownMenuItem>
          {role === "admin" && (
            <DropdownMenuItem
              onSelect={() => router.push("/admin", { locale: appLocale })}
            >
              <Globe aria-hidden="true" />
              {t("nav.livePages")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void handleSignOut();
            }}
          >
            <LogOut aria-hidden="true" />
            {t("account.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
