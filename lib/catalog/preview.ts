/**
 * Preview-project lifecycle helpers (plan 073, decision 2): a template
 * preview IS a normal local project whose name carries a marker prefix.
 * Keeping the marker in the NAME (not a separate store) means every existing
 * surface — the drawer, the project switcher, the live project route — works
 * on a preview with zero changes, and "Use this template" is a rename.
 */

export const PREVIEW_PROJECT_PREFIX = "Preview: ";

/** The name a preview project is created under. */
export function previewProjectName(templateName: string): string {
  return `${PREVIEW_PROJECT_PREFIX}${templateName}`;
}

/** True when `name` carries the preview marker. */
export function isPreviewProject(name: string): boolean {
  return name.startsWith(PREVIEW_PROJECT_PREFIX);
}

/** The template name a preview project was created from. */
export function previewTemplateName(name: string): string {
  return isPreviewProject(name)
    ? name.slice(PREVIEW_PROJECT_PREFIX.length)
    : name;
}
