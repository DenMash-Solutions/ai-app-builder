import {
  COMPONENT,
  MOCK_KEYS,
  PATCH_OP,
  PATCH_PATH,
  SPEC_THEME,
  STATE_MOCK,
  UI,
} from "@/e2e/constants";

export interface GenerateMockConfig {
  status?: number;
  body?: Record<string, unknown>;
  lines?: string[];
  editLines?: string[];
  /** Artificial response delay (ms) so tests can observe streaming UI. */
  delayMs?: number;
}

function line(op: Record<string, unknown>): string {
  return JSON.stringify(op);
}

function elementPath(key: string): string {
  return `${PATCH_PATH.elements}/${key}`;
}

export const MOCK_UI_LINES: string[] = [
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: MOCK_KEYS.card }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.card),
    value: {
      type: COMPONENT.card,
      props: { title: UI.mockCardTitle },
      children: [MOCK_KEYS.heading, MOCK_KEYS.text],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.heading),
    value: {
      type: COMPONENT.heading,
      props: { text: UI.mockHeading, level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.text),
    value: {
      type: COMPONENT.text,
      props: { text: UI.mockBody },
      children: [],
    },
  }),
];

/**
 * Canned response for edit requests (body carries a non-empty currentSpec):
 * a single replace patch against the generated heading.
 */
export const MOCK_EDIT_LINES: string[] = [
  line({
    op: PATCH_OP.replace,
    path: `${PATCH_PATH.elements}/${MOCK_KEYS.heading}/props/text`,
    value: UI.editedHeading,
  }),
];

/** MOCK_UI_LINES with a catalog Icon in the card — the icons fixture
 *  (docs/plan/catalog-icons). Kept as its own key set so no other fixture's
 *  structure-count assertions move. */
export const ICON_UI_LINES: string[] = [
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: MOCK_KEYS.card }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.card),
    value: {
      type: COMPONENT.card,
      props: { title: UI.mockCardTitle },
      children: [MOCK_KEYS.heading, MOCK_KEYS.icon, "icon-button"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.heading),
    value: {
      type: COMPONENT.heading,
      props: { text: UI.mockHeading, level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.icon),
    value: {
      type: COMPONENT.icon,
      props: { name: "sparkles", size: 24 },
      children: [],
    },
  }),
  // D5 (docs/plan/catalog-icons): a Button carrying icon props — the leading
  // and trailing icons must draw around the label.
  line({
    op: PATCH_OP.add,
    path: elementPath("icon-button"),
    value: {
      type: COMPONENT.button,
      props: {
        label: "Next",
        leadingIcon: "arrow-left",
        trailingIcon: "arrow-right",
      },
      children: [],
    },
  }),
];

/** D7 (docs/plan/catalog-icons): live search/filter fixture. Both arrays
 *  are seeded in /state (state holds raw data only — the repeat reads the
 *  filtered copy directly); the Input's change event rewrites
 *  /filtered-icons through the catalog's filterItems function. */
const FILTER_STATE_ITEMS = [
  { name: "house" },
  { name: "user" },
  { name: "settings" },
  { name: "search" },
  { name: "mail" },
  { name: "bell" },
  { name: "star" },
  { name: "heart" },
  { name: "trash-2" },
  { name: "pencil" },
];

