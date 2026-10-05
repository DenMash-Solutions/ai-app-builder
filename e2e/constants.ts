import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";
import { LOCALE_LABELS } from "@/lib/i18n/routing";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/playground/models";
import en from "@/lib/i18n/locale/en.json";
import es from "@/lib/i18n/locale/es.json";

export const ROLE = {
  button: "button",
  heading: "heading",
  link: "link",
  tab: "tab",
} as const;

export const UI = {
  heading: en.playground.title,
  subtitle: en.playground.subtitle,
  emptyState: en.playground.emptyState,
  promptPlaceholder: en.playground.promptPlaceholder,
  generationFailed: en.playground.generationFailed,
  historyEmpty: en.historyDrawer.emptyState,
  justNow: en.historyDrawer.relativeTime.now,
  mockCardTitle: "Mock Dashboard",
  mockHeading: "Mock UI",
  mockBody: "Rendered from MSW mock",
  editedHeading: "Edited heading",
} as const;

export const ES_UI = {
  heading: es.playground.title,
  subtitle: es.playground.subtitle,
  generate: es.playground.generate,
  promptPlaceholder: es.playground.promptPlaceholder,
  history: es.playground.history,
} as const;

export const ACTIONS = {
  history: en.playground.history,
  generate: en.playground.generate,
  clearAll: en.historyDrawer.clearAll,
  deleteEntry: en.historyDrawer.deleteEntry,
  close: en.historyDrawer.close,
} as const;

export const SWITCHER_LABELS = LOCALE_LABELS;

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
  replace: "replace",
} as const;

export const PATCH_PATH = {
  root: "/root",
  elements: "/elements",
} as const;

export const EDITOR = {
  pick: en.editor.pick,
  panelTitle: en.editor.panelTitle,
  close: en.editor.close,
  undo: en.editor.undo,
  redo: en.editor.redo,
  apply: en.editor.apply,
  freeformPlaceholder: en.editor.freeformPlaceholder,
  properties: en.editor.tabs.properties,
  actions: en.editor.tabs.actions,
} as const;

export const PROMPTS = {
  ...EXAMPLE_PROMPTS,
  customBilling: "A billing settings page with a table",
} as const;

export const THEME = {
  toggleToDark: en.theme.toggleToDark,
  toggleToLight: en.theme.toggleToLight,
} as const;

export const MODELS = {
  defaultShortLabel: findModel(DEFAULT_MODEL_ID).shortLabel,
  lite: "Gemini 3.5 Flash Lite",
  liteShortLabel: findModel("gemini-3.5-flash-lite").shortLabel,
} as const;

export const QUOTA = {
  title: en.quota.title,
  description: en.quota.description,
  switchAndRetry: en.quota.switchAndRetry,
  dismiss: en.quota.dismiss,
  modelLabel: en.model.label,
} as const;

export const historyButtonName = (count?: number): string =>
  count === undefined ? ACTIONS.history : `${ACTIONS.history} ${count}`;
