import { describe, expect, test } from "vitest";
import { addMonths, dayDistance, fullDate, longDate, monthGrid, monthTitle, nextYearly, rowDue, spanParts, spanText } from "./dates";
import { i18n } from "./i18n.svelte";
import { QUOTES, quoteOf } from "./quotes";

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

describe("nextYearly", () => {
  test("this year or next", () => {
    expect(nextYearly("2001-12-25", "2026-10-11")).toBe("2026-12-25");
    expect(nextYearly("2001-03-01", "2026-10-11")).toBe("2027-03-01");
    expect(nextYearly("2001-10-11", "2026-10-11")).toBe("2026-10-11");
  });

  test("leap day in a common year", () => {
    expect(nextYearly("2004-02-29", "2026-10-11")).toBe("2027-02-28");
    expect(nextYearly("2004-02-29", "2027-10-11")).toBe("2028-02-29");
  });
});

describe("spanParts", () => {
  test("years, months and days", () => {
    expect(spanParts("2025-08-20", "2026-10-11")).toEqual({ years: 1, months: 1, days: 21 });
    expect(spanParts("2026-10-11", "2025-08-20")).toEqual({ years: 1, months: 1, days: 21 });
    expect(spanParts("2026-01-31", "2026-03-01")).toEqual({ years: 0, months: 1, days: 1 });
    expect(spanParts("2025-12-15", "2026-01-10")).toEqual({ years: 0, months: 0, days: 26 });
  });

  test("text", () => {
    expect(spanText("2026-10-11", "2026-10-30")).toBe("");
    expect(spanText("2026-10-11", "2027-10-11")).toBe("1 年");
    expect(spanText("2026-10-11", "2026-12-14")).toBe("2 個月 3 天");
  });
});

describe("quoteOf", () => {
  test("same day, same quote; next day, next quote", () => {
    expect(quoteOf("2026-10-11")).toBe(quoteOf("2026-10-11"));
    const i = QUOTES.indexOf(quoteOf("2026-10-11"));
    expect(QUOTES.indexOf(quoteOf("2026-10-12"))).toBe((i + 1) % QUOTES.length);
  });
});

describe("english", () => {
  test("labels", () => {
    i18n.pref = "en";
    try {
      expect(dayDistance("2026-10-15", "2026-10-11")).toBe("in 4 days");
      expect(dayDistance("2026-10-10", "2026-10-11")).toBe("Yesterday");
      expect(spanText("2026-10-11", "2027-12-12")).toBe("1 year 2 months 1 day");
      expect(longDate("2026-10-16")).toBe("Fri, Oct 16");
      expect(fullDate("2026-10-11")).toBe("Sun, Oct 11, 2026");
      expect(monthTitle("2026-10")).toBe("October 2026");
      expect(rowDue("2026-10-09", "2026-10-11").count).toBe("2 days overdue");
      expect(rowDue("2026-10-12", "2026-10-11").count).toBe("1 day left");
    } finally {
      i18n.pref = "zh";
    }
  });
});
