import {
  releaseRunLock,
  restoreFeaturedIfRecovery,
  sweepOwnLeftovers,
} from "./db";
import { canSeed, e2eEnv, hasAdminAuth } from "./env";

/**
 * Global teardown (plan: e2e-hardening), in order:
 *
 * 1. second line of defense for the featured pointer — if the admin test
 *    died before its own `finally` could restore the captured value, this
 *    consumes the recovery record now (fail loud: the record survives for
 *    the next run if this write fails),
 * 2. sweep marker-scoped leftovers AFTER every context is closed — the
 *    parallel tests share one account, so a sibling context's full-state
 *    push can re-upload an entry another test already deleted; nothing
 *    pushes anymore at this point, so the sweep is authoritative,
 * 3. release the run lock (only when this process owns it).
 */
export default async function globalTeardown(): Promise<void> {
  if (canSeed) {
    await restoreFeaturedIfRecovery();

    if (hasAdminAuth) {
      try {
        const swept = await sweepOwnLeftovers(e2eEnv.adminEmail);
        if (swept > 0) {
          console.warn(
            `[e2e] teardown swept ${swept} leftover test row(s) (re-uploaded by parallel contexts)`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[e2e] teardown sweep failed (next run's setup will retry): ${message}`,
        );
      }
    }
  }
  releaseRunLock();
}
