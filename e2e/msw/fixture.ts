import {
  COMPONENT,
  MOCK_KEYS,
  PATCH_OP,
  PATCH_PATH,
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
