import { Playground } from "@/components/playground";

/**
 * Permanent playground landing (plan: root is taken by the featured live
 * page, so the playground lives at /{locale}/ui — slug `ui` was already
 * reserved for this; the auth flows and the live-page pill land here).
 */
export default function UiLandingPage() {
  return <Playground />;
}
