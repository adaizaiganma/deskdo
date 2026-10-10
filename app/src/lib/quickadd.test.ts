import { describe, expect, test } from "vitest";
import { groupTodos, rowDue } from "./dates";
import { parseDue, parseQuickAdd } from "./quickadd";
import type { Todo } from "./types";

const TODAY = "2026-10-10"; // 週六

describe("parseQuickAdd", () => {
  test("plain title", () => {
    expect(parseQuickAdd("買牛奶", TODAY)).toEqual({ title: "買牛奶" });
  });

  test("all tokens", () => {
    expect(parseQuickAdd("交作業三 #微積分 @明天 !", TODAY)).toEqual({
      title: "交作業三", tag: "微積分", due: "2026-10-11", priority: "high",
    });
  });

  test("fullwidth symbols", () => {
    expect(parseQuickAdd("報告 ＃專題 ＠後天 ！", TODAY)).toEqual({
      title: "報告", tag: "專題", due: "2026-10-12", priority: "high",
    });
  });

  test("empty title", () => {
    expect(parseQuickAdd("#微積分 @明天", TODAY)).toBeNull();
    expect(parseQuickAdd("   ", TODAY)).toBeNull();
  });

  test("unparseable date stays in title", () => {
    expect(parseQuickAdd("寄信給 @someone", TODAY)).toEqual({ title: "寄信給 @someone" });
  });
});

describe("parseDue", () => {
  test("weekdays", () => {
    expect(parseDue("週一", TODAY)).toBe("2026-10-12");
    expect(parseDue("週六", TODAY)).toBe(TODAY);
    expect(parseDue("星期日", TODAY)).toBe("2026-10-11");
    expect(parseDue("周天", TODAY)).toBe("2026-10-11");
    expect(parseDue("下週三", TODAY)).toBe("2026-10-14");
    expect(parseDue("下週一", "2026-10-12")).toBe("2026-10-19");
  });

  test("numeric dates", () => {
    expect(parseDue("10/15", TODAY)).toBe("2026-10-15");
    expect(parseDue("1-5", TODAY)).toBe("2027-01-05");
    expect(parseDue("9/30", TODAY)).toBe("2026-09-30"); // 最近剛過的日期不跳到明年
    expect(parseDue("2026-12-01", TODAY)).toBe("2026-12-01");
    expect(parseDue("2/30", TODAY)).toBeNull();
  });
});

function todo(id: string, due: string | null, priority: "high" | "normal" = "normal"): Todo {
  return {
    id, title: id, done: false, doneAt: null, due, tag: null, priority, note: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", source: "manual", sourceRef: null,
  };
}

describe("groupTodos", () => {
  test("groups by due date and drops empty groups", () => {
    const groups = groupTodos(
      [todo("a", "2026-10-08"), todo("b", TODAY), todo("c", "2026-10-11"), todo("d", "2026-10-17"),
        todo("e", "2026-10-18"), todo("f", null)],
      TODAY,
    );
    expect(groups.map((g) => [g.key, g.items.map((t) => t.id)])).toEqual([
      ["overdue", ["a"]], ["today", ["b"]], ["tomorrow", ["c"]], ["week", ["d"]], ["later", ["e"]], ["none", ["f"]],
    ]);
  });

  test("high priority first within the same day", () => {
    const [g] = groupTodos([todo("n", TODAY), todo("h", TODAY, "high")], TODAY);
    expect(g.items.map((t) => t.id)).toEqual(["h", "n"]);
  });
});

test("rowDue", () => {
  expect(rowDue("2026-10-08", TODAY)).toEqual({ count: "逾期 2 天", date: "10/8", tone: "warn" });
  expect(rowDue(TODAY, TODAY)).toEqual({ count: "今天到期", date: "", tone: "warn" });
  expect(rowDue("2026-10-11", TODAY)).toEqual({ count: "還有 1 天", date: "週日 10/11", tone: "soon" });
  expect(rowDue("2026-10-13", TODAY)).toEqual({ count: "還有 3 天", date: "週二 10/13", tone: "soon" });
  expect(rowDue("2026-10-14", TODAY)).toEqual({ count: "還有 4 天", date: "週三 10/14", tone: "" });
  expect(rowDue("2026-10-30", TODAY)).toEqual({ count: "還有 20 天", date: "10/30", tone: "" });
  expect(rowDue("2027-01-05", TODAY)).toEqual({ count: "還有 87 天", date: "2027/1/5", tone: "" });
});