export const FILTER_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: {
      icons: FILTER_STATE_ITEMS,
      "filtered-icons": [...FILTER_STATE_ITEMS],
      query: "",
    },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "filter-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: ["filter-input", "filter-grid"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-input"),
    value: {
      type: COMPONENT.input,
      props: {
        label: "Search icons",
        name: "search",
        type: "text",
        placeholder: "Filter by name",
        value: { $bindState: "/query" },
      },
      on: {
        change: [
          {
            action: "setState",
            params: {
              statePath: "/filtered-icons",
              value: {
                $computed: "filterItems",
                args: {
                  source: { $state: "/icons" },
                  query: { $state: "/query" },
                  fields: ["name"],
                },
              },
            },
          },
        ],
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-grid"),
    value: {
      type: COMPONENT.grid,
      props: { columns: 5, gap: "md" },
      repeat: { statePath: "/filtered-icons" },
      children: ["filter-cell"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-cell"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm", className: "items-center" },
      children: ["filter-icon", "filter-label"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-icon"),
    value: {
      type: COMPONENT.icon,
      props: { name: { $item: "name" }, size: 20 },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("filter-label"),
    value: {
      type: COMPONENT.text,
      props: { text: { $item: "name" } },
      children: [],
    },
  }),
];

/** D2 (docs/plan/responsive-ui): pagination fixture mirroring the rules
 *  pattern — the press actions move /page through the catalog's stepPage
 *  (bounded), the label is a pageLabel Text, Previous is hidden at the start
 *  via an element-level `visible`, and the repeat sits on the Grid container.
 *  11 items over limit 5 → three pages (5, 5, 1 — a partial last page). */
const PAGINATED_STATE_ITEMS = [...FILTER_STATE_ITEMS, { name: "camera" }];
const PAGED_LIMIT = 5;

export const PAGINATED_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: {
      icons: PAGINATED_STATE_ITEMS,
      "filtered-icons": [...PAGINATED_STATE_ITEMS],
      page: 0,
      "page-items": PAGINATED_STATE_ITEMS.slice(0, PAGED_LIMIT),
    },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "page-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "md" },
      children: ["page-label", "page-grid", "page-controls"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-label"),
    value: {
      type: COMPONENT.text,
      props: {
        text: {
          $computed: "pageLabel",
          args: {
            source: { $state: "/filtered-icons" },
            page: { $state: "/page" },
            limit: PAGED_LIMIT,
          },
        },
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-grid"),
    value: {
      type: COMPONENT.grid,
      props: { columns: 3, gap: "md" },
      repeat: { statePath: "/page-items" },
      children: ["page-cell"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-cell"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm", className: "items-center" },
      children: ["page-cell-icon", "page-cell-label"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-cell-icon"),
    value: {
      type: COMPONENT.icon,
      props: { name: { $item: "name" }, size: 20 },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-cell-label"),
    value: {
      type: COMPONENT.text,
      props: { text: { $item: "name" } },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-controls"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "row", gap: "sm" },
      children: ["page-prev", "page-next"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-prev"),
    value: {
      type: COMPONENT.button,
      props: { label: "Previous", leadingIcon: "chevron-left" },
      visible: { $state: "/page", gt: 0 },
      on: {
        press: [
          {
            action: "setState",
            params: {
              statePath: "/page",
              value: {
                $computed: "stepPage",
                args: {
                  source: { $state: "/filtered-icons" },
                  page: { $state: "/page" },
                  limit: PAGED_LIMIT,
                  delta: -1,
                },
              },
            },
          },
          {
            action: "setState",
            params: {
              statePath: "/page-items",
              value: {
                $computed: "sliceItems",
                args: {
                  source: { $state: "/filtered-icons" },
                  page: { $state: "/page" },
                  limit: PAGED_LIMIT,
                },
              },
            },
          },
        ],
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("page-next"),
    value: {
      type: COMPONENT.button,
      props: { label: "Next", trailingIcon: "chevron-right" },
      on: {
        press: [
          {
            action: "setState",
            params: {
              statePath: "/page",
              value: {
                $computed: "stepPage",
                args: {
                  source: { $state: "/filtered-icons" },
                  page: { $state: "/page" },
                  limit: PAGED_LIMIT,
                  delta: 1,
                },
              },
            },
          },
          {
            action: "setState",
            params: {
              statePath: "/page-items",
              value: {
                $computed: "sliceItems",
                args: {
                  source: { $state: "/filtered-icons" },
                  page: { $state: "/page" },
                  limit: PAGED_LIMIT,
                },
              },
            },
          },
        ],
      },
      children: [],
    },
  }),
];

/** Class tokens the publish journey's baked page is asserted against — the
 *  compiled CSS for these must ship in the served HTML (plan:
 *  spec-languages, task 5.4). Kept out of MOCK_UI_LINES so the default
 *  mock's style baselines (editor.spec font-weight) stay untouched. */
export const PUBLISH_HEADING_CLASS = "text-4xl font-bold tracking-tight";

/** MOCK_UI_LINES with class tokens on the heading — publish/bake fixture. */
export const PUBLISH_UI_LINES: string[] = [
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: MOCK_KEYS.card }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.card),
    value: {
      type: COMPONENT.card,
      props: { title: UI.mockCardTitle },
      children: [MOCK_KEYS.heading, MOCK_KEYS.text],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.heading),
    value: {
      type: COMPONENT.heading,
      props: {
        text: UI.mockHeading,
        level: "h1",
        className: PUBLISH_HEADING_CLASS,
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath(MOCK_KEYS.text),
    value: {
      type: COMPONENT.text,
      props: { text: UI.mockBody },
      children: [],
    },
  }),
];

/**
 * In-spec language fixture: a seed copy (`state.copy`) plus a partial Spanish
 * overlay (`state.i18n.es` — `title` translated, `subtitle` missing so the
 * fallback chain and the untranslated badge are both exercised). The heading
 * and subtitle bind to `/copy/*` refs, so the content-language toggle merges
 * the active layer over the seed and copy edits redirect by language.
 */
export const I18N_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: {
      locale: "en",
      copy: { title: "Hello", subtitle: "Welcome" },
      i18n: { es: { title: "Hola" } },
    },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "i18n-card" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("i18n-card"),
    value: {
      type: COMPONENT.card,
      props: {},
      children: ["i18n-heading", "i18n-subtitle", "lang-toggle"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("i18n-heading"),
    value: {
      type: COMPONENT.heading,
      props: { text: { $state: "/copy/title" }, level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("i18n-subtitle"),
    value: {
      type: COMPONENT.text,
      props: { text: { $state: "/copy/subtitle" } },
      children: [],
    },
  }),
  // The design's own language switcher: its options must keep pace with the
  // languages the spec carries (added on add-language, dropped on removal),
  // and its change event declares the switch_language action (decision 13).
  line({
    op: PATCH_OP.add,
    path: elementPath("lang-toggle"),
    value: {
      type: COMPONENT.buttonGroup,
      props: {
        buttons: [
          { label: "ES", value: "es" },
          { label: "EN", value: "en" },
        ],
        selected: { $bindState: "/locale" },
      },
      on: {
        change: [
          {
            action: "switch_language",
            params: { tag: { $state: "/locale" } },
          },
        ],
      },
      children: [],
    },
  }),
];

function i18nLayerPath(tag: string): string {
  return `${PATCH_PATH.state}/i18n/${tag}`;
}

/**
 * Steer response for the "Add language… pt-br" model action: the overlay
 * layer lands under the CANONICAL tag (pt-BR) — the dialog canonicalizes
 * before the steer, so spec and canvas agree on the key.
 */
export const I18N_PTBR_EDIT_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: i18nLayerPath("pt-BR"),
    value: { title: "Olá" },
  }),
];

/**
 * Horizontal carousel whose row is wider than a narrow canvas column: the
 * fixup (`fixupScrollLayout`) pins width + kills wrap at render time, so the
 * row scrolls internally. Picking a card past the column edge exercises the
 * selection-ring overflow regression (the ring must not inflate the canvas
 * scroll container's scrollWidth).
 */
export const CAROUSEL_UI_LINES: string[] = [
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "carousel-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm" },
      children: ["carousel-row", "carousel-ghost"],
    },
  }),
  // Boxless element (Card passes className through; `hidden` → display:none):
  // drives the x-ray label's forced-marker path for components that paint
  // nothing.
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-ghost"),
    value: {
      type: COMPONENT.card,
      props: { className: "hidden" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-row"),
    value: {
      type: COMPONENT.stack,
      props: {
        direction: "horizontal",
        gap: "sm",
        className: "overflow-x-auto pb-4",
      },
      children: [
        "carousel-tabs",
        "carousel-card-1",
        "carousel-card-2",
        "carousel-card-3",
        "carousel-card-4",
        "carousel-overlay-card",
      ],
    },
  }),
  // Quiet leaf with a real box (button padding) at the row's top edge — its
  // dot anchor collides with carousel-row's, driving the horizontal fan
  // regression. (Whitespace-only text collapses to 0×0, hence a
  // padded Button rather than a bare Text.)
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-tabs"),
    value: {
      type: COMPONENT.button,
      props: { label: " " },
      children: [],
    },
  }),
  ...["1", "2", "3", "4"].flatMap((index) => [
    line({
      op: PATCH_OP.add,
      path: elementPath(`carousel-card-${index}`),
      value: {
        type: COMPONENT.card,
        props: {
          title: `Card ${index}`,
          className: "min-w-[280px] max-w-[280px] shrink-0",
        },
        children: [`carousel-heading-${index}`],
      },
    }),
    line({
      op: PATCH_OP.add,
      path: elementPath(`carousel-heading-${index}`),
      value: {
        type: COMPONENT.heading,
        props: { text: `Carousel Heading ${index}`, level: "h3" },
        children: [],
      },
    }),
  ]),
  // Overlay card mirroring the live Gemini carousel shape: an absolutely
  // positioned content stack (with a badge child) plus a later DOM sibling
  // image that fills the same box. All three share the card's top edge, so
  // their dot anchors coincide — the fan must pitch them apart without
  // dropping or hiding any of them.
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-overlay-card"),
    value: {
      type: COMPONENT.card,
      props: {
        title: "Overlay Card",
        className: "min-w-[280px] max-w-[280px] shrink-0 relative",
      },
      children: ["carousel-overlay-content", "carousel-overlay-image"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-overlay-content"),
    value: {
      type: COMPONENT.stack,
      props: {
        direction: "vertical",
        gap: "xs",
        className: "absolute inset-0 p-5",
      },
      children: ["carousel-overlay-badge"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-overlay-badge"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "xs" },
      children: ["carousel-overlay-badge-text"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-overlay-badge-text"),
    value: {
      type: COMPONENT.text,
      props: { text: "Overlay Badge" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("carousel-overlay-image"),
    value: {
      type: "Image",
      props: {
        src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        alt: "Overlay",
        className: "absolute inset-0 h-full w-full object-cover",
      },
      children: [],
    },
  }),
];

/**
 * Spec whose usefulness depends entirely on `state`: a `repeat` over
 * `/items`, a `$state` text gated by `visible`, and a button that flips
 * the gate through the built-in setState action. Renders an empty list
 * (and a never-revealed greeting) unless the app seeds `spec.state` into
 * the StateProvider.
 */
export const STATEFUL_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: {
      title: STATE_MOCK.title,
      revealed: false,
      items: STATE_MOCK.itemLabels.map((label, index) => ({
        id: `item-${index}`,
        label,
      })),
    },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "state-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm" },
      children: ["state-toggle", "state-greeting", "state-list"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-toggle"),
    value: {
      type: COMPONENT.button,
      props: { label: STATE_MOCK.reveal },
      on: {
        press: {
          action: "setState",
          params: { statePath: "/revealed", value: true },
        },
      },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-greeting"),
    value: {
      type: COMPONENT.text,
      props: { text: { $state: "/title" } },
      visible: { $state: "/revealed" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-list"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical" },
      repeat: { statePath: "/items", key: "id" },
      children: ["state-item"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-item"),
    value: {
      type: COMPONENT.text,
      props: { text: { $item: "label" }, className: "tracking-wide" },
      children: [],
    },
  }),
];

/**
 * Like STATEFUL, but the repeat's per-item child is a container
 * (`state-row` Stack wrapping the Text). The renderer repeats the
 * repeated element's children, not the element itself, so this yields six
 * per-instance container wrappers — each instance gets its own x-ray dot
 * (used by the fan, pin, and label-scope tests).
 */
export const STATEFUL_ROWS_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: {
      title: STATE_MOCK.title,
      revealed: false,
      items: STATE_MOCK.itemLabels.map((label, index) => ({
        id: `item-${index}`,
        label,
      })),
    },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "state-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical", gap: "sm" },
      children: ["state-list"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-list"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical" },
      repeat: { statePath: "/items", key: "id" },
      children: ["state-row"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-row"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical" },
      children: ["state-item"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("state-item"),
    value: {
      type: COMPONENT.text,
      props: { text: { $item: "label" }, className: "tracking-wide" },
      children: [],
    },
  }),
];

/**
 * Spec-driven theme fixture (docs/plan/tool-rail-and-spec-theme): a light
 * default and a ThemeSwitcher bound to /theme with the switch_theme change
 * binding. Carries NO copy — it doubles as the empty-copy journey proving
 * the rail keeps "Add language…" reachable.
 */
export const THEME_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: { theme: "light" },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "theme-card" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("theme-card"),
    value: {
      type: COMPONENT.card,
      props: {},
      children: ["theme-heading", "theme-toggle"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("theme-heading"),
    value: {
      type: COMPONENT.heading,
      props: { text: SPEC_THEME.heading, level: "h1" },
      children: [],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("theme-toggle"),
    value: {
      type: COMPONENT.themeSwitcher,
      props: { value: { $bindState: "/theme" } },
      on: {
        change: [
          {
            action: "switch_theme",
            params: { theme: { $state: "/theme" } },
          },
        ],
      },
      children: [],
    },
  }),
];

/**
 * Text-free fixture for the rail journey: normalizeSpecCopy lifts element
 * text into state.copy at ingest, so "a spec without copy" means a spec
 * without a single lift-able string — just the theme toggle itself.
 */
export const NO_COPY_UI_LINES: string[] = [
  line({
    op: PATCH_OP.add,
    path: PATCH_PATH.state,
    value: { theme: "light" },
  }),
  line({ op: PATCH_OP.add, path: PATCH_PATH.root, value: "no-copy-root" }),
  line({
    op: PATCH_OP.add,
    path: elementPath("no-copy-root"),
    value: {
      type: COMPONENT.stack,
      props: { direction: "vertical" },
      children: ["no-copy-toggle"],
    },
  }),
  line({
    op: PATCH_OP.add,
    path: elementPath("no-copy-toggle"),
    value: {
      type: COMPONENT.themeSwitcher,
      props: { value: { $bindState: "/theme" } },
      on: {
        change: [
          {
            action: "switch_theme",
            params: { theme: { $state: "/theme" } },
          },
        ],
      },
      children: [],
    },
  }),
];
