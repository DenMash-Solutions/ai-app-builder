import { notFound } from "next/navigation";

/**
 * /{locale}/user/{username} — not a page (plan 068); the profile is one level
 * deeper, at /{locale}/user/{username}/ui. Same reasoning as the sibling
 * `user/page.tsx`: because `user` is an app segment the proxy leaves these
 * paths alone, and the `/{locale}/{slug}` catch-all would otherwise match
 * slug `user` and answer 200 with a client-side not-found (soft 404).
 * `instant = false` keeps the status real.
 */
export const instant = false;

export default function UserHandlePage(): never {
  notFound();
}
