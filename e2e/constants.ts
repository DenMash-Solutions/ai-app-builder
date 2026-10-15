import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";
import { LOCALE_LABELS } from "@/lib/i18n/routing";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/playground/models";
import en from "@/lib/i18n/locale/en.json";
import es from "@/lib/i18n/locale/es.json";

export const ROLE = {
  button: "button",
  heading: "heading",
  link: "link",
  navigation: "navigation",
  tab: "tab",
  combobox: "combobox",
  menuitem: "menuitem",
  option: "option",
  textbox: "textbox",
  alert: "alert",
} as const;

/** shadcn/vaul internal slots — the history drawer and the JSON dialog are
 *  BOTH `role="dialog"`, so locators must scope by slot instead of role. */
export const SLOTS = {
  drawer: '[data-slot="drawer-content"]',
  dialog: '[data-slot="dialog-content"]',
} as const;

/** Route paths. `root`/`ui` are unprefixed (the locale redirect prefixes
 *  them); auth routes pin the default locale explicitly.
 *  The root renders the featured landing — the playground lives at /ui. */
export const PATHS = {
  root: "/",
  ui: "/ui",
  login: "/en/login",
  signup: "/en/signup",
  admin: "/en/admin",
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
  uiRouteLoading: en.uiRoute.loading,
  uiRouteNotFoundTitle: en.uiRoute.notFound.title,
  uiRouteNotFoundBack: en.uiRoute.notFound.back,
  editInPlayground: en.specPage.editInPlayground,
  // Featured landing copy — lives in the published spec (DB), not i18n.
  landingTitle: "Describe it. See it. Perfect it.",
  landingPill: "Open in playground",
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
  steer: en.playground.steer,
  clear: en.playground.clear,
  openMenu: en.playground.openMenu,
  clearAll: en.historyDrawer.clearAll,
  deleteEntry: en.historyDrawer.deleteEntry,
  close: en.historyDrawer.close,
} as const;

export const SWITCHER_LABELS = LOCALE_LABELS;

export const RENAME = {
  open: en.rename.title,
  name: en.rename.name,
  slug: en.rename.slug,
  save: en.rename.save,
  slugTaken: en.rename.errors.slugTaken,
  slugReserved: en.rename.errors.slugReserved,
} as const;

export const PREVIEW = {
  open: en.preview.open,
  openPlayground: en.preview.openPlayground,
} as const;

export const AUTH = {
  loginTitle: en.login.title,
  signupTitle: en.signup.title,
  email: en.login.emailLabel,
  password: en.login.passwordLabel,
  confirm: en.signup.confirmLabel,
  loginSubmit: en.login.submit,
  signupSubmit: en.signup.submit,
  toSignup: en.login.switchLink,
  toLogin: en.signup.switchLink,
} as const;

/** App-shell chrome (sidebar + account menu). No auth-state strings —
 *  sign-in/sign-out flows live in the authenticated e2e suites. */
export const SHELL = {
  playgroundNav: en.shell.nav.playground,
  livePagesNav: en.shell.nav.livePages,
  navLabel: en.shell.nav.primary,
  openMenu: en.shell.nav.openMenu,
  closeMenu: en.shell.nav.closeMenu,
  signIn: en.shell.account.signIn,
  signOut: en.shell.account.signOut,
  accountMenu: en.shell.account.menu,
  roleAdmin: en.shell.account.roleAdmin,
  roleMember: en.shell.account.roleMember,
  esNavLabel: es.shell.nav.primary,
  esSignIn: es.shell.account.signIn,
  esLivePagesNav: es.shell.nav.livePages,
} as const;

export const BANNER = {
  text: en.signupBanner.text,
  cta: en.signupBanner.cta,
  dismiss: en.signupBanner.dismiss,
} as const;

