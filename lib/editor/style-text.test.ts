import { describe, expect, test } from "bun:test";
import {
  parseStyleText,
  rowsToStyleRecord,
  serializeStyleText,
  styleRecordToRows,
} from "./style-text";

describe("parseStyleText", () => {
  test("parses camelCase declarations and promotes pure numbers", () => {
    expect(parseStyleText("width: 100%; backgroundColor: #e0f2fe")).toEqual({
      width: "100%",
      backgroundColor: "#e0f2fe",
    });
    expect(parseStyleText("zIndex: 10; opacity: 0.5")).toEqual({
      zIndex: 10,
      opacity: 0.5,
    });
  });

  test("converts kebab-case keys to camelCase", () => {
    expect(
      parseStyleText("background-color: #e0f2fe; font-size: 14px"),
    ).toEqual({
      backgroundColor: "#e0f2fe",
      fontSize: "14px",
    });
  });

  test("keeps custom properties untouched", () => {
    expect(parseStyleText("--ring-color: #fff")).toEqual({
      "--ring-color": "#fff",
    });
  });

  test("returns null for empty or malformed text", () => {
    expect(parseStyleText("")).toBeNull();
    expect(parseStyleText("   ")).toBeNull();
    expect(parseStyleText(";;")).toBeNull();
    expect(parseStyleText("no-colon-here")).toBeNull();
    expect(parseStyleText("width:")).toBeNull();
    expect(parseStyleText(": 100%")).toBeNull();
  });
});

describe("serializeStyleText", () => {
  test("serializes a style record to canonical declaration text", () => {
    expect(
      serializeStyleText({ width: "100%", backgroundColor: "#e0f2fe" }),
    ).toBe("width: 100%; backgroundColor: #e0f2fe");
    expect(serializeStyleText({ zIndex: 10 })).toBe("zIndex: 10");
  });

  test("returns empty text for null, undefined, and non-objects", () => {
    expect(serializeStyleText(null)).toBe("");
    expect(serializeStyleText(undefined)).toBe("");
    expect(serializeStyleText("width: 100%")).toBe("");
    expect(serializeStyleText(["width"])).toBe("");
  });

  test("round-trips model style objects through parse", () => {
    const style = { width: "100%", backgroundColor: "#e0f2fe", zIndex: 10 };
    expect(parseStyleText(serializeStyleText(style))).toEqual(style);
  });

  test("round-trips kebab-case input to canonical camelCase output", () => {
    const text = "background-color: #e0f2fe; width: 100%";
    const canonical = serializeStyleText(parseStyleText(text));
    expect(canonical).toBe("backgroundColor: #e0f2fe; width: 100%");
    expect(parseStyleText(canonical)).toEqual(
      parseStyleText("width: 100%; background-color: #e0f2fe"),
    );
  });
});

describe("styleRecordToRows", () => {
  test("converts a record to insertion-order rows with stringified values", () => {
    expect(
      styleRecordToRows({ backgroundColor: "#60a5fa", zIndex: 10 }),
    ).toEqual([
      { key: "backgroundColor", value: "#60a5fa" },
      { key: "zIndex", value: "10" },
    ]);
  });

  test("returns [] for null, undefined, arrays, and non-scalars", () => {
    expect(styleRecordToRows(null)).toEqual([]);
    expect(styleRecordToRows(undefined)).toEqual([]);
    expect(styleRecordToRows({ width: "100%" })).toEqual([
      { key: "width", value: "100%" },
    ]);
    expect(styleRecordToRows(["width"])).toEqual([]);
    expect(styleRecordToRows({ fn: () => undefined })).toEqual([]);
  });
});

describe("rowsToStyleRecord", () => {
  test("camelCases keys and promotes pure numbers", () => {
    expect(
      rowsToStyleRecord([
        { key: "background-color", value: "#e0f2fe" },
        { key: "font-size", value: "14px" },
        { key: "zIndex", value: "10" },
        { key: "opacity", value: "0.5" },
      ]),
    ).toEqual({
      backgroundColor: "#e0f2fe",
      fontSize: "14px",
      zIndex: 10,
      opacity: 0.5,
    });
  });

  test("keeps custom properties untouched", () => {
    expect(rowsToStyleRecord([{ key: "--ring-color", value: "#fff" }])).toEqual(
      { "--ring-color": "#fff" },
    );
  });

  test("drops rows with empty key or value", () => {
    expect(
      rowsToStyleRecord([
        { key: "", value: "100%" },
        { key: "width", value: "   " },
        { key: "  ", value: "10px" },
        { key: "height", value: " 20px " },
      ]),
    ).toEqual({ height: "20px" });
  });

  test("duplicate keys resolve last-wins", () => {
    expect(
      rowsToStyleRecord([
        { key: "color", value: "red" },
        { key: "color", value: "blue" },
      ]),
    ).toEqual({ color: "blue" });
  });

  test("returns null when no row is valid", () => {
    expect(rowsToStyleRecord([])).toBeNull();
    expect(
      rowsToStyleRecord([
        { key: "", value: "" },
        { key: "width", value: "" },
      ]),
    ).toBeNull();
  });

  test("round-trips records through rows", () => {
    const style = {
      backgroundColor: "#60a5fa",
      padding: 12,
      "--ring-color": "#fff",
    };
    expect(rowsToStyleRecord(styleRecordToRows(style))).toEqual(style);
  });
});
