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
