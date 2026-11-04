import { describe, expect, test } from "bun:test";
import en from "@/lib/i18n/locale/en.json";
import es from "@/lib/i18n/locale/es.json";
import { PROJECT_STATE_SCOPES, PROJECT_STATE_SCOPE_LIST } from "./state-scopes";

const resolve = (messages: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );

describe("project state scopes (067)", () => {
  test("three scopes, each owning a label and a description key", () => {
    expect(PROJECT_STATE_SCOPE_LIST.map((scope) => scope.id)).toEqual([
      "session",
      "screen",
      "resource",
    ]);
    for (const scope of PROJECT_STATE_SCOPE_LIST) {
      expect(scope.labelKey).toBe(`editor.states.scopes.${scope.id}.label`);
      expect(scope.descriptionKey).toBe(
        `editor.states.scopes.${scope.id}.description`,
      );
    }
    // The constant map and the render list never drift apart.
    expect(Object.values(PROJECT_STATE_SCOPES)).toEqual([
      ...PROJECT_STATE_SCOPE_LIST,
    ]);
  });

  test("every scope key resolves to copy in en and es", () => {
    const keys = [
      "editor.states.scopes.title",
      ...PROJECT_STATE_SCOPE_LIST.flatMap((scope) => [
        scope.labelKey,
        scope.descriptionKey,
      ]),
    ];
    for (const [locale, messages] of [
      ["en", en],
      ["es", es],
    ] as const) {
      for (const key of keys) {
        const value = resolve(messages, key);
        expect(
          typeof value === "string" && value.trim().length > 0,
          `${locale} is missing ${key}`,
        ).toBe(true);
      }
    }
  });
});
