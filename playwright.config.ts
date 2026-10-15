import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  // Dependency chain: chromium (anonymous, read-only, featured-dependent)
  // fully completes before authed (state-mutating) runs, and sign-out —
  // which revokes the shared session — runs dead last. Iteration shortcut:
  // bun run test:e2e -- --project=authed --no-deps
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/authed.spec.ts", "**/signout.spec.ts"],
    },
    // Dedicated e2e identities (never a personal session), logged in via
    // the storage states global-setup saved.
    {
      name: "authed",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.state/admin.json",
      },
      testMatch: "**/authed.spec.ts",
      dependencies: ["chromium"],
    },
    {
      name: "signout",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.state/admin.json",
      },
      testMatch: "**/signout.spec.ts",
      dependencies: ["authed"],
    },
  ],
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
