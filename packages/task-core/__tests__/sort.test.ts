import { describe, it, expect } from "vitest";
import { parseTasks } from "../src/taskParser";
import {
	sortTasks,
	orderSubtasks,
	taskHasTag,
	countDescendants,
	groupTasksByDue,
	dueBucket,
} from "../src/sort";

function tasksFrom(lines: string[]) {
	return parseTasks(lines.join("\n")).tasks;
}

describe("sortTasks", () => {
	it("orders by due date, undated last", () => {
		const t = tasksFrom([
			"- [ ] C 📅 2026-03-01",
			"- [ ] A 📅 2026-01-01",
			"- [ ] Z",
			"- [ ] B 📅 2026-02-01",
		]);
		expect(sortTasks(t, "due").map((x) => x.description)).toEqual(["A", "B", "C", "Z"]);
	});

	it("breaks due-date ties by priority", () => {
		const t = tasksFrom([
			"- [ ] Low 🔽 📅 2026-01-01",
			"- [ ] Highest 🔺 📅 2026-01-01",
			"- [ ] Normal 📅 2026-01-01",
			"- [ ] Earlier 🔽 📅 2025-12-31",
		]);
		expect(sortTasks(t, "due").map((x) => x.description)).toEqual([
			"Earlier",
			"Highest",
			"Normal",
			"Low",
		]);
	});

	it("orders by priority then due", () => {
		const t = tasksFrom([
			"- [ ] Low 🔽 📅 2026-01-01",
			"- [ ] High1 ⏫ 📅 2026-02-01",
			"- [ ] High2 ⏫ 📅 2026-01-15",
		]);
		expect(sortTasks(t, "priority-due").map((x) => x.description)).toEqual([
			"High2",
			"High1",
			"Low",
		]);
	});

	it("preserves file order for 'file'", () => {
		const t = tasksFrom(["- [ ] one", "- [ ] two", "- [ ] three"]);
		expect(sortTasks(t, "file").map((x) => x.description)).toEqual(["one", "two", "three"]);
	});
});

describe("orderSubtasks — completed sink to the bottom, stable", () => {
	it("moves done children below open ones, keeping each group's order", () => {
		const parent = tasksFrom([
			"- [ ] Parent",
			"    - [x] done first",
			"    - [ ] open A",
			"    - [x] done second",
			"    - [ ] open B",
		])[0];
		expect(orderSubtasks(parent.children).map((c) => c.description)).toEqual([
			"open A",
			"open B",
			"done first",
			"done second",
		]);
	});
});

describe("groupTasksByDue", () => {
	const TODAY = "2026-02-10";

	it("buckets by proximity to today", () => {
		const [late, now, later, none] = tasksFrom([
			"- [ ] late 📅 2026-02-09",
			"- [ ] now 📅 2026-02-10",
			"- [ ] later 📅 2026-02-11",
			"- [ ] none",
		]);
		expect(dueBucket(late, TODAY)).toBe("overdue");
		expect(dueBucket(now, TODAY)).toBe("today");
		expect(dueBucket(later, TODAY)).toBe("upcoming");
		expect(dueBucket(none, TODAY)).toBe("undated");
	});

	it("groups in display order, drops empty buckets, keeps input order", () => {
		const t = tasksFrom([
			"- [ ] A 📅 2026-02-09",
			"- [ ] B 📅 2026-02-08",
			"- [ ] C 📅 2026-03-01",
		]);
		expect(groupTasksByDue(t, TODAY)).toEqual([
			{ bucket: "overdue", tasks: [t[0], t[1]] },
			{ bucket: "upcoming", tasks: [t[2]] },
		]);
	});

	it("returns a single group when everything shares a bucket", () => {
		const t = tasksFrom(["- [ ] A 📅 2026-02-10", "- [ ] B 📅 2026-02-10"]);
		expect(groupTasksByDue(t, TODAY).map((g) => g.bucket)).toEqual(["today"]);
	});
});

describe("taskHasTag / countDescendants", () => {
	it("matches tags with or without leading #", () => {
		const t = tasksFrom(["- [ ] X #work"])[0];
		expect(taskHasTag(t, "work")).toBe(true);
		expect(taskHasTag(t, "#work")).toBe(true);
		expect(taskHasTag(t, "home")).toBe(false);
	});

	it("counts nested descendants", () => {
		const t = tasksFrom([
			"- [ ] Root",
			"    - [ ] A",
			"        - [ ] A1",
			"    - [ ] B",
		])[0];
		expect(countDescendants(t)).toBe(3);
	});
});
