import { SyncEngine } from "@/components/sync/sync-engine";
import { UploadNudge } from "@/components/sync/upload-nudge";

/**
 * App surfaces (playground, admin, auth) speak the app's languages only —
 * the UI has no catalogs beyond them. Content-only locales may pass the
 * [locale] layout but must reach nothing but content routes (decisions 11
 * and 12): `/fr/denmash` serves, `/fr` serves the featured root, `/fr/ui`
 * is a 404. That locale gate used to live here as a `notFound()`, and plan
 * 056 F3 moved it to `proxy.ts` (decision before the body streams; the
 * parent's throw also poisoned every child segment's Cache Components
 * validation). The root page itself lives outside this group so it can
 * serve the featured design in every language it carries.
 *
 * Account sync lives HERE, not in the root layout (plan 055): history can
 * only change on these surfaces, and the read-only preview/published
 * routes must never pay for a pull+push cycle. One mount for the whole
 * group means `/ui` → `/ui/[id]` navigation never restarts the sync.
 *
 * No params, no request data — this segment validates clean.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SyncEngine />
      <UploadNudge />
      {children}
    </>
  );
}
