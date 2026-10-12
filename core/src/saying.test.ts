import { describe, expect, test } from "vitest";
import { toQuote } from "./saying.svelte";

describe("toQuote", () => {
  test("author and title become 作者《篇名》", () => {
    expect(toQuote({ content: " 采得百花成蜜后，为谁辛苦为谁甜。", author: "罗隐", source: "蜂" })).toEqual({
      text: "采得百花成蜜后，为谁辛苦为谁甜。",
      source: "罗隐《蜂》",
    });
  });

  test("only one of them, or neither", () => {
    expect(toQuote({ content: "a", author: "罗隐" })?.source).toBe("罗隐");
    expect(toQuote({ content: "a", source: "蜂" })?.source).toBe("蜂");
    expect(toQuote({ content: "a" })?.source).toBe("");
  });

  test("no text, no quote", () => {
    expect(toQuote({ content: "  " })).toBeNull();
    expect(toQuote({})).toBeNull();
  });

  test("converts every part", () => {
    expect(toQuote({ content: "x", author: "y", source: "z" }, (s) => s.toUpperCase())).toEqual({ text: "X", source: "Y《Z》" });
  });
});
