"use client";

import {
  ChevronsUpDown,
  Globe,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  PanelLeft,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { LOCALES } from "@/lib/i18n/routing";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Persistent app chrome for the signed-in surfaces (`/ui/**`, `/admin`):
 * the shadcn Sidebar (desktop rail + mobile sheet) with navigation and the
 * account menu. The public content model stays chrome-less — the shell is
 * applied by the route layouts, never on the landing, live, preview, or
 * auth pages.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      {/* The sidebar's menu-button tooltips need a provider — the installed
          Sidebar component uses Tooltip but ships without one. */}
      <TooltipProvider delayDuration={0}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarHeaderRow />
          </SidebarHeader>

          <SidebarContent>
            {/* SidebarGroup carries the p-2 that aligns nav icons with the
                brand and the account block. */}
            <SidebarGroup>
              <NavItems />
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <AccountBlock />
          </SidebarFooter>

          {/* Click-to-collapse rail (desktop), like the shadcn examples. */}
          <SidebarRail />
        </Sidebar>

        {/* `SidebarInset` is the `<main>` landmark for the shelled surfaces —
          the canvas pages inside it render plain containers, not mains. */}
        <SidebarInset>{children}</SidebarInset>

        {/* Mobile-only opener; the header trigger closes the sheet. */}
        <MobileOpenTrigger />
      </TooltipProvider>
    </SidebarProvider>
  );
}

/**
 * Brand + collapse affordance in the sidebar's own header — the examples
 * put this trigger in a page header; the canvas has none, so it lives here
 * (right of the brand when open, under the brand icon when collapsed to the
 * rail). Inside the mobile sheet it doubles as the close button.
 */
function SidebarHeaderRow() {
  const t = useTranslations("shell");
  const { isMobile, state, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <div className="flex items-center justify-between">
        <BrandLink />
        {/* In-sheet so it stays in the a11y tree (radix hides everything
            outside the open sheet). */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("nav.closeMenu")}
          onClick={() => setOpenMobile(false)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const collapsed = state === "collapsed";

  return (
    <div
      className={
        collapsed
          ? "flex flex-col items-center gap-1"
          : "flex items-center justify-between"
      }
    >
      <BrandLink />
      <SidebarCollapseTrigger />
    </div>
  );
}

function BrandLink() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild>
          <Link href="/">
            <Sparkles aria-hidden="true" className="text-primary" />
            <span>GenUI</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function SidebarCollapseTrigger() {
  const t = useTranslations("shell");
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
      aria-expanded={!collapsed}
      onClick={toggleSidebar}
    >
      <PanelLeft aria-hidden="true" />
    </Button>
  );
}

/** Mobile-only opener tab at the mid-left edge (clear of the top bar). */
function MobileOpenTrigger() {
  const t = useTranslations("shell");
  const { isMobile, openMobile, toggleSidebar } = useSidebar();

  if (!isMobile || openMobile) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="fixed top-1/2 left-0 z-[60] -translate-y-1/2 rounded-l-none bg-background shadow-lg"
      aria-label={t("nav.openMenu")}
      aria-expanded={false}
      onClick={toggleSidebar}
    >
      <Menu aria-hidden="true" />
    </Button>
  );
}

/** Strips the locale prefix so paths compare against locale-less hrefs. */
function normalizePathname(pathname: string): string {
  const localePattern = new RegExp(`^/(${LOCALES.join("|")})(?=/|$)`);
  const stripped = pathname.replace(localePattern, "");
  return stripped === "" ? "/" : stripped;
}

function NavItems() {
  const t = useTranslations("shell");
  const { role } = useAuth();
  const pathname = usePathname();
  const normalized = normalizePathname(pathname);

  const items = [
    {
      href: "/ui",
      label: t("nav.playground"),
      icon: LayoutGrid,
      active: normalized === "/ui" || normalized.startsWith("/ui/"),
    },
    // Live pages: rendered only for admins (the console itself keeps the
    // client guard + RLS as defense in depth).
    ...(role === "admin"
      ? [
          {
            href: "/admin",
            label: t("nav.livePages"),
            icon: Globe,
            active: normalized === "/admin",
          },
        ]
      : []),
  ];

  return (
    <nav aria-label={t("nav.primary")}>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              isActive={item.active}
              tooltip={item.label}
            >
              <Link href={item.href}>
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </nav>
  );
}

function AccountBlock() {
  const t = useTranslations("shell");
  const { user, role, loading, signOut } = useAuth();
  const { isMobile } = useSidebar();
  const router = useRouter();

  if (loading) {
    return (
      <div
        className="h-9 animate-pulse rounded-md bg-sidebar-accent"
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <Link href="/login">
              <LogIn aria-hidden="true" />
              <span>{t("account.signIn")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    // Local history stays in this browser; only the session goes away.
    router.push("/");
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={t("account.menu", { email: user.email ?? "" })}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
              >
                {(user.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.email}</span>
              </div>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                >
                  {(user.email ?? "?").charAt(0).toUpperCase()}
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.email}</span>
                  {role && (
                    <span className="truncate text-xs text-muted-foreground">
                      {role === "admin"
                        ? t("account.roleAdmin")
                        : t("account.roleMember")}
                    </span>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="sign-out"
              onClick={() => {
                void handleSignOut();
              }}
            >
              <LogOut aria-hidden="true" />
              {t("account.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
