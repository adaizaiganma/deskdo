import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

describe("qrPath", () => {
  it("draws a square with a quiet zone and finder patterns", () => {
    const { size, d } = qrPath("https://deskdo.example.workers.dev/app/");
    // 版本 3（29 格）加兩邊各 4 格白邊
    expect(size).toBe(37);
    // 左上角的定位圖案從 (4,4) 開始，白邊上沒有黑點
    expect(d.startsWith("M4 4h1v1h-1z")).toBe(true);
    expect(d).not.toMatch(/M[0-3] |M\d+ [0-3]h/);
  });
});
