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

  test("a title that only names the category is left out", () => {
    expect(toQuote({ content: "a", author: "863885806", source: "网络" })?.source).toBe("863885806");
    expect(toQuote({ content: "a", author: "陈树凤", source: "原创" })?.source).toBe("陈树凤");
    expect(toQuote({ content: "a", author: "网络", source: "网络" })?.source).toBe("网络");
    expect(toQuote({ content: "a", source: "原创" })?.source).toBe("原创");
  });

  test("converts every part", () => {
    expect(toQuote({ content: "x", author: "y", source: "z" }, (s) => s.toUpperCase())).toEqual({ text: "X", source: "Y《Z》" });
  });
});
