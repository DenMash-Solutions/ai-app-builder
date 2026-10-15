import type { Spec } from "@json-render/core";

/**
 * Data-driven section of the admin page (plan: committed spec + wired
 * actions). The committed `admin.spec.json` owns the frame (header, cards
 * grid, empty state); this pure builder appends one card per published page
 * with its own element ids, per-page visibility state, and action bindings —
 * the spec-mandate composition pattern (no repeat primitive needed).
 */

export interface AdminPageSummary {
  uiId: string;
  name: string;
  slug: string;
  version: number;
  ownerEmail: string | null;
  featured: boolean;
  /** Baked language tags (published artifact keys, sorted) — coverage badges. */
  languages: string[];
}

export interface AdminSpecCopy {
  openLive: string;
  feature: string;
  unfeature: string;
  featuredBadge: string;
}

export function buildAdminSpec(
  base: Spec,
  pages: AdminPageSummary[],
  locale: string,
  copy: AdminSpecCopy,
): Spec {
  const featured: Record<string, boolean> = {};
  const notFeatured: Record<string, boolean> = {};
  const cards: Record<string, unknown> = {};
  const cardIds: string[] = [];

  for (const page of pages) {
    const id = page.uiId;
    featured[id] = page.featured;
    notFeatured[id] = !page.featured;
    cardIds.push(`${id}-card`);

    cards[`${id}-card`] = {
      type: "Card",
      props: {
        title: page.name,
        description: `${page.ownerEmail ?? "—"} · /${page.slug} · v${page.version}`,
      },
      children: [`${id}-row`],
    };
    cards[`${id}-row`] = {
      type: "Stack",
      props: {
        direction: "horizontal",
        gap: "sm",
        className: "flex-wrap items-center",
      },
      children: [
        ...page.languages.map((_tag, index) => `${id}-lang-${index}`),
        `${id}-badge`,
        `${id}-live`,
        page.featured ? `${id}-unfeature` : `${id}-feature`,
      ],
    };
    // Coverage badges: one per baked language tag (uppercase, like the
    // design's own switcher — EN / ES / FR chips, always visible).
    page.languages.forEach((tag, index) => {
      cards[`${id}-lang-${index}`] = {
        type: "Badge",
        props: {
          variant: "outline",
          text: tag.toUpperCase(),
          className: "uppercase",
        },
        children: [],
      };
    });
    // shadcn's Badge renders props.text (not spec children) — engine quirk.
    cards[`${id}-badge`] = {
      type: "Badge",
      props: {
        variant: "outline",
        text: copy.featuredBadge,
        className:
          "gap-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
      },
      visible: { $state: `/admin/featured/${id}` },
      children: [],
    };
    cards[`${id}-live`] = {
      type: "Link",
      props: {
        label: copy.openLive,
        href: `/${locale}/${page.slug}`,
      },
      children: [],
    };
    cards[`${id}-feature`] = {
      type: "Button",
      props: { label: copy.feature, variant: "outline" },
      visible: { $state: `/admin/notFeatured/${id}` },
      on: {
        press: { action: "admin.feature", params: { uiId: id } },
      },
      children: [],
    };
    cards[`${id}-unfeature`] = {
      type: "Button",
      props: { label: copy.unfeature, variant: "ghost" },
      visible: { $state: `/admin/featured/${id}` },
      on: {
        press: { action: "admin.unfeature", params: { uiId: id } },
      },
      children: [],
    };
  }

  return {
    ...base,
    state: {
      ...(base.state ?? {}),
      admin: {
        loading: false,
        empty: pages.length === 0,
        featured,
        notFeatured,
      },
    },
    elements: {
      ...base.elements,
      ...cards,
      cards: {
        ...base.elements["cards"],
        children: cardIds,
      },
    },
  } as Spec;
}
