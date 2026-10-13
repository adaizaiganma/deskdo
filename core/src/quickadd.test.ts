import { describe, expect, test } from "vitest";
import { groupTodos, isOverdue, relativeDue, rowDue } from "./dates";
import { parseDue, parseQuickAdd, parseSteps, parseTime } from "./quickadd";
import type { Priority, Todo } from "./types";

const TODAY = "2026-10-10"; // 週六

describe("parseQuickAdd", () => {
  test("plain title", () => {
    expect(parseQuickAdd("買牛奶", TODAY)).toEqual({ title: "買牛奶" });
  });

  test("all tokens", () => {
    expect(parseQuickAdd("交作業三 #微積分 @明天 !", TODAY)).toEqual({
      title: "交作業三", tags: ["微積分"], due: "2026-10-11", priority: "high",
    });
  });

  test("fullwidth symbols", () => {
    expect(parseQuickAdd("報告 ＃專題 ＠後天 ！", TODAY)).toEqual({
      title: "報告", tags: ["專題"], due: "2026-10-12", priority: "high",
    });
  });

  test("low priority", () => {
    expect(parseQuickAdd("整理書桌 ~", TODAY)).toEqual({ title: "整理書桌", priority: "low" });
    expect(parseQuickAdd("整理書桌 ～ #宿舍", TODAY)).toEqual({ title: "整理書桌", tags: ["宿舍"], priority: "low" });
    // 只有單獨的 ~ 才算，夾在文字裡的保留在標題
    expect(parseQuickAdd("約 ~3 點", TODAY)).toEqual({ title: "約 ~3 點" });
  });

  test("empty title", () => {
    expect(parseQuickAdd("#微積分 @明天", TODAY)).toBeNull();
    expect(parseQuickAdd("   ", TODAY)).toBeNull();
  });

  test("unparseable date stays in title", () => {
    expect(parseQuickAdd("寄信給 @someone", TODAY)).toEqual({ title: "寄信給 @someone" });
  });
});

