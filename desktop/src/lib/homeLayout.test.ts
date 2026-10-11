import { describe, expect, test } from "vitest";
import { clampBox, collides, compact, DEFAULT_LAYOUT, arrange, firstFit, type Box } from "./homeLayout.svelte";

const box = (id: Box["id"], x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });

describe("compact", () => {
  test("default layout has no overlaps and is already compact", () => {
    const out = compact(DEFAULT_LAYOUT);
    expect(out).toEqual(DEFAULT_LAYOUT);
    for (const a of out) for (const b of out) expect(collides(a, b)).toBe(false);
  });

  test("items float up into empty space", () => {
    expect(compact([box("date", 0, 5, 4, 2)])).toEqual([box("date", 0, 0, 4, 2)]);
  });

  test("a fixed item stays and pushes the others below it", () => {
    const out = compact([box("date", 0, 0, 6, 2), box("quote", 0, 1, 6, 2)], "quote");
    expect(out).toEqual([box("date", 0, 3, 6, 2), box("quote", 0, 1, 6, 2)]);
  });

  test("side by side items keep their rows", () => {
    const out = compact([box("date", 0, 0, 6, 3), box("clock", 6, 0, 6, 3), box("quote", 0, 3, 12, 2)]);
    expect(out.map((b) => b.y)).toEqual([0, 0, 3]);
  });
});

describe("clampBox", () => {
  test("keeps the position positive and the size above the minimum", () => {
    expect(clampBox(box("matrix", 10, -2, 2, 1))).toEqual(box("matrix", 10, 0, 6, 5));
    expect(clampBox(box("date", -1, 0, 20, 2))).toEqual(box("date", 0, 0, 20, 2));
  });
});

describe("arrange", () => {
  test("leaves a layout that fits alone", () => {
    expect(arrange(DEFAULT_LAYOUT, 9)).toEqual(DEFAULT_LAYOUT);
  });

  test("moves and shrinks items to fit fewer columns", () => {
    const out = arrange(DEFAULT_LAYOUT, 6);
    for (const b of out) expect(b.x + b.w).toBeLessThanOrEqual(6);
    for (const a of out) for (const b of out) expect(collides(a, b)).toBe(false);
    expect(out.find((b) => b.id === "clock")).toEqual(box("clock", 0, 2, 3, 3));
    expect(out.find((b) => b.id === "matrix")!.w).toBe(6);
  });
});

describe("firstFit", () => {
  test("finds the first free spot from the top left", () => {
    expect(firstFit(DEFAULT_LAYOUT, "cd:a", 3, 2, 12)).toEqual(box("cd:a", 9, 0, 3, 2));
    expect(firstFit(DEFAULT_LAYOUT, "cd:a", 3, 2, 10)).toEqual(box("cd:a", 7, 3, 3, 2));
    expect(firstFit(DEFAULT_LAYOUT, "cd:a", 3, 2, 9)).toEqual(box("cd:a", 0, 11, 3, 2));
  });
});
