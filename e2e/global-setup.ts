import { spawnSync } from "node:child_process";

export default function globalSetup() {
  const result = spawnSync(
    "bun",
    [
      "build",
      "e2e/msw/init.ts",
      "--outfile",
      "e2e/msw/init.generated.js",
      "--format=iife",
      "--target=browser",
      "--define:process.env.NODE_ENV=\"development\"",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Failed to bundle the MSW init script");
  }
}