export const PUBLISH = {
  signupCta: en.publish.signupCta,
  slugLabel: en.publish.slugLabel,
  checking: en.publish.checking,
  available: en.publish.available,
  submit: en.publish.submit,
  update: en.publish.update,
  unpublish: en.publish.unpublish,
  unpublishDone: en.publish.unpublishDone,
  liveBadge: en.publish.liveBadge,
  /** Row affordances + toasts — name/URL interpolated for locators. */
  goLive: (name: string): string => en.publish.goLive.replace("{name}", name),
  manageLive: en.publish.manageLive,
  openLive: (name: string): string =>
    en.publish.openLive.replace("{name}", name),
  published: (url: string): string =>
    en.publish.published.replace("{url}", url),
} as const;

/** Admin console (feature/unfeature journey in the authed suite). */
export const ADMIN = {
  title: en.admin.title,
  loading: en.admin.loading,
  empty: en.admin.empty,
  feature: en.admin.feature,
  unfeature: en.admin.unfeature,
  featuredBadge: en.admin.featuredBadge,
  featuredToast: en.admin.featuredToast,
  unfeaturedToast: en.admin.unfeaturedToast,
  openLive: en.admin.openLive,
} as const;

/** Sync status dot — `role="status"` with the status text as aria-label. */
export const SYNC = {
  idle: en.sync.status.idle,
  syncing: en.sync.status.syncing,
  saved: en.sync.status.saved,
  offline: en.sync.status.offline,
} as const;

/** First-login upload nudge (bottom-left pill — overlaps the account menu). */
export const NUDGE = {
  uploadNow: en.sync.uploadNow,
  later: en.sync.later,
} as const;

export const MOCK_ERROR_MESSAGE = "boom";

/** Content-language toggle + in-spec translation (see lib/i18n). */
export const I18N = {
  seedTitle: "Hello",
  seedSubtitle: "Welcome",
  esTitle: "Hola",
  edited: "Bonjour",
  ptTitle: "Olá",
  langTitle: en.editor.contentLang.title,
  source: en.editor.contentLang.source,
  addLang: en.editor.contentLang.add,
  addDialog: {
    filterLabel: en.editor.contentLang.addDialog.label,
    noMatch: en.editor.contentLang.addDialog.noMatch,
  },
  addedLang: (name: string): string =>
    en.playground.langAdded.replace("{name}", name),
  removeLang: (name: string): string =>
    en.editor.contentLang.remove.replace("{name}", name),
  removeConfirm: {
    cancel: en.editor.contentLang.removeConfirm.cancel,
    confirm: en.editor.contentLang.removeConfirm.confirm,
  },
  missingBadge: (count: number): string =>
    en.editor.contentLang.missingBadge.replace("{count}", String(count)),
} as const;

/** Device-local content-language keys (global default + per-entry override). */
export const CONTENT_LANG = {
  global: "genui-content-lang",
  perEntry: (entryId: string): string => `genui-editor-lang:${entryId}`,
} as const;

export const STATE_MOCK = {
  title: "Seeded title",
  reveal: "Reveal",
  itemLabels: ["Item A", "Item B", "Item C", "Item D", "Item E", "Item F"],
} as const;

export const SCOPE = {
  chip: (key: string, type: string, index: number, count: number): string =>
    en.playground.scopeChipInstance
      .replace("{key}", key)
      .replace("{type}", type)
      .replace("{index}", String(index))
      .replace("{count}", String(count)),
  chipAll: (key: string, type: string, count: number): string =>
    en.playground.scopeChipAll
      .replace("{key}", key)
      .replace("{type}", type)
      .replace("{count}", String(count)),
  removeChip: (label: string): string =>
    en.playground.scopeRemove.replace("{label}", label),
  add: en.editor.promptScope.add,
  active: en.editor.promptScope.active,
  addAll: (count: number): string =>
    en.editor.promptScope.addAll.replace("{count}", String(count)),
  activeAll: (count: number): string =>
    en.editor.promptScope.activeAll.replace("{count}", String(count)),
} as const;

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
  stack: "Stack",
  button: "Button",
} as const;

export const PATCH_OP = {
  add: "add",
  replace: "replace",
} as const;

export const PATCH_PATH = {
  root: "/root",
  elements: "/elements",
  state: "/state",
} as const;

