import { notFound } from "next/navigation";

/**
 * /{locale}/user — not a page (plan 068). The profile lives at
 * /{locale}/user/{username}/ui, and `user` is an app segment, so the proxy no
 * longer rewrites two-segment content paths that lead with it. Without this
 * route the `/{locale}/{slug}` catch-all answers 200 and shows the client-side
 * not-found UI — a soft 404 — for `/en/user`. `instant = false` keeps the
 * status real (it can only be set before the body streams).
 */
export const instant = false;

export default function UserRootPage(): never {
  notFound();
}
