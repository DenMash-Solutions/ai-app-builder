import { describe, expect, test } from "bun:test";
import {
  checkUsername,
  normalizeUsername,
  USERNAME_ISSUES,
  USERNAME_MIN_LENGTH,
  usernameIssue,
} from "@/lib/usernames";
import { RESERVED_SLUGS, SLUG_MAX_LENGTH } from "@/lib/slug";

describe("usernames (068)", () => {
  test("normalizes to the slug grammar — diacritics, case, punctuation", () => {
    expect(normalizeUsername("Ana López")).toBe("ana-lopez");
    expect(normalizeUsername("  MAX__Power!! ")).toBe("max-power");
    expect(normalizeUsername("Ünïcode-Ñame")).toBe("unicode-name");
    expect(normalizeUsername("already-fine")).toBe("already-fine");
  });

  test("normalization is idempotent — a stored handle round-trips", () => {
    const once = normalizeUsername("Ana  López");
    expect(normalizeUsername(once)).toBe(once);
  });

  test("rejects empty and too-short handles", () => {
    expect(usernameIssue("")).toBe(USERNAME_ISSUES.empty);
    expect(usernameIssue("ab")).toBe(USERNAME_ISSUES.tooShort);
    expect(usernameIssue("a".repeat(USERNAME_MIN_LENGTH))).toBeNull();
  });

  test("rejects handles past the slug ceiling", () => {
    expect(usernameIssue("a".repeat(SLUG_MAX_LENGTH))).toBeNull();
    expect(usernameIssue("a".repeat(SLUG_MAX_LENGTH + 1))).toBe(
      USERNAME_ISSUES.tooLong,
    );
  });

  test("rejects raw text that is not in slug shape", () => {
    // `usernameIssue` judges the normalized value, so these only fail when
    // the caller skipped normalization — the check is a real guard, not a
    // tautology.
    expect(usernameIssue("Ana López")).toBe(USERNAME_ISSUES.pattern);
    expect(usernameIssue("-lead")).toBe(USERNAME_ISSUES.pattern);
    expect(usernameIssue("trail-")).toBe(USERNAME_ISSUES.pattern);
    expect(usernameIssue("double--hyphen")).toBe(USERNAME_ISSUES.pattern);
    expect(usernameIssue("dot.ted")).toBe(USERNAME_ISSUES.pattern);
  });

  test("every reserved app segment is refused as a username", () => {
    for (const segment of Object.values(RESERVED_SLUGS)) {
      expect(usernameIssue(segment)).toBe(USERNAME_ISSUES.reserved);
    }
    // The new one, explicitly — it is the profile route's own prefix.
    expect(usernameIssue("user")).toBe(USERNAME_ISSUES.reserved);
  });

  test("checkUsername normalizes then judges in one step", () => {
    expect(checkUsername("Ana López")).toEqual({
      username: "ana-lopez",
      issue: null,
    });
    expect(checkUsername("UI")).toEqual({
      username: "ui",
      issue: USERNAME_ISSUES.reserved,
    });
    expect(checkUsername("  ")).toEqual({
      username: "",
      issue: USERNAME_ISSUES.empty,
    });
  });
});
