import { describe, expect, test } from "vitest";
import { addMonths, dayDistance, monthGrid } from "./dates";

describe("addMonths", () => {
  test("within and across years", () => {
    expect(addMonths("2026-10", 1)).toBe("2026-11");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
  });
});

describe("monthGrid", () => {
  test("starts on Monday and ends on Sunday", () => {
    // 2026-10-01 是週四，10-31 是週六
    const days = monthGrid("2026-10");
    expect(days[0]).toBe("2026-09-28");
    expect(days.at(-1)).toBe("2026-11-01");
    expect(days.length).toBe(35);
  });

  test("month that starts on Monday", () => {
    // 2026-06-01 是週一，06-30 是週二
    const days = monthGrid("2026-06");
    expect(days[0]).toBe("2026-06-01");
    expect(days.at(-1)).toBe("2026-07-05");
  });

  test("February that fits in four weeks", () => {
    // 2027-02-01 是週一，28 天剛好四週
    expect(monthGrid("2027-02").length).toBe(28);
  });
});

describe("dayDistance", () => {
  test("labels", () => {
    expect(dayDistance("2026-10-11", "2026-10-11")).toBe("今天");
    expect(dayDistance("2026-10-12", "2026-10-11")).toBe("明天");
    expect(dayDistance("2026-10-10", "2026-10-11")).toBe("昨天");
    expect(dayDistance("2026-10-15", "2026-10-11")).toBe("4 天後");
    expect(dayDistance("2026-10-01", "2026-10-11")).toBe("10 天前");
  });
});
