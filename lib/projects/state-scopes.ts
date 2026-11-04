/**
 * The three state scopes a screen author chooses between (plan 067, decision
 * 1/2). Constants only — no hooks (the lib/ dependency-injection rule): the
 * editor resolves the label/description keys through `useTranslations`, and a
 * test asserts every key exists in every locale.
 *
 * Why the copy lives here and not in the plan: an author picking a state path
 * in the States tab has no other place to learn that `/session` is shared per
 * PROJECT (061-4), that a screen's own state is private to that screen, and
 * that durable records (cart, orders) belong in a resource — not in
 * `/session`, whose stamp-guarded bridge is sized for small values.
 */

export const PROJECT_STATE_SCOPES = {
  session: {
    id: "session",
    labelKey: "editor.states.scopes.session.label",
    descriptionKey: "editor.states.scopes.session.description",
  },
  screen: {
    id: "screen",
    labelKey: "editor.states.scopes.screen.label",
    descriptionKey: "editor.states.scopes.screen.description",
  },
  resource: {
    id: "resource",
    labelKey: "editor.states.scopes.resource.label",
    descriptionKey: "editor.states.scopes.resource.description",
  },
} as const;

export type ProjectStateScope =
  (typeof PROJECT_STATE_SCOPES)[keyof typeof PROJECT_STATE_SCOPES];

export type ProjectStateScopeId = ProjectStateScope["id"];

/** Render order: shared first (what most authors reach for), then the
 *  narrower scopes. */
export const PROJECT_STATE_SCOPE_LIST: readonly ProjectStateScope[] = [
  PROJECT_STATE_SCOPES.session,
  PROJECT_STATE_SCOPES.screen,
  PROJECT_STATE_SCOPES.resource,
];
