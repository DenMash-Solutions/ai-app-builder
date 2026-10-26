import { Playground } from "@/components/playground";

// @next-codemod-ignore Cache Components adoption: this segment temporarily allows blocking.
// Remove this opt-out after verifying the segment passes validation without it.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Permanent playground landing (plan: root is taken by the featured live
 * page, so the playground lives at /{locale}/ui — slug `ui` was already
 * reserved for this; the auth flows and the live-page pill land here).
 */
export default function UiLandingPage() {
  return <Playground />;
}