export const EDITOR = {
  pick: en.editor.pick,
  dragdrop: en.editor.dragdrop,
  xray: en.editor.xray,
  xrayScopeInstance: en.editor.xrayScope.instance,
  xrayScopeAll: en.editor.xrayScope.all,
  panelTitle: en.editor.panelTitle,
  close: en.editor.close,
  undo: en.editor.undo,
  redo: en.editor.redo,
  expandSheet: en.editor.sheet.expand,
  collapseSheet: en.editor.sheet.collapse,
  apply: en.editor.apply,
  freeformPlaceholder: en.editor.freeformPlaceholder,
  addClass: en.editor.list.addClass,
  addStyleProp: en.editor.list.addStyleProp,
  removeRow: (name: string): string =>
    en.editor.list.remove.replace("{name}", name),
  styleKeyPlaceholder: en.editor.list.styleKeyPlaceholder,
  styleValuePlaceholder: en.editor.list.styleValuePlaceholder,
  /** Collapsed-by-default section triggers (contain name + value summary). */
  classNameTrigger: "className",
  styleTrigger: /^style/,
  properties: en.editor.tabs.properties,
  structure: en.editor.tabs.structure,
  actions: en.editor.tabs.actions,
  insert: en.editor.structure.insert,
  group: en.editor.structure.group,
  ungroup: en.editor.structure.ungroup,
  duplicate: en.editor.structure.duplicate,
  moveUp: en.editor.structure.moveUp,
  moveDown: en.editor.structure.moveDown,
  remove: en.editor.structure.remove,
  noChildren: en.editor.structure.noChildren,
  breadcrumb: en.editor.structure.breadcrumb,
  pickerTitle: en.editor.picker.title,
  pickerGroupTitle: en.editor.picker.groupTitle,
  pickerSearch: en.editor.picker.search,
  instanceScope: (index: number, count: number, path: string): string =>
    en.editor.instance.scope
      .replace("{index}", String(index))
      .replace("{count}", String(count))
      .replace("{path}", path),
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

export const SERVICE = {
  title: en.service.title,
  description: en.service.description,
  switchAndRetry: en.service.switchAndRetry,
  dismiss: en.service.dismiss,
  noChanges: en.service.noChanges,
} as const;

export const historyButtonName = (count?: number): string =>
  count === undefined ? ACTIONS.history : `${ACTIONS.history} ${count}`;

/**
 * The account-menu trigger is labelled `Account menu ({email})` — the
 * authed suites address it by the dedicated identity's interpolated label.
 */
export const accountMenuLabel = (email: string): string =>
  SHELL.accountMenu.replace("{email}", email);

/**
 * Row select-button locator for a history entry. Anchored with `^` so it
 * never matches the per-row export button (aria-label "Export JSON: {title}"
 * embeds the same prompt) — strict mode would otherwise see two buttons.
 */
export const entryRowName = (prompt: string): RegExp =>
  new RegExp(`^${prompt}`);

/** JSON import/export buttons + dialog copy (en). */
export const JSON_IO = {
  import: en.playground.importJson,
  importedEntry: en.playground.importedEntry,
  dialogTitle: en.playground.jsonDialogTitle,
  importConfirm: en.playground.jsonImport,
  cancel: en.playground.jsonCancel,
  invalidJson: en.playground.jsonInvalidJson,
  copied: en.playground.jsonCopied,
  pick: en.editor.pick,
  /**
   * The RENDERED placeholder — the raw message quote-escapes braces
   * (`'{' … '}'`, next-intl ICU); a fallback (parse failure) would render
   * the key path instead, which this assertion catches.
   */
  placeholder: '{ "root": "page", "elements": { … } }',
  /** Per-row export button — title makes every history row uniquely named. */
  entryExport: (title: string): string =>
    en.playground.jsonExportEntry.replace("{title}", title),
} as const;

/** next-intl interpolates `{key}` — mirror it for locator assertions. */
export const dndGhostLabel = (key: string): string =>
  en.editor.dnd.grabbed.replace("{key}", key);
