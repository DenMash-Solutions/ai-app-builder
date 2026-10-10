import { describe, expect, test } from "bun:test";
import { findActiveMention, insertMention } from "./mention-token";

describe("findActiveMention", () => {
  test("detects an @token at the caret after whitespace", () => {
    expect(findActiveMention("fix @prod", 9)).toEqual({
      query: "prod",
      start: 4,
      end: 9,
    });
  });

  test("detects an @token at the start of the text", () => {
    expect(findActiveMention("@card", 5)).toEqual({
      query: "card",
      start: 0,
      end: 5,
    });
  });

  test("empty query right after @ still matches", () => {
    expect(findActiveMention("do @", 4)).toEqual({
      query: "",
      start: 3,
      end: 4,
    });
  });

  test("ignores mid-word @ (emails)", () => {
    expect(findActiveMention("user@example.com", 16)).toBeNull();
  });

  test("ignores @ that is not immediately before the caret", () => {
    expect(findActiveMention("@card rest", 11)).toBeNull();
  });

  test("hyphenated keys are part of the token", () => {
    expect(findActiveMention("for @product-card", 17)).toEqual({
      query: "product-card",
      start: 4,
      end: 17,
    });
  });

  test("instance-indexed token (#N) reads as one token", () => {
    expect(findActiveMention("fix @product-image#2", 20)).toEqual({
      query: "product-image#2",
      start: 4,
      end: 20,
    });
  });

  test("trailing # still opens the picker for instance filtering", () => {
    expect(findActiveMention("tune @state-item#", 17)).toEqual({
      query: "state-item#",
      start: 5,
      end: 17,
    });
  });
});

describe("insertMention", () => {
  test("replaces the partial token and returns the caret after it", () => {
    const mention = findActiveMention("fix @prod", 9);
    expect(mention).not.toBeNull();
    if (!mention) return;
    expect(insertMention("fix @prod", mention, "product-card")).toEqual({
      text: "fix @product-card",
      caret: 17,
    });
  });

  test("keeps surrounding text when the token is mid-sentence", () => {
    const mention = findActiveMention("red @stack and blue", 10);
    expect(mention).not.toBeNull();
    if (!mention) return;
    expect(
      insertMention("red @stack and blue", mention, "carousel-row"),
    ).toEqual({
      text: "red @carousel-row and blue",
      caret: 17,
    });
  });

  test("inserts an instance token with its #N suffix", () => {
    const mention = findActiveMention("tune @st", 8);
    expect(mention).not.toBeNull();
    if (!mention) return;
    expect(insertMention("tune @st", mention, "state-item#2")).toEqual({
      text: "tune @state-item#2",
      caret: 18,
    });
  });
});
