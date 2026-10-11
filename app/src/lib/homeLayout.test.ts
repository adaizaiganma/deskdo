import { describe, expect, test } from "vitest";
import { clampBox, collides, compact, DEFAULT_LAYOUT, type Box } from "./homeLayout.svelte";

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
  test("keeps inside the grid and above the minimum size", () => {
    expect(clampBox(box("matrix", 10, -2, 2, 1))).toEqual(box("matrix", 7, 0, 5, 6));
    expect(clampBox(box("date", 0, 0, 20, 2))).toEqual(box("date", 0, 0, 12, 2));
  });
});
