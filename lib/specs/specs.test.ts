import { describe, expect, it } from "bun:test";
import { validateSpec } from "@json-render/core";
import type { Spec } from "@json-render/core";
import { localizeSpec } from "./localize";
import loginSpecJson from "./login.spec.json";
import signupSpecJson from "./signup.spec.json";
import adminSpecJson from "./admin.spec.json";

// JSON imports are widened to plain literals; the specs satisfy the shape.
const specs: Array<[string, Spec]> = [
  ["login", loginSpecJson as unknown as Spec],
  ["signup", signupSpecJson as unknown as Spec],
  ["admin", adminSpecJson as unknown as Spec],
];

describe("committed page specs", () => {
  for (const [name, spec] of specs) {
    it(`${name} spec is structurally valid`, () => {
      const { valid, issues } = validateSpec(spec);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
      expect(spec.root).toBeTruthy();
      expect(spec.state).toBeTruthy();
    });
  }

  it("localizeSpec resolves $state expressions inside input checks", () => {
    const localized = localizeSpec(specs[0][1], {
      checks: { emailRequired: "Email required" },
    });
    const props = localized.elements["email"].props as {
      checks?: Array<{ message?: string }>;
    };
    expect(props.checks?.[0]?.message).toBe("Email required");
  });

  it("localizeSpec resolves check messages but leaves $state args for lazy engine resolution", () => {
    const localized = localizeSpec(specs[1][1], {});
    const props = localized.elements["confirm"].props as {
      checks?: Array<{ type?: string; args?: { other?: unknown } }>;
    };
    const matches = props.checks?.find((c) => c.type === "matches");
    // Eagerly resolving this would freeze it to the initial empty password.
    expect(matches?.args?.other).toEqual({ $state: "/auth/password" });
  });

  it("login spec binds the auth.login action with email/password params", () => {
    const button = specs[0][1].elements["submit"];
    const binding = button?.on?.["press"];
    expect(binding).toMatchObject({
      action: "auth.login",
      params: {
        email: { $state: "/auth/email" },
        password: { $state: "/auth/password" },
      },
    });
  });
});
