import { describe, expect, it } from "vitest";
import { Dish, folderRadius } from "./bubbles";

function settle(d: Dish, n = 600) {
  for (let i = 0; i < n && d.step(); i++);
}

describe("Dish", () => {
  const specs = [
    { name: "課程", hue: 214, tags: [{ tag: "電路學", r: 30 }, { tag: "微積分", r: 28 }] },
    { name: "生活", hue: 152, tags: [{ tag: "買菜", r: 26 }] },
  ];
  const loose = [{ tag: "雜事", r: 26 }, { tag: "社團", r: 24 }];

  function make() {
    const d = new Dish();
    d.resize(900, 600);
    d.sync(specs, loose);
    settle(d);
    return d;
  }

  it("settles with tags inside their folders and loose tags outside every folder", () => {
    const d = make();
    for (const f of specs) {
      const fb = d.folders.get(f.name)!;
      for (const t of f.tags) {
        const tb = d.tags.get(t.tag)!;
        expect(Math.hypot(tb.x - fb.x, tb.y - fb.y) + tb.r).toBeLessThanOrEqual(fb.r + 1);
      }
    }
    for (const t of loose) {
      const tb = d.tags.get(t.tag)!;
      for (const fb of d.folders.values()) expect(Math.hypot(tb.x - fb.x, tb.y - fb.y)).toBeGreaterThan(fb.r + tb.r);
    }
  });

  it("keeps folders apart and inside the dish", () => {
    const d = make();
    const [a, b] = [...d.folders.values()];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    for (const f of d.folders.values()) {
      expect(f.x - f.r).toBeGreaterThanOrEqual(0);
      expect(f.x + f.r).toBeLessThanOrEqual(900);
    }
  });

  it("reports the folder under a dragged tag", () => {
    const d = make();
    const f = d.folders.get("生活")!;
    d.startDrag("tag", "雜事");
    d.dragTo(f.x, f.y, f.x, f.y);
    expect(d.hover).toBe("生活");
    expect(d.tags.get("雜事")!.x).toBe(f.x);
    d.endDrag();
    expect(d.hover).toBeNull();
  });

  it("grows a folder as tags are added", () => {
    expect(folderRadius([30, 30, 30])).toBeGreaterThan(folderRadius([30]));
    expect(folderRadius([])).toBeGreaterThan(0);
  });

  it("keeps a folder's position when renamed", () => {
    const d = make();
    const before = d.folders.get("課程")!;
    const { x, y } = before;
    d.rename("課程", "學校");
    expect(d.folders.get("學校")).toMatchObject({ x, y });
    expect(d.tags.get("電路學")!.folder).toBe("學校");
  });
});
