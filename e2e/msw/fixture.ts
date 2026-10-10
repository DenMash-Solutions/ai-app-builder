import {
  COMPONENT,
  MOCK_KEYS,
  PATCH_OP,
  PATCH_PATH,
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
  // chip collides with carousel-row's chip, driving the lane-stacking
  // overlap regression. (Whitespace-only text collapses to 0×0, hence a
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
  // image that fills the same box. Both share the card's top edge, so the
  // global-depth placement (all depth-N before any depth-N+1) used to put
  // the image chip between the content chip and its badge child — the image
  // looked like the badge's parent. DFS placement must keep the badge chip
  // directly under the content chip, image last.
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
 * per-instance container wrappers — each with a permanent x-ray chip
 * (STATEFUL's Text leaves only get hover chips, which pick mode hides).
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
