import { describe, it, expect } from "vitest";
import { parseTasks } from "../src/taskParser";
import { sortTasks, orderSubtasks, taskHasTag, countDescendants } from "../src/sort";

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
