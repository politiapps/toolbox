import { describe, it, expect } from "vitest";
import { parseTasks, parseTask, serializeTask, collectTags } from "../src/taskParser";

/**
 * Golden round-trip tests. These lock the exact markdown behavior the Obsidian
 * plugin and the Android app must both honor. If either surface changes the
 * shared parser, a diff here is the early warning.
 */

describe("parseTask — single line", () => {
	it("parses a plain incomplete task", () => {
		const t = parseTask("- [ ] Buy milk", 0)!;
		expect(t).not.toBeNull();
		expect(t.completed).toBe(false);
		expect(t.description).toBe("Buy milk");
	});

	it("parses tags, due, priority, and done date", () => {
		const t = parseTask("- [x] Pay rent #home 📅 2026-01-05 ⏫ ✅ 2026-01-04", 0)!;
		expect(t.completed).toBe(true);
		expect(t.description).toBe("Pay rent");
		expect(t.tags).toEqual(["#home"]);
		expect(t.due).toBe("2026-01-05");
		expect(t.priority).toBe("high");
		expect(t.doneDate).toBe("2026-01-04");
	});

	it("captures recurrence rule text without swallowing later tokens", () => {
		const t = parseTask("- [ ] Water plants 🔁 every week 📅 2026-02-01", 0)!;
		expect(t.recurrence).toBe("every week");
		expect(t.due).toBe("2026-02-01");
		expect(t.description).toBe("Water plants");
	});

	it("returns null for non-task lines", () => {
		expect(parseTask("## Heading", 0)).toBeNull();
		expect(parseTask("just text", 0)).toBeNull();
		expect(parseTask("- a plain bullet", 0)).toBeNull();
	});
});

describe("serializeTask — canonical token order", () => {
	it("emits description, tags, due, priority, recurrence, done in order", () => {
		const line = serializeTask({
			description: "Pay rent",
			tags: ["#home"],
			due: "2026-01-05",
			priority: "high",
			recurrence: "every month",
			completed: true,
			doneDate: "2026-01-04",
		});
		expect(line).toBe("- [x] Pay rent #home 📅 2026-01-05 ⏫ 🔁 every month ✅ 2026-01-04");
	});

	it("omits done date when not completed", () => {
		const line = serializeTask({
			description: "Draft",
			tags: [],
			due: null,
			priority: "normal",
			completed: false,
			doneDate: null,
		});
		expect(line).toBe("- [ ] Draft");
	});
});

describe("round-trip: parse → serialize → parse", () => {
	const cases = [
		"- [ ] Buy milk",
		"- [x] Pay rent #home 📅 2026-01-05 ⏫ ✅ 2026-01-04",
		"- [ ] Water plants #garden 🔁 every 2 weeks 📅 2026-02-01",
		"- [ ] Big one #work 📅 2026-03-10 🔺",
	];

	for (const original of cases) {
		it(`stabilises: ${original}`, () => {
			const first = parseTask(original, 0)!;
			const reserialised = serializeTask({
				description: first.description,
				tags: first.tags,
				due: first.due,
				priority: first.priority,
				recurrence: first.recurrence,
				completed: first.completed,
				doneDate: first.doneDate,
			});
			const second = parseTask(reserialised, 0)!;
			// A second serialise must be identical to the first (fixed point).
			const reserialised2 = serializeTask({
				description: second.description,
				tags: second.tags,
				due: second.due,
				priority: second.priority,
				recurrence: second.recurrence,
				completed: second.completed,
				doneDate: second.doneDate,
			});
			expect(reserialised2).toBe(reserialised);
		});
	}
});

describe("parseTasks — hierarchy", () => {
	it("nests subtasks and attaches notes", () => {
		const content = [
			"- [ ] Parent #proj",
			"    a note line",
			"    - [ ] Child A",
			"    - [x] Child B ✅ 2026-01-02",
		].join("\n");
		const { tasks, flat } = parseTasks(content);
		expect(tasks).toHaveLength(1);
		expect(flat).toHaveLength(3);
		const parent = tasks[0];
		expect(parent.notes).toBe("a note line");
		expect(parent.children).toHaveLength(2);
		expect(parent.children[1].completed).toBe(true);
	});

	it("collects unique tags in first-seen order", () => {
		const { tasks } = parseTasks("- [ ] A #x\n- [ ] B #y #x");
		expect(collectTags(tasks)).toEqual(["#x", "#y"]);
	});
});
