import { describe, expect, it } from "vitest";
import type { Todo } from "@deskdo/core/types";
import { quadrants } from "./matrix";

const TODAY = "2026-10-12";

function todo(id: string, fields: Partial<Todo> = {}): Todo {
  return {
    id,
    title: id,
    done: false,
    doneAt: null,
    due: null,
    tag: null,
    priority: "normal",
    note: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    source: "manual",
    sourceRef: null,
    ...fields,
  };
}

describe("quadrants", () => {
  it("sorts by priority and how soon it is due", () => {
    const q = quadrants(
      [
        todo("quiz", { priority: "high", due: "2026-10-12" }),
        todo("exam", { priority: "high", due: "2026-10-20" }),
        todo("late", { due: "2026-10-01" }),
        todo("soon", { due: "2026-10-14" }),
        todo("someday"),
        todo("in3", { due: "2026-10-15" }),
      ],
      TODAY,
    );
    const ids = Object.fromEntries(q.map((x) => [x.key, x.items.map((t) => t.id)]));
    expect(ids).toEqual({ do: ["quiz"], plan: ["exam"], quick: ["late", "soon"], later: ["in3", "someday"] });
  });
});