describe("parseSteps", () => {
  test("single step is the same as parseQuickAdd", () => {
    expect(parseSteps("買牛奶 #生活", TODAY)).toEqual([{ title: "買牛奶", tags: ["生活"] }]);
  });

  test("tag and priority written once apply to every step", () => {
    expect(parseSteps("做預報 > 印預報 #機工實驗 !", TODAY)).toEqual([
      { title: "做預報", tags: ["機工實驗"], priority: "high" },
      { title: "印預報", tags: ["機工實驗"], priority: "high" },
    ]);
  });

  test("a step's own tag wins", () => {
    expect(parseSteps("寫程式 #robotarm ＞ 寫報告 #自動控制", TODAY)).toEqual([
      { title: "寫程式", tags: ["robotarm"] },
      { title: "寫報告", tags: ["自動控制"] },
    ]);
  });

  test("steps without a due date take the next step's, trailing ones the previous", () => {
    expect(parseSteps("讀講義 → 做預報 @週三 > 印預報 @週四 > 交預報", TODAY)).toEqual([
      { title: "讀講義", due: "2026-10-14" },
      { title: "做預報", due: "2026-10-14" },
      { title: "印預報", due: "2026-10-15" },
      { title: "交預報", due: "2026-10-15" },
    ]);
  });

  test("empty steps are ignored while typing", () => {
    expect(parseSteps("做預報 >", TODAY)).toEqual([{ title: "做預報" }]);
    expect(parseSteps(" > ", TODAY)).toBeNull();
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

  test("several tags", () => {
    expect(parseQuickAdd("期中考 #微積分 #考試 #微積分", TODAY)).toEqual({ title: "期中考", tags: ["微積分", "考試"] });
  });

  test("due time", () => {
    expect(parseQuickAdd("開會 @明天 14:30", TODAY)).toEqual({ title: "開會", due: "2026-10-11", dueTime: "14:30" });
    // 沒寫日期就是今天
    expect(parseQuickAdd("繳費 ＠9：05", TODAY)).toEqual({ title: "繳費", due: TODAY, dueTime: "09:05" });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7:5")).toBeNull();
  });

  test("english", () => {
    expect(parseDue("today", TODAY)).toBe(TODAY);
    expect(parseDue("Tomorrow", TODAY)).toBe("2026-10-11");
    expect(parseDue("tmr", TODAY)).toBe("2026-10-11");
    expect(parseDue("mon", TODAY)).toBe("2026-10-12");
    expect(parseDue("Saturday", TODAY)).toBe(TODAY);
    expect(parseDue("thurs", TODAY)).toBe("2026-10-15");
    expect(parseDue("nextwed", TODAY)).toBe("2026-10-14");
    expect(parseDue("next-mon", "2026-10-12")).toBe("2026-10-19");
    expect(parseDue("monk", TODAY)).toBeNull();
    expect(parseDue("constructor", TODAY)).toBeNull();
    expect(parseQuickAdd("Essay #english @fri 9:00 !", TODAY)).toEqual({
      title: "Essay", tags: ["english"], due: "2026-10-16", dueTime: "09:00", priority: "high",
    });
  });

  test("numeric dates", () => {
    expect(parseDue("10/15", TODAY)).toBe("2026-10-15");
    expect(parseDue("1-5", TODAY)).toBe("2027-01-05");
    expect(parseDue("9/30", TODAY)).toBe("2026-09-30"); // 最近剛過的日期不跳到明年
    expect(parseDue("2026-12-01", TODAY)).toBe("2026-12-01");
    expect(parseDue("2/30", TODAY)).toBeNull();
  });
});

function todo(id: string, due: string | null, priority: Priority = "normal"): Todo {
  return {
    id, title: id, done: false, doneAt: null, due, dueTime: null, tags: [], tag: null, priority, note: null,
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

  test("high priority first and low priority last within the same day", () => {
    const [g] = groupTodos([todo("l", TODAY, "low"), todo("n", TODAY), todo("h", TODAY, "high")], TODAY);
    expect(g.items.map((t) => t.id)).toEqual(["h", "n", "l"]);
  });
});

describe("due time", () => {
  test("parseSteps keeps a step's time to itself and fills its day from the next step", () => {
    expect(parseSteps("做預報 9:00 > 交預報 @週一 #機工實驗", TODAY)).toEqual([
      { title: "做預報", dueTime: "09:00", due: "2026-10-12", tags: ["機工實驗"] },
      { title: "交預報", due: "2026-10-12", tags: ["機工實驗"] },
    ]);
  });

  test("timed items come before all-day ones on the same day", () => {
    const t = (id: string, dueTime: string | null) => ({ ...todo(id, TODAY), dueTime });
    const [g] = groupTodos([t("all", null), t("pm", "15:00"), t("am", "09:00")], TODAY);
    expect(g.items.map((x) => x.id)).toEqual(["am", "pm", "all"]);
  });

  test("a passed time today is overdue", () => {
    const t = { ...todo("a", TODAY), dueTime: "09:00" };
    expect(isOverdue(t, TODAY, "08:59")).toBe(false);
    expect(isOverdue(t, TODAY, "09:01")).toBe(true);
    expect(isOverdue({ ...t, dueTime: null }, TODAY, "23:59")).toBe(false);
    expect(groupTodos([t], TODAY, null, "10:00")[0].key).toBe("overdue");
    expect(rowDue(TODAY, TODAY, "09:00", "08:00")).toEqual({ count: "今天 09:00", date: "", tone: "warn" });
    expect(rowDue(TODAY, TODAY, "09:00", "10:00")).toEqual({ count: "已逾期", date: "今天 09:00", tone: "warn" });
    expect(rowDue("2026-10-11", TODAY, "09:00")).toEqual({ count: "還有 1 天", date: "週日 10/11 09:00", tone: "soon" });
    expect(relativeDue("2026-10-11", TODAY, "09:00")).toBe("明天 09:00");
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
