import { EXAMPLE_PROMPTS } from "../lib/example-prompts";

export const ROLE = {
  button: "button",
  heading: "heading",
} as const;

export const UI = {
  heading: "GenUI Playground",
  emptyState: "The generated UI will render here.",
  promptPlaceholder: "Describe the UI you want…",
  generationFailed: "Generation failed",
  historyEmpty: "No generations yet — create one to build your history.",
  mockCardTitle: "Mock Dashboard",
  mockHeading: "Mock UI",
  mockBody: "Rendered from MSW mock",
  justNow: "Just now",
} as const;

export const ACTIONS = {
  history: "History",
  generate: "Generate",
  clearAll: "Clear all",
  deleteEntry: "Delete entry",
  close: "Close",
} as const;

export const MOCK_ERROR_MESSAGE = "boom";

export const MOCK_KEYS = {
  card: "card-1",
  heading: "heading-1",
  text: "text-1",
} as const;

export const MOCK_ROOT_KEY = MOCK_KEYS.card;

export const COMPONENT = {
  card: "Card",
  heading: "Heading",
  text: "Text",
} as const;

export const PATCH_OP = {
  add: "add",
} as const;

export const PATCH_PATH = {
  root: "/root",
  elements: "/elements",
} as const;

export const PROMPTS = {
  ...EXAMPLE_PROMPTS,
  customBilling: "A billing settings page with a table",
} as const;

export const historyButtonName = (count?: number): string =>
  count === undefined ? ACTIONS.history : `${ACTIONS.history} ${count}`;
